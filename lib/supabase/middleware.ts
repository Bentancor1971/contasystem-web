/**
 * Helper para usar Supabase desde middleware.ts (refresh de sesión + redirect).
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// `/e/` y `/api/eventos/` son las rutas PÚBLICAS de inscripción a eventos
// (se comparten como enlace externo, sin login). Ojo: usar `/e/` con barra
// final para no capturar `/empresa`.
const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/e/', // inscripción pública a eventos
  '/api/eventos/',
  '/c/', // validación pública de certificados (QR)
  '/api/certificados/',
]

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: do not run code between createServerClient and getUser; this refreshes the session cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/empresa'
    return NextResponse.redirect(url)
  }

  return response
}
