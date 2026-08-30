/**
 * Constancia de voto por mail (server-only).
 *
 * Sale apenas se emite el voto. Es el mail que convierte un voto usurpado en
 * algo que la persona detecta el mismo día: si tarda, deja de servir.
 *
 * Reglas que hacen que esto no pueda romper una elección:
 *
 *  · Se llama DESPUÉS de que `emitir_voto` devolvió ok, nunca antes ni dentro.
 *    El voto ya está registrado; el mail es un extra.
 *  · Best-effort: no lanza nunca. Un SMTP caído no puede hacer que la persona
 *    vea un error después de haber votado bien.
 *  · Lo que falla queda pendiente (`constancia_enviada_at` en NULL) y lo levanta
 *    el desktop con su comunicación "Constancia de voto emitido". No hay
 *    reintento acá: el segundo intento tiene que verlo un humano.
 *  · El texto sale de la plantilla que la comisión configuró en el desktop y
 *    viaja en `elecciones_remoto`. La web no inventa el mail.
 *
 * Sobre la dirección: viaja en la credencial sólo mientras la persona no votó,
 * y `marcar_constancia_web` la borra apenas el mail sale. Ver el encabezado de
 * docs/supabase/40_elecciones_constancia.sql.
 *
 * ⚠️ SOLO server-side (usa el cliente admin y nodemailer).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { sendTextoEmail } from '@/lib/mailer'

/**
 * Placeholders de las plantillas de elecciones. Espejo de
 * PLACEHOLDERS_ELECCION en el desktop (configuracion-elecciones.ts).
 *
 * Están los doce, no sólo los que una constancia usa: el criterio del desktop
 * es que un placeholder que no aplica se borra, y si acá faltara alguno la
 * persona recibiría un `{link}` crudo en el cuerpo del mail.
 */
const PLACEHOLDERS = [
  '{nombre}', '{eleccion}', '{link}', '{codigo}',
  '{fecha_apertura}', '{fecha_cierre}', '{digitos}', '{emitido_at}',
  '{resultados}', '{motivo_exclusion}', '{estado_padron}', '{contacto}',
] as const

/** Misma sustitución que `configuracionEleccionesModule.aplicarPlantilla`. */
function aplicarPlantilla(plantilla: string, valores: Record<string, string>): string {
  let texto = plantilla
  for (const key of PLACEHOLDERS) {
    texto = texto.split(key).join(valores[key.slice(1, -1)] ?? '')
  }
  return texto
}

/**
 * Igual, pero escapando los valores: acá se inyectan dentro del HTML de marca
 * que armó el desktop. El nombre visible sale de la base y un `<` suelto rompería
 * el mail — o algo peor.
 */
function aplicarPlantillaHtml(plantilla: string, valores: Record<string, string>): string {
  const escapado: Record<string, string> = {}
  for (const [k, v] of Object.entries(valores)) {
    escapado[k] = String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
  return aplicarPlantilla(plantilla, escapado)
}

interface ConstanciaPendiente {
  ok: true
  empresa_id: string
  mail: string
  asunto: string
  cuerpo: string
  /**
   * Mismo cuerpo envuelto en el HTML de marca de la empresa, armado por el
   * desktop y bajado con los `{placeholders}` sin sustituir. Puede faltar: en
   * bases donde todavía no corrió 44_constancia_html.sql, o si la empresa no
   * tiene configuración de correo.
   */
  cuerpo_html?: string | null
  responder_a: string | null
  valores: Record<string, string>
}

/** Deja registrado cómo salió. Si esto falla también, sólo queda el log. */
async function sellar(
  admin: SupabaseClient,
  votoId: string,
  error: string | null,
): Promise<void> {
  const { error: rpcError } = await admin.rpc('marcar_constancia_web', {
    p_voto_id: votoId,
    p_error: error,
  })
  if (rpcError) {
    console.error(`[constancia] no se pudo sellar el voto ${votoId}: ${rpcError.message}`)
  }
}

/**
 * Manda la constancia del voto indicado. No lanza nunca.
 *
 * Pensada para correr con `after()` del route handler: la pantalla de quien
 * votó no espera al SMTP.
 */
export async function enviarConstanciaVoto(
  admin: SupabaseClient,
  votoId: string,
): Promise<void> {
  try {
    const { data, error } = await admin.rpc('constancia_pendiente', { p_voto_id: votoId })
    if (error) {
      console.error(`[constancia] constancia_pendiente falló (${votoId}): ${error.message}`)
      return
    }
    // 'nada_que_enviar' = ya salió, no hay dirección, o la elección no tiene
    // plantilla. Ninguno es una falla y ninguno se reintenta.
    if (!data || (data as { ok?: boolean }).ok !== true) return

    const c = data as unknown as ConstanciaPendiente

    // NUEVO (61_): el intento se sella ACÁ, antes de tocar la red — antes de
    // resolver la cuenta de Gmail y antes del SMTP. Si el proceso se corta
    // entre este punto y `sellar()` de más abajo (Vercel mata la función a
    // mitad del envío, por ejemplo), al menos queda un número en
    // `constancia_intentos` que alguien puede leer después; antes de 61_ el
    // único sellado era el de después de intentar mandar, y un corte a mitad
    // de camino no dejaba ningún rastro del intento. Best-effort: si esto
    // falla —o si la base no tiene 61_ aplicado, PGRST202/42883— se sigue
    // igual, no se corta el envío por un problema de contabilidad.
    const { error: intentoError } = await admin.rpc('marcar_intento_constancia', {
      p_voto_id: votoId,
    })
    if (intentoError) {
      console.warn(
        `[constancia] marcar_intento_constancia no se pudo aplicar (${votoId}, ¿falta 61_?): ` +
          intentoError.message,
      )
    }

    const cuenta = await loadGmailAccountForEmpresa(admin, c.empresa_id)
    if (!cuenta) {
      // Queda pendiente a propósito: el desktop la manda desde su propio SMTP.
      await sellar(admin, votoId, 'La empresa no tiene casilla de correo configurada en la web')
      return
    }

    const r = await sendTextoEmail({
      cuenta,
      to: c.mail,
      subject: aplicarPlantilla(c.asunto, c.valores),
      text: aplicarPlantilla(c.cuerpo, c.valores),
      // Las dos versiones: el cliente de correo elige. Si el desktop todavía no
      // subió el HTML, sale sólo el texto — la constancia nunca se cae por el
      // diseño.
      html: c.cuerpo_html ? aplicarPlantillaHtml(c.cuerpo_html, c.valores) : null,
      replyTo: c.responder_a,
    })

    await sellar(admin, votoId, r.ok ? null : r.error)
    if (!r.ok) console.warn(`[constancia] envío fallido (${votoId}): ${r.error}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[constancia] error inesperado (${votoId}): ${msg}`)
    try {
      await sellar(admin, votoId, msg)
    } catch {
      /* el sellado es lo último que queda; si tampoco va, ya está logeado */
    }
  }
}
