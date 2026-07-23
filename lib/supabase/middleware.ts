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

// Rutas realmente SIN sesión (inscripción / certificados públicos): acá nunca
// se auto-loguea, aunque falte usuario. `/login` NO está: ahí sí queremos que
// el auto-login de dev actúe para que la pantalla no llegue a mostrarse.
const PUBLIC_SIN_SESION = [
  '/auth/callback',
  '/e/',
  '/api/eventos/',
  '/c/',
  '/api/certificados/',
]

// Auto-login SÓLO en desarrollo: con estas credenciales seteadas, el middleware
// inicia sesión server-side y `/login` nunca se renderiza. El guard de NODE_ENV
// hace imposible que se active en el build de producción aunque las variables se
// filtraran al entorno de Vercel. Ver .env.local.example.
const DEV_AUTO_EMAIL = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_EMAIL
const DEV_AUTO_PASSWORD = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_PASSWORD
const DEV_AUTO_LOGIN =
  process.env.NODE_ENV !== 'production' && Boolean(DEV_AUTO_EMAIL && DEV_AUTO_PASSWORD)

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
  const isPublicSinSesion = PUBLIC_SIN_SESION.some((p) => pathname.startsWith(p))

  // DEV: si no hay sesión, la firmamos acá mismo. `signInWithPassword` escribe
  // las cookies de sesión sobre `response` (vía el callback setAll de arriba), así
  // que a partir de esta request ya hay usuario y `/login` no se muestra.
  let usuario = user
  if (!usuario && DEV_AUTO_LOGIN && !isPublicSinSesion) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: DEV_AUTO_EMAIL!.trim(),
      password: DEV_AUTO_PASSWORD!,
    })
    if (error) console.error('[dev auto-login] falló:', error.message)
    else usuario = data.user
  }

  if (!usuario && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (usuario && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/empresa'
    const redirect = NextResponse.redirect(url)
    // Si acabamos de auto-loguear, las cookies de sesión están en `response` y
    // todavía no en el navegador: hay que trasladarlas al redirect (con sus
    // opciones) o se perdería el login y quedaría un rebote infinito.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
    return redirect
  }

  return response
}
