/**
 * Pieza compartida por los route handlers de la terminal de mesa.
 * No es una ruta: en el App Router sólo `route.ts` lo es.
 *
 * Todo lo que atiende votantes sale de la cookie `kiosco_sesion`: ninguna de
 * estas rutas acepta un `eleccion_id` por body. La sesión es la que decide qué
 * elección está atendiendo esta tablet, y por eso no hay forma de pedirle a
 * esta API que abra un voto de otra.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerSesionKiosco, terminalVigente, type SesionKiosco } from '@/lib/kiosco'

/** Nada de la terminal se cachea. Un `ya_voto` cacheado es un voto perdido. */
export const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE })
}

/** Un 500 no dice nada de más y el cliente lo trata como "no sabemos si llegó". */
export function errorInterno(donde: string, err: unknown) {
  console.error(`[${donde}] error:`, err)
  return json({ error: 'Error interno' }, 500)
}

/**
 * La clave con la que se cuentan los topes de esta terminal.
 *
 * Elección + terminal, y no la IP: es lo que compra la llave. Dos mesas del
 * mismo local salen por la misma conexión y tienen que contar por separado.
 */
export function claveTerminal(s: SesionKiosco): string {
  return `${s.eleccion_id}:${s.terminal}`
}

/**
 * Resuelve la terminal montada en este dispositivo, revalidada contra la nube.
 *
 * Devuelve el 401 ya armado cuando no hay o dejó de haber: el cliente lo
 * reconoce por `error: 'sesion_invalida'` y vuelve a la pantalla de montaje. Es
 * el camino por el que "Regenerar" y "Cerrar terminal" del desktop tumban una
 * tablet que está en otro edificio.
 */
export async function conTerminal(): Promise<
  { ok: true; admin: SupabaseClient; sesion: SesionKiosco } | { ok: false; res: NextResponse }
> {
  const sesion = await leerSesionKiosco()
  if (!sesion) {
    return { ok: false, res: json({ error: 'sesion_invalida' }, 401) }
  }

  const admin = createAdminClient()
  if (!(await terminalVigente(admin, sesion))) {
    return { ok: false, res: json({ error: 'sesion_invalida' }, 401) }
  }

  return { ok: true, admin, sesion }
}
