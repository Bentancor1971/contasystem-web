/**
 * Tipos y textos de /s/[token] (confirmación del cupo de un sorteo). Sin
 * imports server-only: los usan la página, el client component y el handler.
 * Ver docs/supabase/72_sorteos_confirmacion.sql del repo desktop.
 */

import { tokenValido } from '@/lib/elecciones-types'

export { tokenValido }

export type RespuestaCupo = 'confirmo' | 'rechazo'

/** Cómo está el cupo en el desktop. 'abierto' = se puede responder. */
export type EstadoConfirmacion = 'abierto' | 'confirmo' | 'rechazo' | 'reasignado' | 'anulado'

export interface ConfirmacionSorteo {
  ok: true
  empresa_nombre: string
  evento_nombre: string
  premio: string
  numero_texto: string
  nombre_publico: string
  /** Último día para responder, inclusive (YYYY-MM-DD, hora de Montevideo). */
  vence_fecha: string
  estado: EstadoConfirmacion
  respuesta: RespuestaCupo | null
  respuesta_at: string | null
  vencido: boolean
}

export interface ErrorConfirmacion {
  error: string
  respuesta?: RespuestaCupo | null
  estado?: EstadoConfirmacion
}

export function esError(r: unknown): r is ErrorConfirmacion {
  return !!r && typeof r === 'object' && 'error' in r
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** '2026-10-02' → 'viernes 02/10/2026', sin depender del locale ni del huso del server. */
export function fechaLarga(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m) return fecha
  const dia = DIAS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]
  return `${dia} ${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Qué decirle a la persona cuando ya no puede responder. null = puede.
 * El orden importa: lo que ya respondió pesa más que el plazo.
 */
export function motivoCerrado(c: ConfirmacionSorteo): { titulo: string; detalle: string; tono: 'ok' | 'medio' | 'alto' } | null {
  const respuesta = c.respuesta ?? (c.estado === 'confirmo' || c.estado === 'rechazo' ? c.estado : null)
  if (respuesta === 'confirmo') {
    return {
      titulo: 'Tu cupo está confirmado',
      detalle: 'Ya registramos tu confirmación. En los próximos días nos comunicamos con vos para coordinar.',
      tono: 'ok',
    }
  }
  if (respuesta === 'rechazo') {
    return {
      titulo: 'Rechazaste el cupo',
      detalle: 'Ya lo registramos: el cupo se asignará a un suplente del sorteo. Si fue un error, escribinos respondiendo el correo.',
      tono: 'medio',
    }
  }
  if (c.estado === 'reasignado') {
    return {
      titulo: 'Este cupo ya no está a tu nombre',
      detalle: 'Se asignó a un suplente del sorteo. Si tenés dudas, escribinos respondiendo el correo.',
      tono: 'alto',
    }
  }
  if (c.estado === 'anulado') {
    return {
      titulo: 'El sorteo fue anulado',
      detalle: 'Este link ya no tiene efecto. La organización se va a comunicar con las novedades.',
      tono: 'alto',
    }
  }
  if (c.vencido) {
    return {
      titulo: 'Venció el plazo para responder',
      detalle: `Se podía confirmar hasta el ${fechaLarga(c.vence_fecha)}. Si todavía te interesa, escribinos respondiendo el correo: la organización decide.`,
      tono: 'alto',
    }
  }
  return null
}

/** Textos para los errores que devuelve responder. */
export const MENSAJE_ERROR: Record<string, string> = {
  ya_respondio: 'Ya habías respondido antes. Recargá la página para ver tu respuesta.',
  cerrado: 'Este cupo ya no se puede responder desde acá. Recargá la página para ver cómo quedó.',
  vencido: 'Venció el plazo para responder.',
  credencial_inexistente: 'El link no es válido.',
}
