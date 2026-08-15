/**
 * Pieza compartida por los route handlers de la mesa del local.
 * No es una ruta: en el App Router sólo `route.ts` lo es.
 *
 * Todo lo de `/api/mesa/` sale de la cookie `mesa_sesion`. Nada acepta un
 * identificador de elección ni de mesa por body: la sesión es la que decide de
 * qué elección se está hablando, y por eso no hay forma de pedirle a esta API
 * el padrón de otra.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerSesionMesa } from '@/lib/mesa-sesion'

/** Ninguna respuesta de mesa se cachea: un padrón cacheado es un doble voto. */
export const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE })
}

/**
 * Resuelve la sesión de la cookie. Devuelve la respuesta 401 ya armada cuando
 * no hay: el cliente la reconoce por `error: 'sesion_invalida'` y manda a /mesa.
 */
export async function conSesion(): Promise<
  { ok: true; admin: SupabaseClient; sesion: string } | { ok: false; res: NextResponse }
> {
  const sesion = await leerSesionMesa()
  if (!sesion) {
    return { ok: false, res: json({ error: 'sesion_invalida' }, 401) }
  }
  return { ok: true, admin: createAdminClient(), sesion }
}

/** Un 500 no dice nada de más y el cliente lo trata como "no sabemos si llegó". */
export function errorInterno(donde: string, err: unknown) {
  console.error(`[${donde}] error:`, err)
  return json({ error: 'Error interno' }, 500)
}
