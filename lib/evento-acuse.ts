/**
 * Acuse de inscripción por email (server-only).
 *
 * Único lugar donde se arma el mail de una inscripción: lo usan el alta
 * (POST /inscribir) y el reenvío de copia (POST /reenviar-acuse), para que la
 * persona reciba exactamente el mismo comprobante en ambos casos.
 *
 * Best-effort: nunca lanza. Devuelve el motivo para loguearlo.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventoRemoto, EventoWebConfig, ModalidadInscripcion } from '@/lib/eventos-types'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { sendInscripcionEmail } from '@/lib/mailer'
import { aplicarVariables, escapeHtml, sanitizeHtml } from '@/lib/sanitize-html'
import type { CambioDato } from '@/lib/recibo-evento-email'

/** Datos de la inscripción tal como quedaron guardados (lo que se le comprueba). */
export interface InscripcionAcuse {
  numero: string | null
  categoria_nombre: string | null
  tipo_participante: 'socio' | 'no_socio'
  importe: number
  transporte_importe: number
  alimentacion_importe: number
  alimentacion_tipo: string | null
  moneda_codigo: string
  modalidad: ModalidadInscripcion
  referencia_transferencia: string | null
}

export interface EnviarAcuseParams {
  evento: EventoRemoto
  cfg: EventoWebConfig
  /** Casilla a la que se envía (ya validada por el caller). */
  destino: string
  documento: string
  nombre: string
  apellido: string
  inscripcion: InscripcionAcuse
  /** Diferencias entre la ficha del socio y lo que escribió (sólo en el alta). */
  cambios?: CambioDato[]
}

export type ResultadoAcuse =
  | { ok: true }
  | { ok: false; motivo: 'sin_casilla' | 'sin_destino' | 'error'; error?: string }

export async function enviarAcuseInscripcion(
  admin: SupabaseClient,
  { evento, cfg, destino, documento, nombre, apellido, inscripcion, cambios = [] }: EnviarAcuseParams,
): Promise<ResultadoAcuse> {
  const to = destino.trim()
  if (!to) return { ok: false, motivo: 'sin_destino' }

  try {
    // Sólo se puede enviar si la empresa tiene casilla Gmail configurada.
    const cuenta = await loadGmailAccountForEmpresa(admin, evento.empresa_id)
    if (!cuenta) return { ok: false, motivo: 'sin_casilla' }

    const total =
      Number(inscripcion.importe) +
      Number(inscripcion.transporte_importe) +
      Number(inscripcion.alimentacion_importe)

    // Plantilla propia del evento (si la cargaron en /configuracion/eventos).
    // El asunto es texto plano; el cuerpo es HTML (variables escapadas y saneado).
    const varsTexto: Record<string, string> = {
      nombre: `${nombre} ${apellido}`.trim(),
      evento: evento.nombre,
      numero: inscripcion.numero ?? '',
      total: `${inscripcion.moneda_codigo} ${total.toFixed(2)}`,
    }
    const varsHtml = Object.fromEntries(
      Object.entries(varsTexto).map(([k, v]) => [k, escapeHtml(v)]),
    )
    // Plantilla según la modalidad: pago declarado usa la propia (con el aviso de
    // verificación de transferencia); preinscripción usa la suya. Si el campo del
    // caso está vacío, cae al recibo branded por defecto.
    const esPago = inscripcion.modalidad === 'pago_transferencia'
    const asuntoTpl = esPago ? cfg.mail_acuse_pago_asunto : cfg.mail_acuse_asunto
    const htmlTpl = esPago ? cfg.mail_acuse_pago_html : cfg.mail_acuse_html

    const envio = await sendInscripcionEmail({
      cuenta,
      to,
      override: {
        asunto: asuntoTpl ? aplicarVariables(asuntoTpl, varsTexto) : null,
        html: htmlTpl ? sanitizeHtml(aplicarVariables(htmlTpl, varsHtml)) : null,
      },
      data: {
        empresa: { nombre: cuenta.fromName },
        eventoNombre: evento.nombre,
        eventoFecha: evento.fecha_inicio,
        socioNombre: `${nombre} ${apellido}`.trim(),
        socioDocumento: documento,
        categoriaNombre: inscripcion.categoria_nombre,
        tipoParticipante: inscripcion.tipo_participante,
        importe: Number(inscripcion.importe),
        transporteImporte: Number(inscripcion.transporte_importe),
        alimentacionImporte: Number(inscripcion.alimentacion_importe),
        alimentacionTipo: inscripcion.alimentacion_tipo,
        total,
        monedaCodigo: inscripcion.moneda_codigo,
        modalidad: inscripcion.modalidad,
        datosDeposito: esPago ? evento.datos_deposito : null,
        numero: inscripcion.numero,
        referenciaDeclarada: inscripcion.referencia_transferencia,
        cambios,
      },
    })
    if (!envio.ok) return { ok: false, motivo: 'error', error: envio.error }
    return { ok: true }
  } catch (err) {
    return { ok: false, motivo: 'error', error: err instanceof Error ? err.message : 'Error' }
  }
}
