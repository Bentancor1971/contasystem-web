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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Un solo cliente por proceso. El cliente admin no guarda estado de sesión
// (persistSession: false), así que compartirlo entre requests es seguro, y
// construirlo por request era puro desperdicio en los endpoints calientes
// (pixel de tracking, formulario de eventos). La clave entra en la cache por
// si alguna vez cambia entre invocaciones warm (rotación de la service key).
let cacheAdmin: { clave: string; cliente: SupabaseClient } | null = null

export function createAdminClient(): SupabaseClient {
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

  const clave = `${url}|${key}`
  if (cacheAdmin && cacheAdmin.clave === clave) return cacheAdmin.cliente

  const cliente = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  cacheAdmin = { clave, cliente }
  return cliente
}
