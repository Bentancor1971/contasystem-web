/**
 * GET /api/events — ALIAS de /api/tracking/events. No agregar lógica acá.
 *
 * Existe por el desktop: `src-tauri/src/lib.rs` tiene una whitelist de endpoints
 * contra SSRF que sólo acepta, literales, `/api/events` y `/api/health`. Cambiar
 * eso obliga a recompilar y redistribuir la app de escritorio, así que la ruta
 * real vive namespaceada —legible al lado de `/api/eventos`, que es otra cosa
 * completamente: inscripciones— y esto es la puerta que el desktop sabe tocar.
 *
 * El día que haya que tocar Rust por otro motivo, se apunta el desktop a
 * `/api/tracking/events` y este archivo se borra.
 */

import { handleEvents } from '@/lib/tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleEvents(req)
}
