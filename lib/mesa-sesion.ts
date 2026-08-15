/**
 * La sesión de mesa, en cookies. SOLO server-side.
 *
 * Dos cookies, las dos `httpOnly`:
 *
 *  · `mesa_sesion` — el UUID que devuelve `mesa_login`. **Es la llave del padrón
 *    entero de la elección**: nunca en la URL, nunca en localStorage, nunca en
 *    el HTML. Sólo la leen los route handlers para pasársela a las RPC.
 *
 *  · `mesa_info` — nombre de la mesa, sede, elección y `es_presidente`, para que
 *    las pantallas se dibujen sin una consulta extra (no hay RPC de "quién soy":
 *    esos datos vienen una sola vez, en el login).
 *
 * `mesa_info` es COSMÉTICA y así hay que tratarla. Va httpOnly para que el
 * browser no la toque, pero una cookie es del cliente al fin y al cabo: quien
 * la falsee vería los botones de presidente y nada más, porque `mesa_recuento_
 * guardar` y `mesa_cerrar` revalidan `_mesa_es_presidente(sesion)` contra la
 * base. Ningún permiso se decide con esta cookie.
 */

import { cookies } from 'next/headers'

export const COOKIE_SESION = 'mesa_sesion'
export const COOKIE_INFO = 'mesa_info'

/** La sesión de la base dura 12 horas; la cookie no tiene por qué durar más. */
const HORAS = 12

export interface InfoMesa {
  mesa_id: string
  mesa: string
  sede: string | null
  tramo_desde: string | null
  tramo_hasta: string | null
  eleccion: string
  eleccion_id: string
  es_presidente: boolean
}

function opciones() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: HORAS * 60 * 60,
  }
}

/** El UUID de sesión, o `null`. Todo lo que llama a una RPC de mesa empieza acá. */
export async function leerSesionMesa(): Promise<string | null> {
  const c = await cookies()
  const v = c.get(COOKIE_SESION)?.value
  return v && v.trim() !== '' ? v : null
}

/** Los datos de la mesa para dibujar la pantalla. `null` si no hay o está rota. */
export async function leerInfoMesa(): Promise<InfoMesa | null> {
  const c = await cookies()
  const v = c.get(COOKIE_INFO)?.value
  if (!v) return null
  try {
    const d = JSON.parse(v) as Partial<InfoMesa>
    if (typeof d.mesa !== 'string' || d.mesa === '') return null
    return {
      mesa_id: String(d.mesa_id ?? ''),
      mesa: d.mesa,
      sede: d.sede ?? null,
      tramo_desde: d.tramo_desde ?? null,
      tramo_hasta: d.tramo_hasta ?? null,
      eleccion: String(d.eleccion ?? ''),
      eleccion_id: String(d.eleccion_id ?? ''),
      es_presidente: d.es_presidente === true,
    }
  } catch {
    return null
  }
}

/** Sólo desde un route handler: un Server Component no puede escribir cookies. */
export async function guardarSesionMesa(sesion: string, info: InfoMesa): Promise<void> {
  const c = await cookies()
  c.set(COOKIE_SESION, sesion, opciones())
  c.set(COOKIE_INFO, JSON.stringify(info), opciones())
}

export async function borrarSesionMesa(): Promise<void> {
  const c = await cookies()
  c.set(COOKIE_SESION, '', { ...opciones(), maxAge: 0 })
  c.set(COOKIE_INFO, '', { ...opciones(), maxAge: 0 })
}
