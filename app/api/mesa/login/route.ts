/**
 * POST /api/mesa/login   body: { codigo, pin }
 *
 * Entrada al puesto de mesa. El código se imprime en la planilla; el PIN se
 * dicta aparte. Los dos los genera el desktop (src/routes/elecciones/mesas.tsx).
 *
 * La sesión que devuelve `mesa_login` NO sale en la respuesta: va derecho a una
 * cookie httpOnly. Es la llave del padrón entero de la elección, con documentos
 * adentro, y no tiene por qué existir en el JavaScript de la página.
 *
 * El bloqueo por mesa (5 fallos → 15 minutos) lo lleva la base. El tope por IP
 * de acá cubre lo otro: un PIN de 6 dígitos son 10⁶ combinaciones, y sin este
 * límite alguien podría barrer todas las mesas en paralelo sin bloquear ninguna.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { mesaLogin } from '@/lib/mesa'
import { guardarSesionMesa } from '@/lib/mesa-sesion'
import { codigoMesaValido, pinValido } from '@/lib/mesa-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    let body: { codigo?: unknown; pin?: unknown }
    try {
      body = (await req.json()) as { codigo?: unknown; pin?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const admin = createAdminClient()
    // El tope corre ANTES de evaluar el código y el PIN: cada intento cuenta,
    // incluidos los que ni llegan a la base por venir mal formados.
    if (!(await permitido(admin, req, LIMITES.mesaLogin))) {
      return json(RESPUESTA_429, 429)
    }

    // Un código con formato raro y un PIN equivocado salen por la misma puerta:
    // nada de lo que responde este handler dice si el código existe.
    if (!codigoMesaValido(body.codigo) || !pinValido(body.pin)) {
      return json({ error: 'pin_incorrecto' })
    }

    const r = await mesaLogin(admin, body.codigo, (body.pin as string).trim())
    if (r.sesion === null) return json(r.datos)

    const d = r.datos as Extract<typeof r.datos, { ok: true }>
    await guardarSesionMesa(r.sesion, {
      mesa_id: d.mesa.id,
      mesa: d.mesa.nombre,
      sede: d.mesa.sede,
      tramo_desde: d.mesa.tramo_desde,
      tramo_hasta: d.mesa.tramo_hasta,
      eleccion: d.eleccion.nombre,
      eleccion_id: d.eleccion.id,
      es_presidente: d.es_presidente,
    })

    return json(d)
  } catch (err) {
    return errorInterno('POST /api/mesa/login', err)
  }
}
