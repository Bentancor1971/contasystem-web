/**
 * POST /api/mesa/salir
 *
 * Borra las cookies del puesto. La sesión sigue viva en la base hasta que
 * vence o hasta que se cierra la urna —no hay RPC para matarla— pero sin la
 * cookie este dispositivo ya no la tiene: es lo que se necesita cuando alguien
 * deja el celular sobre el mostrador y se va.
 */

import { borrarSesionMesa } from '@/lib/mesa-sesion'
import { errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await borrarSesionMesa()
    return json({ ok: true })
  } catch (err) {
    return errorInterno('POST /api/mesa/salir', err)
  }
}
