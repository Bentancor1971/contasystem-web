/**
 * Cliente Supabase para componentes "use client" (browser).
 * Usa las cookies del browser y se sincroniza con el server vía middleware.
 */

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
