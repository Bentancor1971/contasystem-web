/**
 * Cliente Supabase admin (service_role). SOLO server-side.
 *
 * ⚠️ NUNCA importar este archivo desde un Client Component ni desde
 * código que termine en el bundle del browser. La service role key
 * bypassa RLS y permite operaciones privilegiadas (crear usuarios,
 * leer/escribir cualquier tabla).
 *
 * Usar exclusivamente en:
 *   - Route Handlers (app/api/.../route.ts)
 *   - Server Actions
 *   - Server Components que no expongan datos sensibles al cliente
 */

import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL no configurada')
  }
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY no configurada · agregala a .env.local (sin prefijo NEXT_PUBLIC_)',
    )
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
