/**
 * GET /api/bajas — ALIAS de /api/tracking/bajas. No agregar lógica acá.
 *
 * Existe por lo mismo que `/api/events` y `/api/health`: la whitelist anti-SSRF
 * de `src-tauri/src/lib.rs` sólo acepta paths literales, y ese archivo se
 * compila dentro del ejecutable del desktop. La ruta real vive namespaceada al
 * lado del resto del tracking; esto es la puerta que el desktop sabe tocar.
 *
 * El día que haya que tocar Rust por otro motivo, se apunta el desktop a
 * `/api/tracking/bajas` y este archivo se borra.
 */

import { handleBajas } from '@/lib/bajas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleBajas(req)
}
