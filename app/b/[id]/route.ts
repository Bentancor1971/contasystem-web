/**
 * GET  /b/{slug}_{historial_id} — página de confirmación de baja. No escribe.
 * POST /b/{slug}_{historial_id} — registra la baja.
 *
 * Endpoint PÚBLICO (sin auth): lo abre el destinatario del mail, que nunca
 * tiene sesión. Usa service_role (RLS cerrado a anon).
 *
 * El GET no escribe a propósito: los escáneres antispam corporativos abren
 * todos los links de un mail antes de entregarlo. Ver `lib/bajas.ts`.
 */

import { handleBajaPagina, handleBajaRegistrar } from '@/lib/bajas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleBajaPagina(id)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleBajaRegistrar(id, req)
}
