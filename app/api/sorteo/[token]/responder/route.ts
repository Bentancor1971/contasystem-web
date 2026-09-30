/**
 * POST /api/sorteo/[token]/responder   body: { acepta: boolean }
 *
 * Endpoint PÚBLICO. El favorecido de un sorteo confirma o rechaza su cupo.
 * `responder_confirmacion_sorteo` hace cumplir todo: una sola respuesta,
 * dentro del plazo (fecha de Montevideo) y con el cupo todavía abierto en el
 * desktop. Una respuesta es definitiva desde acá; un cambio lo hace la
 * secretaría. El desktop la baja con el poller, como las inscripciones.
 *
 * Un GET nunca responde: los links del mail sólo abren la página, porque los
 * antivirus de correo siguen los links solos.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { responderConfirmacionSorteo } from '@/lib/sorteo-confirmacion'
import { tokenValido } from '@/lib/sorteo-confirmacion-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: { acepta?: unknown }
    try {
      body = (await req.json()) as { acepta?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }
    if (!tokenValido(token)) {
      return NextResponse.json({ error: 'credencial_inexistente' }, { headers: SIN_CACHE })
    }
    if (typeof body.acepta !== 'boolean') {
      return NextResponse.json({ error: 'respuesta_invalida' }, { status: 400, headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.sorteoResponder))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = await responderConfirmacionSorteo(admin, token, body.acepta)
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/sorteo/[token]/responder] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
