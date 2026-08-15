/**
 * POST /api/mesa/desmarcar   body: { habilitado_id, motivo }
 *
 * Para el error de tipeo, y sólo eso: la mesa deshace LO SUYO, mientras sigue
 * abierta, con motivo obligatorio. No se puede desmarcar un voto por internet
 * ni el de otra mesa —eso lo anula la comisión desde el desktop, que además lo
 * deja escrito en el acta—. Lo hace cumplir `mesa_desmarcar_voto`.
 */

import { mesaDesmarcarVoto } from '@/lib/mesa'
import { idValido } from '@/lib/mesa-types'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** El motivo se guarda recortado a 300 en la base; acá se frena lo absurdo. */
const MAX_MOTIVO = 300

export async function POST(req: Request) {
  try {
    let body: { habilitado_id?: unknown; motivo?: unknown }
    try {
      body = (await req.json()) as { habilitado_id?: unknown; motivo?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }
    if (!idValido(body.habilitado_id)) return json({ error: 'no_se_puede_desmarcar' })

    const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, MAX_MOTIVO) : ''
    if (motivo === '') return json({ error: 'motivo_requerido' })

    const s = await conSesion()
    if (!s.ok) return s.res

    return json(await mesaDesmarcarVoto(s.admin, s.sesion, body.habilitado_id, motivo))
  } catch (err) {
    return errorInterno('POST /api/mesa/desmarcar', err)
  }
}
