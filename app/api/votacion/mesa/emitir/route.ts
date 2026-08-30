/**
 * POST /api/votacion/mesa/emitir   body: { pase, digitos, selecciones }
 *
 * Registra el voto emitido en la terminal. Un voto no se deshace: no hay
 * endpoint para corregirlo ni para borrarlo.
 *
 * Este handler NO valida la boleta: la valida entera `emitir_voto` en la base
 * —segundo factor, ventana horaria contra el NOW() de Postgres, y min/max por
 * papeleta—. Acá sólo se recorta el payload a una forma sana.
 *
 * Usa `emitir_voto_kiosco` (61_, E5a): en la MISMA transacción, prende la
 * exención del cierre del canal web, llama a `emitir_voto` y marca el voto con
 * el nombre de esta terminal — antes eran dos llamadas separadas (`emitir_voto`
 * + `marcar_voto_kiosco` aparte) y sin la exención, así que un voto de terminal
 * después de cerrado el canal web se rechazaba igual que uno de `/v`. Sin 61_
 * aplicado, `emitirVotoKiosco` cae sola a ese camino de siempre.
 */

import { after } from 'next/server'
import { enviarConstanciaVoto } from '@/lib/eleccion-constancia'
import { digitosValidos, type SeleccionPapeleta } from '@/lib/elecciones-types'
import { emitirVotoKiosco, leerPase } from '@/lib/kiosco'
import { LIMITES, permitidoPorClave, RESPUESTA_429 } from '@/lib/rate-limit'
import { claveTerminal, conTerminal, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Techos de tamaño. Una boleta real tiene un puñado de papeletas y opciones. */
const MAX_PAPELETAS = 100
const MAX_OPCIONES = 200

/**
 * Normaliza el payload. `null` = venía con una forma que no se puede usar.
 *
 * Gemelo del de `app/api/votacion/[token]/emitir/route.ts`. Está duplicado y no
 * compartido a propósito: el pedido del modo mesa es no tocar esa ruta, que es
 * la que atiende a todo el que vota desde su casa. Los dos recortan lo mismo, y
 * quien decide de verdad es `emitir_voto`, que revalida todo en la base.
 */
function parseSelecciones(v: unknown): SeleccionPapeleta[] | null {
  if (!Array.isArray(v) || v.length > MAX_PAPELETAS) return null
  const out: SeleccionPapeleta[] = []
  for (const s of v) {
    if (!s || typeof s !== 'object') return null
    const o = s as Record<string, unknown>
    if (typeof o.papeleta_id !== 'string' || o.papeleta_id === '') return null
    const ids = o.opcion_ids
    if (ids !== undefined && !Array.isArray(ids)) return null
    const opcion_ids = Array.isArray(ids) ? ids : []
    if (opcion_ids.length > MAX_OPCIONES) return null
    if (!opcion_ids.every((x) => typeof x === 'string' && x !== '')) return null
    out.push({
      papeleta_id: o.papeleta_id,
      opcion_ids: Array.from(new Set(opcion_ids as string[])),
      en_blanco: o.en_blanco === true,
    })
  }
  return out
}

export async function POST(req: Request) {
  try {
    const t = await conTerminal()
    if (!t.ok) return t.res

    let body: { pase?: unknown; digitos?: unknown; selecciones?: unknown }
    try {
      body = (await req.json()) as {
        pase?: unknown
        digitos?: unknown
        selecciones?: unknown
      }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    if (!(await permitidoPorClave(t.admin, claveTerminal(t.sesion), LIMITES.kioscoEmitir))) {
      return json(RESPUESTA_429, 429)
    }

    const token = leerPase(body.pase, t.sesion.eleccion_id)
    if (!token) return json({ error: 'pase_vencido' })

    const digitos = digitosValidos(body.digitos)
    if (digitos === null) return json({ error: 'digitos_incorrectos' })

    const selecciones = parseSelecciones(body.selecciones)
    if (selecciones === null) return json({ error: 'Selección inválida' }, 400)

    const r = await emitirVotoKiosco(t.admin, token, digitos, selecciones, t.sesion.terminal)
    if (!('ok' in r) || r.ok !== true) return json(r)

    // Constancia por mail, si la credencial tiene dirección. Va con `after()`:
    // corre una vez respondida esta petición, así la fila no espera al SMTP.
    if (r.voto_id) {
      const votoId = r.voto_id
      after(() => enviarConstanciaVoto(t.admin, votoId))
    }

    // El `voto_id` no vuelve al browser: en la terminal no hay nada que hacer
    // con él, y esta pantalla la va a ver el votante siguiente.
    return json({ ok: true, emitido_at: r.emitido_at })
  } catch (err) {
    return errorInterno('POST /api/votacion/mesa/emitir', err)
  }
}
