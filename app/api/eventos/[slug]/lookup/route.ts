/**
 * POST /api/eventos/[slug]/lookup   body: { documento }
 *
 * Endpoint PÚBLICO. Resuelve la cédula contra el registro del evento y devuelve
 * quién es + el tipo de participante que le corresponde (socio / no_socio),
 * aplicando la regla de cuotas del evento. Usa service_role (RLS cerrado a anon).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEventoRemotoBySlug, resolverParticipante } from '@/lib/eventos'
import { normalizeDocumento } from '@/lib/documento'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  documento?: unknown
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const documentoRaw = typeof body.documento === 'string' ? body.documento : ''
    if (normalizeDocumento(documentoRaw).length < 6) {
      return NextResponse.json({ error: 'Cédula inválida' }, { status: 400 })
    }

    const admin = createAdminClient()
    const evento = await loadEventoRemotoBySlug(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }

    const r = await resolverParticipante(admin, evento, documentoRaw)
    return NextResponse.json(r)
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/lookup] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
