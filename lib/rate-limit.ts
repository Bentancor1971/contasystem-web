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
  /**
   * `true` = ante un error de PERMISOS (42501 / "permission denied") esta
   * regla corta (devuelve `false`) en vez de dejar pasar.
   *
   * Sólo tiene sentido en los dos puntos del módulo donde se prueba un
   * secreto SIN bloqueo por credencial detrás (`votoCodigo`, `kioscoAbrir`):
   * ahí, si el `REVOKE … FROM anon` de `rate_limit_hit` no se aplicó (48_) o
   * se deshizo, el limitador queda sin dientes justo donde es la única
   * defensa. El resto de las reglas sigue fail-open: un error de permisos en
   * `votoValidar` o `mesaLogin` no puede tumbar una elección, porque atrás
   * sigue estando el bloqueo por credencial/mesa que hace la base.
   *
   * No aplica a errores de red ni de conexión (el `catch` de abajo): eso
   * sigue fail-open siempre, para las dos reglas también. Lo que corta es
   * específicamente "esta función quedó ejecutable de más", no "Supabase no
   * respondió".
   */
  failClosed?: boolean
}

/** 42501 es el código de Postgres para "permission denied"; PostgREST lo respeta tal cual. */
function esErrorDePermisos(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === '42501' || (err.message ?? '').toLowerCase().includes('permission denied')
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
  return permitidoPorClave(admin, ip, regla)
}

/**
 * El mismo contador, con una clave que no es la IP.
 *
 * Existe por la terminal de mesa: doscientas personas votando desde la tablet
 * del club son una sola IP, y contarlas juntas trancaría la mesa a mitad del
 * acto. Ahí la clave es la terminal —una sesión que hubo que abrir con una
 * llave— y por eso se puede contar aparte sin dejar de contar.
 */
export async function permitidoPorClave(
  admin: SupabaseClient,
  clave: string,
  regla: RateLimitRule,
): Promise<boolean> {
  const bucket = `${regla.nombre}:${clave}`
  try {
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_bucket: bucket,
      p_limit: regla.limite,
      p_window_seconds: regla.ventanaSegundos,
    })
    if (error) {
      if (regla.failClosed && esErrorDePermisos(error)) {
        console.warn(`[rate-limit] fail-closed (${bucket}): ${error.message}`)
        return false
      }
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
  votoCodigo: { nombre: 'voto_codigo', limite: 10, ventanaSegundos: 300, failClosed: true },

  // Terminal de mesa (`/v/mesa`). Montarla se cuenta por IP; atender votantes,
  // por terminal. Esa asimetría es todo el punto de la llave: sin ella no habría
  // forma de distinguir 200 votos legítimos que salen de la conexión del club de
  // alguien probando códigos desde su casa. Ver docs/supabase/46_voto_kiosco.sql.
  /**
   * Tipear la llave. Son 10 caracteres de un alfabeto de 31 (~8·10^14
   * combinaciones): el tope no es lo que la protege, es lo que evita que alguien
   * use el endpoint como martillo. Holgado para el operador que copia de un
   * papel y se equivoca dos veces.
   */
  kioscoAbrir: { nombre: 'kiosco_abrir', limite: 10, ventanaSegundos: 300, failClosed: true },
  /**
   * Canjear el código de una credencial EN una terminal montada. Por terminal,
   * y holgado: es una fila de gente, no un script. El código sigue sin tener
   * bloqueo por credencial detrás —el que cuenta intentos es el token—, así que
   * el tope existe igual.
   */
  kioscoCodigo: { nombre: 'kiosco_codigo', limite: 40, ventanaSegundos: 60 },
  /** Probar los dígitos. El bloqueo por credencial (5 fallos → 15 min) no se toca. */
  kioscoValidar: { nombre: 'kiosco_validar', limite: 40, ventanaSegundos: 60 },
  /** Emitir. Una persona lo hace una vez; el margen es para el reintento. */
  kioscoEmitir: { nombre: 'kiosco_emitir', limite: 30, ventanaSegundos: 60 },

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

  // Ficha de socio (/f/[token]). Mismo criterio que votación/postulación: el
  // bloqueo fuerte (5 fallos → 15 minutos) lo lleva la base por credencial, y
  // el tope por IP cubre al que prueba muchas credenciales distintas. Holgado
  // por el CGNAT de los operadores móviles. La diferencia con votación es que
  // acá el premio del factor es la ficha COMPLETA de una persona, así que
  // guardar —que revalida el factor— tiene su propio bucket, más estrecho.
  /** Abrir el link. */
  fichaVer: { nombre: 'ficha_ver', limite: 30, ventanaSegundos: 60 },
  /** Probar el factor (dígitos o código). */
  fichaValidar: { nombre: 'ficha_validar', limite: 20, ventanaSegundos: 60 },
  /** Enviar la propuesta. Una persona lo hace una o dos veces; reenviar reemplaza. */
  fichaGuardar: { nombre: 'ficha_guardar', limite: 10, ventanaSegundos: 300 },
  /** Pedir el link de subida del título (cada uno habilita UN PUT a Storage). */
  fichaTitulo: { nombre: 'ficha_titulo', limite: 5, ventanaSegundos: 300 },
  /** Confirmar sin cambios. Una persona lo hace una vez; margen para el reintento. */
  fichaConfirmar: { nombre: 'ficha_confirmar', limite: 5, ventanaSegundos: 300 },

  /**
   * Probar el acceso (`/v/prueba-acceso`, `/p/prueba-acceso`).
   *
   * Bucket propio a propósito: quien prueba el acceso suele estar en el mismo
   * local —y detrás de la misma IP— que quien está votando. Con el bucket de
   * `votoVer`, revisar el link diez veces le comería el cupo al votante.
   *
   * El tope existe igual porque cada prueba llega hasta Postgres, pero es
   * holgado: no hay secreto que adivinar, el token es público y constante.
   */
  pruebaAcceso: { nombre: 'prueba_acceso', limite: 20, ventanaSegundos: 300 },
} as const satisfies Record<string, RateLimitRule>

/** Cuerpo estándar del 429. */
export const RESPUESTA_429 = {
  error: 'Demasiados intentos. Esperá un momento y volvé a probar.',
} as const
