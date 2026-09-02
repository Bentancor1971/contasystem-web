/**
 * Acuse por mail de una propuesta de cambios de ficha (server-only).
 *
 * Al registrar la propuesta en /api/ficha/[token]/guardar, la persona recibe
 * un mail con el detalle "dato anterior → dato nuevo" de lo que envió, y la
 * aclaración de que la asociación lo revisa antes de aplicarlo.
 *
 * A quién va: a la casilla registrada en la ficha Y, si el cambio incluye un
 * mail nuevo, también a ese. Lo segundo es la confirmación habitual; lo
 * primero es la protección de siempre en un cambio de mail — si alguien ajeno
 * entró con el link, la dueña real se entera en su casilla actual.
 *
 * Sin copia oculta a la casilla de la empresa: el registro de la organización
 * es la propia cola de validación del desktop, y esto es correo con datos
 * personales (mismo criterio que la constancia de voto).
 *
 * Best-effort: nunca lanza y no frena la respuesta del handler — una casilla
 * SMTP caída no puede hacer fallar un envío de cambios ya registrado.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { loadEmpresaBranding } from '@/lib/empresa-branding'
import { sendTextoEmail } from '@/lib/mailer'
import { escapeHtml } from '@/lib/sanitize-html'
import type { CambioRegistradoServer } from '@/lib/ficha'
import { LABELS_CAMPOS } from '@/lib/ficha-types'
import type { CampoFicha, FichaPersonal, ItemCatalogo } from '@/lib/ficha-types'

/** ISO (YYYY-MM-DD…) → dd/mm/aaaa; lo que no parezca fecha sale tal cual. */
function fechaLegible(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

function nombreDeCatalogo(items: ItemCatalogo[], id: string): string {
  return items.find((i) => i.id === id)?.nombre ?? '(opción elegida)'
}

interface Fila {
  label: string
  antes: string
  ahora: string
}

/** Cada campo registrado, resuelto a "antes → ahora" legible. */
function armarFilas(registro: CambioRegistradoServer, fichaVieja: FichaPersonal): Fila[] {
  const m = registro.membresia
  const cat = registro.catalogos
  const filas: Fila[] = []

  const viejoDe = (campo: CampoFicha): string => {
    switch (campo) {
      case 'documento': return registro.documento
      case 'generacion': return m.generacion
      case 'fecha_recibido': return fechaLegible(m.fecha_recibido)
      case 'fecha_nacimiento': return fechaLegible(fichaVieja.fecha_nacimiento)
      case 'sexo': return fichaVieja.sexo === 'F' ? 'Femenino' : fichaVieja.sexo === 'M' ? 'Masculino' : ''
      case 'categoria_id': return m.categoria_nombre
      case 'forma_pago_id': return m.forma_pago_nombre
      case 'estado_registro_id': return m.estado_registro_nombre
      case 'tipo_pago_id': return m.tipo_pago_nombre
      case 'instituto_id': return m.instituto_nombre
      default: return (fichaVieja as unknown as Record<string, string>)[campo] ?? ''
    }
  }

  const nuevoDe = (campo: CampoFicha, valor: string): string => {
    switch (campo) {
      case 'fecha_nacimiento':
      case 'fecha_recibido': return fechaLegible(valor)
      case 'sexo': return valor === 'F' ? 'Femenino' : valor === 'M' ? 'Masculino' : valor
      case 'categoria_id': return nombreDeCatalogo(cat.categorias, valor)
      case 'forma_pago_id': return nombreDeCatalogo(cat.formas_pago, valor)
      case 'estado_registro_id': return nombreDeCatalogo(cat.estados_registro, valor)
      case 'tipo_pago_id': return nombreDeCatalogo(cat.tipos_pago, valor)
      case 'instituto_id': return nombreDeCatalogo(cat.institutos, valor)
      default: return valor
    }
  }

  for (const [campo, valor] of Object.entries(registro.cambios)) {
    if (typeof valor !== 'string' || valor === '') continue
    if (campo === 'titulo_pdf') {
      filas.push({
        label: 'Título (PDF)',
        antes: m.titulo_cargado ? 'Ya había uno cargado' : 'Sin título',
        ahora: 'PDF recibido',
      })
      continue
    }
    const label = LABELS_CAMPOS[campo]
    if (!label) continue
    filas.push({
      label,
      antes: viejoDe(campo as CampoFicha) || '—',
      ahora: nuevoDe(campo as CampoFicha, valor),
    })
  }
  return filas
}

function renderHtml(empresaNombre: string, colorPrimary: string, filas: Fila[]): string {
  const filasHtml = filas
    .map(
      (f) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;white-space:nowrap;">${escapeHtml(f.label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#9ca3af;">${escapeHtml(f.antes)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:600;">${escapeHtml(f.ahora)}</td>
        </tr>`,
    )
    .join('')

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:${escapeHtml(colorPrimary)};padding:18px 24px;">
        <p style="margin:0;color:#ffffff;font-size:16px;font-weight:bold;">${escapeHtml(empresaNombre)}</p>
      </div>
      <div style="padding:24px;">
        <h1 style="margin:0 0 8px;font-size:18px;color:#111827;">Recibimos tus cambios de ficha</h1>
        <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.5;">
          Este es el detalle de lo que enviaste. <strong>Todavía no está aplicado:</strong>
          la asociación lo revisa y lo confirma. Si algo no lo enviaste vos,
          respondé este mail o comunicate con la asociación.
        </p>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;">Dato</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;">Registrado</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;">Enviado</th>
          </tr>
          ${filasHtml}
        </table>
        <p style="margin:18px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
          Si volvés a enviar cambios antes de que se revisen, los nuevos reemplazan a estos.
        </p>
      </div>
    </div>
  </div>
</body></html>`
}

function renderTexto(empresaNombre: string, filas: Fila[]): string {
  return [
    `${empresaNombre} - Recibimos tus cambios de ficha`,
    '',
    'Este es el detalle de lo que enviaste. Todavía no está aplicado: la asociación lo revisa y lo confirma.',
    '',
    ...filas.map((f) => `- ${f.label}: ${f.antes} -> ${f.ahora}`),
    '',
    'Si algo no lo enviaste vos, respondé este mail o comunicate con la asociación.',
  ].join('\n')
}

export type ResultadoAcuseFicha =
  | { enviado: true }
  | { enviado: false; motivo: 'sin_casilla' | 'sin_destino' | 'sin_filas' | 'error' }

/**
 * Envía el acuse. `fichaVieja` es la ficha ANTES del cambio (el handler la lee
 * de socios_datos justo antes de responder — la propuesta no la tocó, porque
 * la web nunca escribe socios_datos).
 */
export async function enviarAcuseFicha(
  admin: SupabaseClient,
  registro: CambioRegistradoServer,
  fichaVieja: FichaPersonal,
): Promise<ResultadoAcuseFicha> {
  try {
    const filas = armarFilas(registro, fichaVieja)
    if (filas.length === 0) return { enviado: false, motivo: 'sin_filas' }

    // Destinos: la casilla registrada + la nueva si difiere. Sin ninguna de
    // las dos no hay a quién avisar (el desktop verá la propuesta igual).
    const registrada = (fichaVieja.mail ?? '').trim()
    const nueva = (registro.cambios.mail ?? '').trim()
    const destinos = [...new Set(
      [registrada, nueva].filter((d) => d.includes('@')).map((d) => d.toLowerCase()),
    )]
    if (destinos.length === 0) return { enviado: false, motivo: 'sin_destino' }

    const cuenta = await loadGmailAccountForEmpresa(admin, registro.empresa_id)
    if (!cuenta) return { enviado: false, motivo: 'sin_casilla' }

    const marca = await loadEmpresaBranding(admin, registro.empresa_id)
    const empresaNombre = marca?.empresa.nombre || cuenta.fromName
    const colorPrimary = marca?.branding.color_primary || '#334155'

    const html = renderHtml(empresaNombre, colorPrimary, filas)
    const text = renderTexto(empresaNombre, filas)
    const subject = `${empresaNombre} - Recibimos tus cambios de ficha`

    let alguno = false
    for (const to of destinos) {
      const r = await sendTextoEmail({ cuenta, to, subject, text, html })
      if (r.ok) alguno = true
      else console.warn(`[ficha-acuse] fallo a ${to}: ${r.error}`)
    }
    return alguno ? { enviado: true } : { enviado: false, motivo: 'error' }
  } catch (err) {
    console.error('[ficha-acuse] error:', err)
    return { enviado: false, motivo: 'error' }
  }
}
