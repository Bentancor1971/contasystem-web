/**
 * Rate limiting para los endpoints públicos de eventos.
 *
 * Contador de ventana fija en Postgres (ver supabase/rate_limits.sql). Se eligió
 * Supabase porque ya está: un contador en memoria no sirve en serverless (cada
 * instancia tendría el suyo).
 *
 * Es MITIGACIÓN, no prevención: quien rote IPs la esquiva. Sube mucho el costo
 * de enumerar cédulas, que es el objetivo. La defensa fuerte y complementaria es
 * una regla de rate limit en el firewall de Vercel, delante de la función.
 *
 * FAIL-OPEN: si la tabla no existe o Supabase falla, se deja pasar la petición.
 * Preferimos un evento que funciona sin límite a un formulario público caído.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** IP del cliente detrás del proxy de Vercel. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'desconocida'
}

export interface RateLimitRule {
  /** Prefijo del bucket, para no mezclar endpoints. Ej: 'lookup'. */
  nombre: string
  /** Peticiones permitidas dentro de la ventana. */
  limite: number
  /** Largo de la ventana, en segundos. */
  ventanaSegundos: number
}

/**
 * Registra un intento y devuelve `true` si se puede continuar.
 * Nunca lanza: ante cualquier error devuelve `true` (fail-open) y logea.
 */
export async function permitido(
  admin: SupabaseClient,
  req: Request,
  regla: RateLimitRule,
): Promise<boolean> {
  const bucket = `${regla.nombre}:${clientIp(req)}`
  try {
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_bucket: bucket,
      p_limit: regla.limite,
      p_window_seconds: regla.ventanaSegundos,
    })
    if (error) {
      console.warn(`[rate-limit] fail-open (${bucket}): ${error.message}`)
      return true
    }
    return data !== false
  } catch (err) {
    console.warn(`[rate-limit] fail-open (${bucket}):`, err)
    return true
  }
}

/** Límites por endpoint. Pensados para un humano inscribiéndose, no para un script. */
export const LIMITES = {
  /** Verificar cédula: es el endpoint que un enumerador martillaría. */
  lookup: { nombre: 'lookup', limite: 10, ventanaSegundos: 60 },
  /** Inscribirse: una persona lo hace una vez. */
  inscribir: { nombre: 'inscribir', limite: 5, ventanaSegundos: 300 },
  /** Declarar un pago: idem. */
  pago: { nombre: 'pago', limite: 5, ventanaSegundos: 300 },
  /** Reenviar la copia del comprobante: cada intento es un mail real saliendo. */
  reenviarAcuse: { nombre: 'reenviar_acuse', limite: 3, ventanaSegundos: 600 },
} as const satisfies Record<string, RateLimitRule>

/** Cuerpo estándar del 429. */
export const RESPUESTA_429 = {
  error: 'Demasiados intentos. Esperá un momento y volvé a probar.',
} as const
