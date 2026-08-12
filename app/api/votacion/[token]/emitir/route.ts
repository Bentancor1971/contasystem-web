/**
 * POST /api/votacion/[token]/emitir
 * body: { digitos, selecciones: [{ papeleta_id, opcion_ids, en_blanco }] }
 *
 * Endpoint PÚBLICO. Registra el voto. Un voto no se deshace: no hay endpoint
 * para corregirlo ni para borrarlo. Si hace falta, lo anula la comisión
 * electoral desde el desktop y la persona vota con una credencial nueva.
 *
 * Este handler NO valida la boleta: la valida entera `emitir_voto` en la base
 * —segundo factor, ventana horaria contra el NOW() de Postgres, y min/max por
 * papeleta con opciones que existan y pertenezcan a esa papeleta—. Acá sólo se
 * recorta el payload a una forma sana para no mandar cualquier cosa al JSONB.
 */

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarConstanciaVoto } from '@/lib/eleccion-constancia'
import { emitirVoto, ocultarInexistente } from '@/lib/elecciones'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import {
  digitosValidos,
  tokenValido,
  type SeleccionPapeleta,
} from '@/lib/elecciones-types'
import { SIN_CACHE } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Techos de tamaño. Una boleta real tiene un puñado de papeletas y opciones. */
const MAX_PAPELETAS = 100
const MAX_OPCIONES = 200

/** Normaliza el payload. `null` = venía con una forma que no se puede usar. */
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
      // Duplicados fuera acá también: la base los descarta con DISTINCT, pero
      // así lo que se guarda en `votos_remoto` es lo mismo que se validó.
      opcion_ids: Array.from(new Set(opcion_ids as string[])),
      en_blanco: o.en_blanco === true,
    })
  }
  return out
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: { digitos?: unknown; selecciones?: unknown }
    try {
      body = (await req.json()) as { digitos?: unknown; selecciones?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }

    const digitos = digitosValidos(body.digitos)
    if (!tokenValido(token) || digitos === null) {
      // Mismo criterio que /validar: nada de lo que sale de acá dice si la
      // credencial existe.
      return NextResponse.json({ error: 'digitos_incorrectos' }, { headers: SIN_CACHE })
    }

    const selecciones = parseSelecciones(body.selecciones)
    if (selecciones === null) {
      return NextResponse.json({ error: 'Selección inválida' }, { status: 400, headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.votoEmitir))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(await emitirVoto(admin, token, digitos, selecciones))

    // Constancia por mail. Va con `after()`: corre una vez respondida esta
    // petición, así la pantalla de quien votó no espera al SMTP. Si falla, el
    // voto igual está registrado y la constancia queda pendiente para el
    // desktop — por eso no se espera el resultado ni se refleja en la respuesta.
    if ('ok' in r && r.ok === true) {
      const votoId = r.voto_id
      if (votoId) after(() => enviarConstanciaVoto(admin, votoId))
    }

    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/votacion/[token]/emitir] error:', err)
    // 500 sin detalle. El cliente lo trata como "no sabemos si llegó" y ofrece
    // verificar contra /estado — nunca como "no se registró".
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
