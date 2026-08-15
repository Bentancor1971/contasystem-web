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

/**
 * IP del cliente detrás del proxy de Vercel, a partir de los headers sueltos.
 * Se separa de `clientIp` porque un Server Component no tiene `Request`: tiene
 * `headers()` de next/headers.
 */
export function ipDeHeaders(h: Headers): string {
  const fwd = h.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return h.get('x-real-ip')?.trim() || 'desconocida'
}

/** IP del cliente detrás del proxy de Vercel. */
export function clientIp(req: Request): string {
  return ipDeHeaders(req.headers)
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
  return permitidoPorIp(admin, clientIp(req), regla)
}

/** Igual que `permitido`, con la IP ya resuelta (Server Components). */
export async function permitidoPorIp(
  admin: SupabaseClient,
  ip: string,
  regla: RateLimitRule,
): Promise<boolean> {
  const bucket = `${regla.nombre}:${ip}`
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

  // Votación (/v/[token]). El token es inadivinable, así que el enemigo no es
  // quien enumera credenciales sino quien, con un link reenviado en la mano,
  // martilla las 10.000 combinaciones de 4 dígitos. Contra eso la defensa fuerte
  // es el bloqueo por credencial que ya hace la base (5 fallos → 15 minutos);
  // esto cubre al que prueba muchas credenciales distintas desde una IP.
  //
  // Los topes son deliberadamente más flojos que los de eventos: mucha gente vota
  // desde datos móviles, donde el CGNAT del operador mete a cientos de personas
  // detrás de la misma IP. Un límite estrecho no frena un ataque —quien lo hace
  // en serio rota IPs— pero sí puede dejar sin votar a un socio real.
  /** Abrir el link. */
  votoVer: { nombre: 'voto_ver', limite: 30, ventanaSegundos: 60 },
  /** Probar los dígitos. */
  votoValidar: { nombre: 'voto_validar', limite: 20, ventanaSegundos: 60 },
  /** Emitir. Una persona lo hace una vez; el margen es para el reintento. */
  votoEmitir: { nombre: 'voto_emitir', limite: 15, ventanaSegundos: 300 },
  /**
   * Canjear el código impreso de la credencial.
   *
   * Es el único punto del módulo donde se prueba un secreto SIN un bloqueo por
   * credencial detrás: el token tiene su contador de intentos, el código no.
   * Por eso el tope es más estrecho que el de votar, aunque siga siendo holgado
   * para quien tipea mal un par de veces desde el papel.
   */
  votoCodigo: { nombre: 'voto_codigo', limite: 10, ventanaSegundos: 300 },

  /**
   * Entrar a un puesto de mesa (`/mesa`).
   *
   * La base bloquea la MESA a los 5 fallos, y eso cubre a quien martilla una
   * sola. Lo que cubre este tope es lo otro: un PIN son 10⁶ combinaciones y sin
   * límite por IP alguien podría barrer todas las mesas en paralelo sin llegar a
   * bloquear ninguna. Holgado igual, porque las mesas de un mismo local salen
   * todas por la misma conexión y el operador que tipea mal no puede quedar
   * afuera de su propio acto electoral.
   */
  mesaLogin: { nombre: 'mesa_login', limite: 20, ventanaSegundos: 300 },

  // Postulación a una convocatoria (/p/[token]). Mismo criterio y mismos topes
  // holgados que la votación, por la misma razón: la defensa fuerte contra el
  // martilleo de los 4 dígitos es el bloqueo por credencial que hace la base (5
  // fallos → 15 minutos), y un límite estrecho por IP no frena a quien rota IPs
  // pero sí deja afuera a un socio real detrás del CGNAT de su operador.
  /** Abrir el link. */
  postulacionVer: { nombre: 'postulacion_ver', limite: 30, ventanaSegundos: 60 },
  /** Probar los dígitos. */
  postulacionValidar: { nombre: 'postulacion_validar', limite: 20, ventanaSegundos: 60 },
  /** Anotarse. Una persona lo hace una vez; el margen es para el reintento. */
  postulacionEnviar: { nombre: 'postulacion_enviar', limite: 15, ventanaSegundos: 300 },
  /** Darse de baja. */
  postulacionRetirar: { nombre: 'postulacion_retirar', limite: 10, ventanaSegundos: 300 },
} as const satisfies Record<string, RateLimitRule>

/** Cuerpo estándar del 429. */
export const RESPUESTA_429 = {
  error: 'Demasiados intentos. Esperá un momento y volvé a probar.',
} as const
