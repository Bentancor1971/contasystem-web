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
import { parseFilasRecuento } from '@/lib/mesa-types'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Compartido con /api/mesa/cerrar, que guarda y cierra en una sola operación (76_). */
const parseFilas = parseFilasRecuento

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
