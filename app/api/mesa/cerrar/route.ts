/**
 * POST /api/mesa/cerrar   body: { filas, sobres_en_urna, observacion? }
 *
 * Cierra la urna: irreversible desde la web, y mata las sesiones de esa mesa
 * (incluida la de quien lo aprieta). Sólo con PIN de presidente.
 *
 * Desde 76_ (§1.4) se cierra CON LO QUE SE VE: la pantalla manda la grilla que
 * el presidente está mirando y `mesa_cerrar_con_recuento` la guarda y cierra en
 * la misma transacción. Antes se cerraba con lo último guardado, y una
 * corrección sin guardar se perdía sin aviso. Si el cierre no procede, el
 * guardado también se deshace.
 *
 * Si los sobres no coinciden con las marcas, la base devuelve
 * `requiere_observacion`; si todavía no es la hora de cierre de la elección,
 * `requiere_observacion_cierre_anticipado` (76_, §2). En los dos casos hay que
 * reintentar con el texto. **No bloquea el cierre**: una mesa que no se puede
 * cerrar a las once de la noche se termina esquivando en papel, y ahí sí se
 * pierde el dato.
 *
 * Un body sin `filas` es de una pantalla cargada antes de este cambio: se
 * cierra como antes, con lo guardado.
 *
 * Después de cerrar se borran las cookies del puesto: la sesión ya no sirve y
 * dejarla puesta sólo produciría un `sesion_invalida` en la próxima pantalla.
 */

import { mesaCerrar, mesaCerrarConRecuento } from '@/lib/mesa'
import { borrarSesionMesa } from '@/lib/mesa-sesion'
import { parseFilasRecuento } from '@/lib/mesa-types'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_OBSERVACION = 1000
/** Mismo techo que el recuento: frena el dedo pegado, no al operador. */
const MAX_SOBRES = 100000

export async function POST(req: Request) {
  try {
    let body: { filas?: unknown; sobres_en_urna?: unknown; observacion?: unknown }
    try {
      body = (await req.json()) as { filas?: unknown; sobres_en_urna?: unknown; observacion?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const n =
      typeof body.sobres_en_urna === 'number' ? body.sobres_en_urna : Number(body.sobres_en_urna)
    if (!Number.isFinite(n) || n < 0 || n > MAX_SOBRES) {
      return json({ error: 'sobres_invalidos' }, 400)
    }

    const conFilas = body.filas !== undefined
    const filas = conFilas ? parseFilasRecuento(body.filas) : null
    if (conFilas && filas === null) return json({ error: 'recuento_invalido' }, 400)

    const obs =
      typeof body.observacion === 'string'
        ? body.observacion.trim().slice(0, MAX_OBSERVACION)
        : ''
    const observacion = obs === '' ? null : obs

    const s = await conSesion()
    if (!s.ok) return s.res

    const r = filas
      ? await mesaCerrarConRecuento(s.admin, s.sesion, filas, Math.trunc(n), observacion)
      : await mesaCerrar(s.admin, s.sesion, Math.trunc(n), observacion)
    if ('ok' in r && r.ok === true) await borrarSesionMesa()

    return json(r)
  } catch (err) {
    return errorInterno('POST /api/mesa/cerrar', err)
  }
}
