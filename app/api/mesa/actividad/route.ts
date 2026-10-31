/**
 * POST /api/mesa/actividad   body: { tocar: boolean }
 *
 * El latido del puesto (79_). La pantalla lo manda con `tocar: true` cuando
 * alguien la usa —toque o tecla, como mucho uno cada 20 s— y con `tocar: false`
 * cada 30 s, sólo para enterarse de cuándo vence y de si la comisión cerró la
 * sesión o cambió los minutos.
 *
 * Los refrescos automáticos del padrón NO cuentan como actividad: si contaran,
 * una tablet olvidada arriba de la mesa no se cerraría nunca.
 *
 * Sin 79_ en la base contesta `{ ok: true, sin_control: true }` y la pantalla
 * no vigila nada.
 */

import { mesaActividad } from '@/lib/mesa'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const s = await conSesion()
    if (!s.ok) return s.res

    let tocar = true
    try {
      const body = (await req.json()) as { tocar?: unknown }
      tocar = body.tocar !== false
    } catch {
      // Sin body se toma como actividad: es lo que manda un toque.
    }

    const r = await mesaActividad(s.admin, s.sesion, tocar)
    if (r === null) return json({ ok: true, sin_control: true })
    return json(r)
  } catch (err) {
    return errorInterno('POST /api/mesa/actividad', err)
  }
}
