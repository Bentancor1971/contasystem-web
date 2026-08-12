/**
 * POST /api/votacion/[token]/estado
 *
 * Endpoint PÚBLICO. Espejo de `buscar_credencial`: el mismo estado que resuelve
 * la portada de `/v/[token]` al renderizar, pero consultable sin recargar.
 *
 * Existe por un caso concreto: si el fetch de `emitir` se corta a mitad, la
 * persona no sabe si su voto quedó registrado —y la web no puede afirmar que no,
 * porque el request pudo haber llegado igual—. Este endpoint es el que responde
 * esa pregunta (`ya_voto`) sin pedir dígitos de nuevo.
 *
 * NO devuelve nombre del votante ni boleta: eso sale de `validar_credencial`,
 * después del segundo factor.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarCredencial } from '@/lib/elecciones'
import { tokenValido } from '@/lib/elecciones-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { SIN_CACHE } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    if (!tokenValido(token)) {
      return NextResponse.json({ error: 'credencial_inexistente' }, { status: 200, headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.votoVer))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const estado = await buscarCredencial(admin, token)
    return NextResponse.json(estado, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/votacion/[token]/estado] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
