/**
 * GET /api/certificados/[token]
 *
 * Endpoint PÚBLICO (sin auth). Valida un certificado por su token (el que va en
 * el QR). Usa service_role porque la tabla tiene RLS cerrado a anon.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCertificado } from '@/lib/certificados'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const admin = createAdminClient()
    const cert = await loadCertificado(admin, token)
    if (!cert) {
      return NextResponse.json({ error: 'Certificado no encontrado' }, { status: 404 })
    }
    return NextResponse.json(cert)
  } catch (err) {
    console.error('[GET /api/certificados/[token]] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
