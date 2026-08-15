/**
 * POST /api/mesa/cerrar   body: { sobres_en_urna, observacion? }
 *
 * Cierra la urna: irreversible desde la web, y mata las sesiones de esa mesa
 * (incluida la de quien lo aprieta). Sólo con PIN de presidente.
 *
 * Si los sobres no coinciden con las marcas, `mesa_cerrar` devuelve
 * `requiere_observacion` y hay que reintentar con el texto. **No bloquea el
 * cierre**: una mesa que no se puede cerrar a las once de la noche se termina
 * esquivando en papel, y ahí sí se pierde el dato.
 *
 * Después de cerrar se borran las cookies del puesto: la sesión ya no sirve y
 * dejarla puesta sólo produciría un `sesion_invalida` en la próxima pantalla.
 */

import { mesaCerrar } from '@/lib/mesa'
import { borrarSesionMesa } from '@/lib/mesa-sesion'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_OBSERVACION = 1000
/** Mismo techo que el recuento: frena el dedo pegado, no al operador. */
const MAX_SOBRES = 100000

export async function POST(req: Request) {
  try {
    let body: { sobres_en_urna?: unknown; observacion?: unknown }
    try {
      body = (await req.json()) as { sobres_en_urna?: unknown; observacion?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const n =
      typeof body.sobres_en_urna === 'number' ? body.sobres_en_urna : Number(body.sobres_en_urna)
    if (!Number.isFinite(n) || n < 0 || n > MAX_SOBRES) {
      return json({ error: 'sobres_invalidos' }, 400)
    }

    const obs =
      typeof body.observacion === 'string'
        ? body.observacion.trim().slice(0, MAX_OBSERVACION)
        : ''

    const s = await conSesion()
    if (!s.ok) return s.res

    const r = await mesaCerrar(s.admin, s.sesion, Math.trunc(n), obs === '' ? null : obs)
    if ('ok' in r && r.ok === true) await borrarSesionMesa()

    return json(r)
  } catch (err) {
    return errorInterno('POST /api/mesa/cerrar', err)
  }
}
