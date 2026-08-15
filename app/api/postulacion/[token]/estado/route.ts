/**
 * POST /api/postulacion/[token]/estado   body: {}
 *
 * Endpoint PÚBLICO, sólo de lectura. Contesta una única pregunta: ¿figura
 * anotada esta credencial?
 *
 * Existe para el caso ambiguo: el envío se cortó y nadie sabe si llegó. Sin
 * esto, la pantalla sólo puede decir "no sabemos" y la persona termina apretando
 * de nuevo a ciegas. No devuelve nada más —ni nombre, ni deuda, ni cuántos van—:
 * es la misma información que ya trae abrir el link, y ninguna otra.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarConvocatoria } from '@/lib/convocatorias'
import { esError, tokenValido } from '@/lib/convocatorias-types'
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
      return NextResponse.json({ error: 'credencial_inexistente' }, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.postulacionVer))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = await buscarConvocatoria(admin, token)
    if (esError(r)) return NextResponse.json(r, { headers: SIN_CACHE })

    return NextResponse.json(
      { ok: true, ya_postulado: r.ya_postulado },
      { headers: SIN_CACHE },
    )
  } catch (err) {
    console.error('[POST /api/postulacion/[token]/estado] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
