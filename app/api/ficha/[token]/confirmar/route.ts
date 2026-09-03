/**
 * POST /api/ficha/[token]/confirmar   body: { factor }
 *
 * Endpoint PÚBLICO. "Revisé mis datos y están bien, no cambio nada": sella
 * confirmado_at en la credencial y descarta la propuesta pendiente de este
 * mismo token si había (confirmar lo registrado la vuelve obsoleta). No pasa
 * por la cola de validación del desktop porque no hay nada que validar — el
 * desk se entera en el próximo pull y el reporte lo muestra como "Confirmado".
 *
 * `confirmar_ficha` revalida el factor, como guardar.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { confirmarFicha, ocultarInexistente } from '@/lib/ficha'
import { tokenValido } from '@/lib/ficha-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { factorDelBody, SIN_CACHE } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: { factor?: unknown }
    try {
      body = (await req.json()) as { factor?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }

    const factor = factorDelBody(body.factor)
    if (!tokenValido(token) || factor === null) {
      return NextResponse.json({ error: 'factor_incorrecto' }, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.fichaConfirmar))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(await confirmarFicha(admin, token, factor))
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/ficha/[token]/confirmar] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
