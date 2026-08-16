/**
 * GET /api/tracking/bajas — las bajas de comunicación, para que el desktop las
 * baje y las aplique a su padrón local.
 *
 * Autenticado con `x-api-key`, igual que `/api/tracking/events`. El alias que
 * el desktop realmente toca es `/api/bajas`, por la whitelist anti-SSRF de
 * `src-tauri/src/lib.rs`.
 */

import { handleBajas } from '@/lib/bajas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleBajas(req)
}
