/**
 * Cliente Supabase para Server Components y Server Actions.
 * Lee/escribe cookies vía next/headers.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Set en Server Component es no-op si no estamos en una Route Handler / Server Action.
            // El middleware refresca la sesión, así que está OK.
          }
        },
      },
    },
  )
}
