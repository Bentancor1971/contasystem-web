/**
 * POST /api/votacion/mesa/montar   body: { llave, terminal }
 *
 * Paso 2: deja la tablet montada para atender votantes.
 *
 * La llave se revalida acá aunque `/abrir` ya la haya validado: entre los dos
 * pasos hay una persona confirmando, y nada de lo que dijo el navegador cuenta
 * como prueba de nada. Si el desktop regeneró la llave en el medio, el montaje
 * falla, que es lo correcto.
 *
 * La sesión se escribe en una cookie httpOnly **firmada**, y adentro no va la
 * llave sino su huella. Ver `lib/kiosco.ts`.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { abrirKiosco, guardarSesionKiosco } from '@/lib/kiosco'
import { llaveNormalizada, nombreTerminalNormalizado } from '@/lib/kiosco-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    let body: { llave?: unknown; terminal?: unknown }
    try {
      body = (await req.json()) as { llave?: unknown; terminal?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.kioscoAbrir))) {
      return json(RESPUESTA_429, 429)
    }

    const llave = llaveNormalizada(body.llave)
    if (llave === null) return json({ error: 'codigo_invalido' })

    // El nombre es lo que después se imprime en el acta: una terminal sin
    // nombre no se puede distinguir de otra a la hora de contar.
    const terminal = nombreTerminalNormalizado(body.terminal)
    if (terminal === null) return json({ error: 'terminal_invalida' })

    const r = await abrirKiosco(admin, llave)
    if ('error' in r) return json(r)

    await guardarSesionKiosco(r, terminal, llave)
    return json({ ok: true, eleccion: r.nombre, eleccion_id: r.eleccion_id, terminal })
  } catch (err) {
    return errorInterno('POST /api/votacion/mesa/montar', err)
  }
}
