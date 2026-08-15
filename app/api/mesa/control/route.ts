/**
 * GET /api/mesa/control
 *
 * El control de urna: marcas ≟ sobres ≟ recuento. Es lo que tiene que estar a
 * la vista ANTES de confirmar el cierre —si la mesa marcó 143 personas y contó
 * 141 sobres, eso se revisa mientras todavía hay gente ahí—.
 *
 * No suma nada de otras mesas y no existe endpoint que lo haga: el recuento que
 * carga una mesa es de esa mesa. Los resultados salen del acta, en el desktop.
 */

import { mesaControl } from '@/lib/mesa'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const s = await conSesion()
    if (!s.ok) return s.res

    return json(await mesaControl(s.admin, s.sesion))
  } catch (err) {
    return errorInterno('GET /api/mesa/control', err)
  }
}
