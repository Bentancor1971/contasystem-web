/**
 * POST /api/mesa/recuento   body: { filas: [{ papeleta_id, opcion_id, es_blanco, es_anulado, cantidad }] }
 *
 * Guarda el recuento manual de la urna. Set atómico por mesa: `mesa_recuento_
 * guardar` borra lo que había y escribe lo que llega, así que cargar dos veces
 * no duplica y corregir un número es volver a mandar todo.
 *
 * Sólo con PIN de presidente, y eso lo decide la base (`_mesa_es_presidente`),
 * no la cookie de la pantalla.
 */

import { mesaRecuentoGuardar } from '@/lib/mesa'
import { idValido, type FilaRecuento } from '@/lib/mesa-types'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Techos de tamaño. Una boleta real tiene un puñado de papeletas y opciones. */
const MAX_FILAS = 2000
/** Ningún club tiene una mesa con más votos que esto. Frena el dedo pegado. */
const MAX_CANTIDAD = 100000

/** Normaliza el payload. `null` = vino con una forma que no se puede usar. */
function parseFilas(v: unknown): FilaRecuento[] | null {
  if (!Array.isArray(v) || v.length > MAX_FILAS) return null
  const out: FilaRecuento[] = []
  for (const f of v) {
    if (!f || typeof f !== 'object') return null
    const o = f as Record<string, unknown>
    if (!idValido(o.papeleta_id)) return null

    const opcion = o.opcion_id
    if (opcion !== null && opcion !== undefined && !idValido(opcion)) return null

    const n = typeof o.cantidad === 'number' ? o.cantidad : Number(o.cantidad)
    if (!Number.isFinite(n) || n < 0 || n > MAX_CANTIDAD) return null

    out.push({
      papeleta_id: o.papeleta_id,
      opcion_id: typeof opcion === 'string' ? opcion : null,
      es_blanco: o.es_blanco === true,
      es_anulado: o.es_anulado === true,
      cantidad: Math.trunc(n),
    })
  }
  return out
}

export async function POST(req: Request) {
  try {
    let body: { filas?: unknown }
    try {
      body = (await req.json()) as { filas?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const filas = parseFilas(body.filas)
    // Código, no una frase: así `mensajeErrorMesa` (lib/mesa-types.ts) le puede
    // poner un texto que dice qué corregir, en vez del genérico "no pudimos
    // completar la operación" al que cae cualquier código que no reconoce.
    if (filas === null) return json({ error: 'recuento_invalido' }, 400)

    const s = await conSesion()
    if (!s.ok) return s.res

    return json(await mesaRecuentoGuardar(s.admin, s.sesion, filas))
  } catch (err) {
    return errorInterno('POST /api/mesa/recuento', err)
  }
}
