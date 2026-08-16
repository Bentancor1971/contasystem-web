/**
 * GET /api/tracking/health
 *
 * Endpoint AUTENTICADO por `x-api-key` (no por sesión). Es el botón "probar
 * conexión" de Configuración Email en el desktop. Usa service_role.
 *
 * Alias de compatibilidad en `/api/health` — ver el comentario de ese archivo.
 */

import { handleHealth } from '@/lib/tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleHealth(req)
}
