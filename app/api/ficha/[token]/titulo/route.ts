/**
 * POST /api/ficha/[token]/titulo   body: { factor }
 *
 * Endpoint PÚBLICO. Emite el signed upload URL para que el browser suba el
 * título en PDF DIRECTO a Storage (el archivo no pasa por Vercel). El path es
 * canónico —{empresa_id}/{token}.pdf— y lo arma el server: nada del body
 * decide dónde cae el archivo.
 *
 * Revalida el factor con `validar_credencial_ficha` (mismo criterio que
 * guardar: no confía en que /validar haya ocurrido) y sólo emite si la
 * membresía dice `titulo_aplica` — a un estudiante no se le recibe título.
 *
 * La subida en sí la controla el bucket (10 MB, application/pdf) y el token
 * firmado (una ruta, una vez, expira solo). El PDF recién "cuenta" cuando
 * guardar lo verifica en Storage e inyecta cambios.titulo_pdf.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { crearSubidaTitulo, ocultarInexistente, validarCredencialFicha } from '@/lib/ficha'
import { esError, tokenValido } from '@/lib/ficha-types'
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
    if (!(await permitido(admin, req, LIMITES.fichaTitulo))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(await validarCredencialFicha(admin, token, factor))
    if (esError(r)) {
      return NextResponse.json(r, { headers: SIN_CACHE })
    }
    if (!r.membresia.titulo_aplica) {
      return NextResponse.json({ error: 'titulo_no_aplica' }, { headers: SIN_CACHE })
    }

    const subida = await crearSubidaTitulo(admin, r.empresa_id, token)
    if ('error' in subida) {
      return NextResponse.json(subida, { status: 500, headers: SIN_CACHE })
    }
    return NextResponse.json({ ok: true, ...subida }, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/ficha/[token]/titulo] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
