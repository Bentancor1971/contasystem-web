/**
 * Constancia por mail de la respuesta al cupo de un sorteo (server-only).
 *
 * Cuando el favorecido confirma o rechaza con el botón del mail (/s/[token]),
 * recibe en el momento un mail con lo que respondió y cuándo. Ver
 * docs/sorteos-propuesta.md §16.16 y 73_sorteos_constancia_respuesta.sql del
 * repo desktop.
 *
 *   - Confirmó: el cupo quedó a su nombre; si se usa en un evento de la app,
 *     queda inscripto ahí (la entrada con QR, si la hay, llega aparte).
 *   - Rechazó: el cupo pasa al siguiente; si fue un error, que responda ya.
 *
 * Mismo molde que el acuse de la ficha web: casilla y marca de la empresa,
 * texto + HTML, sin copia oculta (el registro de la organización es el
 * desktop). Best-effort: nunca lanza; una casilla caída no deshace la respuesta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { loadEmpresaBranding } from '@/lib/empresa-branding'
import { sendTextoEmail } from '@/lib/mailer'
import { escapeHtml } from '@/lib/sanitize-html'
import type { RespuestaCupo } from '@/lib/sorteo-confirmacion-types'

/** Lo que devuelve `responder_confirmacion_sorteo` (73_) para armar la constancia. */
export interface DatosConstancia {
  token: string
  respuesta: RespuestaCupo
  respuesta_at: string
  empresa_id: string
  empresa_nombre: string
  evento_nombre: string
  premio: string
  numero_texto: string
  nombre_publico: string
  mail: string
  destino_evento_nombre: string
}

/** "2 de octubre de 2026, 15:26" en hora de Montevideo, sin depender del huso del server. */
function cuandoLegible(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-UY', {
    timeZone: 'America/Montevideo',
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

interface Contenido {
  asunto: string
  titulo: string
  parrafos: string[]
}

function contenido(d: DatosConstancia, empresa: string): Contenido {
  const premio = d.premio ? ` (${d.premio})` : ''
  const cuando = cuandoLegible(d.respuesta_at)
  if (d.respuesta === 'confirmo') {
    return {
      asunto: `${empresa} - Cupo confirmado: ${d.evento_nombre}`,
      titulo: 'Tu cupo quedó confirmado',
      parrafos: [
        `Hola ${d.nombre_publico}: registramos que confirmaste tu cupo del sorteo de "${d.evento_nombre}"${premio}, con el número ${d.numero_texto}, el ${cuando}.`,
        ...(d.destino_evento_nombre
          ? [`Quedás inscripto en "${d.destino_evento_nombre}". Si ese evento usa entrada con código QR, te llega en un correo aparte.`]
          : []),
        'Si finalmente no podés asistir, avisanos respondiendo este correo lo antes posible: así el cupo puede pasar al siguiente en el orden del sorteo.',
      ],
    }
  }
  return {
    asunto: `${empresa} - Registramos que no usás el cupo: ${d.evento_nombre}`,
    titulo: 'Registramos que no vas a usar el cupo',
    parrafos: [
      `Hola ${d.nombre_publico}: registramos el ${cuando} que no vas a usar tu cupo del sorteo de "${d.evento_nombre}"${premio}, número ${d.numero_texto}.`,
      'El cupo pasa al siguiente en el orden del sorteo. Gracias por avisar.',
      'Si fue un error, respondé este correo cuanto antes: la organización todavía puede revisarlo mientras no haya pasado el cupo a otra persona.',
    ],
  }
}

function renderHtml(empresa: string, colorPrimary: string, c: Contenido): string {
  const parrafos = c.parrafos
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.55;">${escapeHtml(p)}</p>`)
    .join('')
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:${escapeHtml(colorPrimary)};padding:18px 24px;">
        <p style="margin:0;color:#ffffff;font-size:16px;font-weight:bold;">${escapeHtml(empresa)}</p>
      </div>
      <div style="padding:24px;">
        <h1 style="margin:0 0 14px;font-size:18px;color:#111827;">${escapeHtml(c.titulo)}</h1>
        ${parrafos}
        <p style="margin:6px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
          Esta es una constancia automática de la respuesta que diste con el botón del correo del sorteo.
        </p>
      </div>
    </div>
  </div>
</body></html>`
}

export type ResultadoConstancia =
  | { enviado: true }
  | { enviado: false; motivo: 'sin_destino' | 'sin_casilla' | 'error' }

export async function enviarConstanciaCupo(
  admin: SupabaseClient,
  d: DatosConstancia,
): Promise<ResultadoConstancia> {
  try {
    const to = d.mail.trim()
    if (!to.includes('@')) return { enviado: false, motivo: 'sin_destino' }
    const cuenta = await loadGmailAccountForEmpresa(admin, d.empresa_id)
    if (!cuenta) return { enviado: false, motivo: 'sin_casilla' }
    const marca = await loadEmpresaBranding(admin, d.empresa_id)
    const empresa = marca?.empresa.nombre || d.empresa_nombre || cuenta.fromName
    const colorPrimary = marca?.branding.color_primary || '#334155'
    const c = contenido(d, empresa)
    const text = [c.titulo, '', ...c.parrafos].join('\n\n')
    const r = await sendTextoEmail({ cuenta, to, subject: c.asunto, text, html: renderHtml(empresa, colorPrimary, c) })
    if (!r.ok) {
      console.warn(`[sorteo-constancia] fallo a ${to}: ${r.error}`)
      return { enviado: false, motivo: 'error' }
    }
    // Para auditar "¿le llegó?". Sin el SQL 73 la función no existe: no importa.
    const { error } = await admin.rpc('marcar_constancia_sorteo', { p_token: d.token })
    if (error) console.warn('[sorteo-constancia] marcar:', error.message)
    return { enviado: true }
  } catch (err) {
    console.error('[sorteo-constancia] error:', err)
    return { enviado: false, motivo: 'error' }
  }
}
