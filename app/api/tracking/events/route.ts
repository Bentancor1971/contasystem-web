/**
 * GET /api/tracking/events?since={iso}
 *
 * Endpoint AUTENTICADO por `x-api-key` (no por sesión). Lo consume el sync del
 * desktop para bajarse los eventos de su empresa. Usa service_role.
 *
 * Alias de compatibilidad en `/api/events` — ver el comentario de ese archivo.
 */

import { handleEvents } from '@/lib/tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleEvents(req)
}
