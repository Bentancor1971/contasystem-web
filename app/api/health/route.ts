/**
 * GET /api/health — ALIAS de /api/tracking/health. No agregar lógica acá.
 *
 * Misma razón que `/api/events`: la whitelist de `src-tauri/src/lib.rs` sólo
 * acepta este path literal. Ver el comentario de aquel archivo.
 *
 * Ojo con el nombre: esto NO es un healthcheck del sitio. Responde por la
 * configuración de tracking de una empresa y pide `x-api-key`.
 */

import { handleHealth } from '@/lib/tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleHealth(req)
}
