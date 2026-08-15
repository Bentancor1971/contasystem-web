/**
 * POST /api/votacion/mesa/abrir   body: { llave }
 *
 * Paso 1 de montar la tablet: canjear la llave por los datos de la elección que
 * atiende. **No monta nada**: no escribe cookie y no deja la terminal abierta.
 *
 * Existe separado de `/montar` por una sola razón, y es la que más caro sale
 * equivocar: montar la terminal en la elección equivocada se descubre tarde,
 * con veinte votos adentro. Así el operador lee el nombre y las fechas y
 * confirma antes de largar la fila.
 *
 * La llave no vuelve nunca en la respuesta.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { abrirKiosco } from '@/lib/kiosco'
import { llaveNormalizada } from '@/lib/kiosco-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    let body: { llave?: unknown }
    try {
      body = (await req.json()) as { llave?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const admin = createAdminClient()
    // El tope corre ANTES de mirar la llave: cada intento cuenta, incluidos los
    // que ni llegan a la base por venir mal formados.
    if (!(await permitido(admin, req, LIMITES.kioscoAbrir))) {
      return json(RESPUESTA_429, 429)
    }

    const llave = llaveNormalizada(body.llave)
    if (llave === null) return json({ error: 'codigo_invalido' })

    return json(await abrirKiosco(admin, llave))
  } catch (err) {
    return errorInterno('POST /api/votacion/mesa/abrir', err)
  }
}
