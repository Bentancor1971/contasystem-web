/**
 * POST /api/mesa/marcar   body: { habilitado_id }
 *
 * Registra que esa persona votó. Es la acción irreversible del día desde la
 * web: se deshace con /desmarcar mientras la mesa siga abierta, y después sólo
 * desde el desktop.
 *
 * La barrera contra el doble voto es el UPDATE condicionado de
 * `mesa_marcar_voto`: dos dispositivos que marcan a la misma persona en el
 * mismo segundo compiten por la misma fila y gana uno solo. El otro recibe
 * `ya_voto` con dónde y cuándo, que es lo que el operador lee en el mostrador.
 */

import { mesaMarcarVoto } from '@/lib/mesa'
import { idValido } from '@/lib/mesa-types'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    let body: { habilitado_id?: unknown }
    try {
      body = (await req.json()) as { habilitado_id?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }
    if (!idValido(body.habilitado_id)) return json({ error: 'no_esta_en_padron' })

    const s = await conSesion()
    if (!s.ok) return s.res

    return json(await mesaMarcarVoto(s.admin, s.sesion, body.habilitado_id))
  } catch (err) {
    return errorInterno('POST /api/mesa/marcar', err)
  }
}
