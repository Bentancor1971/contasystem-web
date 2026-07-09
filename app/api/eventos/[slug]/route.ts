/**
 * GET /api/eventos/[slug]
 *
 * Endpoint PÚBLICO (sin auth). Devuelve el evento + categorías para el
 * formulario de inscripción. Usa service_role porque las tablas tienen RLS
 * cerrado a anon.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEventoPublico } from '@/lib/eventos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    const admin = createAdminClient()
    const evento = await loadEventoPublico(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }
    return NextResponse.json(evento)
  } catch (err) {
    console.error('[GET /api/eventos/[slug]] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
