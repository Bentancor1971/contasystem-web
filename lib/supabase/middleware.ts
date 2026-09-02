/**
 * Helper para usar Supabase desde proxy.ts (refresh de sesión + redirect).
 *
 * Desde el arreglo de P4 (docs/web-performance-propuesta.md, repo desktop), el
 * matcher de proxy.ts ya excluye TODAS las rutas públicas, así que en el caso
 * normal acá sólo llegan las que necesitan sesión. Las listas de abajo quedan
 * como segunda línea de defensa: si el matcher y las listas divergen, una ruta
 * pública paga el proxy de más (molesto) pero nunca rebota a /login (grave).
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
  // Vista de la entrada de un evento (destino del QR del recibo). Es pública a
  // propósito y de sólo lectura: la asistencia la marca /checkin, con sesión.
  // Ojo: `/api/checkin/` NO empieza con `/a/`, así que no queda expuesta.
  '/a/',
  // Votación de elecciones: el link personal que llega por mail. Es `/v/` y no
  // `/e/` porque `/e/{slug}` ya es la inscripción a eventos.
  '/v/',
  // Entrada por código impreso. Va aparte y con `$` porque las demás entradas de
  // esta lista se comparan con startsWith: `'/v/'` no captura `/v` a secas, y sin
  // esto la página del código pediría login. Ver `esPublica`.
  '/v$',
  '/api/votacion/',
  // Postulación a una convocatoria: el link personal que llega por mail. Es
  // `/p/` de postularse, porque `/c/{token}` ya es la validación de certificados.
  '/p/',
  '/api/postulacion/',
  // La mesa del local. NO usa la sesión de Supabase: entra con código + PIN y
  // guarda su propia cookie httpOnly (`mesa_sesion`). Quien atiende una mesa no
  // tiene usuario del sistema, así que un redirect a /login la dejaría afuera.
  '/mesa',
  '/api/mesa/',
]

// Rutas realmente SIN sesión (inscripción / certificados públicos): acá nunca
// se auto-loguea, aunque falte usuario, y no se crea el cliente de Supabase.
// `/login` NO está: ahí sí queremos que el auto-login de dev actúe para que la
// pantalla no llegue a mostrarse. Mantener en espejo con el matcher de proxy.ts.
const PUBLIC_SIN_SESION = [
  '/auth/callback',
  '/e/',
  '/api/eventos/',
  '/c/',
  '/api/certificados/',
  '/a/',
  '/v/',
  '/v$',
  '/api/votacion/',
  '/p/',
  '/api/postulacion/',
  '/mesa',
  '/api/mesa/',
  '/f/',
  '/api/ficha/',
]

/**
 * Compara un pathname contra la lista. Un patrón que termina en `$` exige
 * coincidencia exacta; el resto es prefijo, como siempre.
 *
 * Existe por `/v`: la entrada por código es una ruta sin nada después, y las
 * listas usan barra final a propósito para no capturar de más (`/e/` para no
 * agarrar `/empresa`).
 */
function esPublica(pathname: string, lista: readonly string[]): boolean {
  return lista.some((p) =>
    p.endsWith('$') ? pathname === p.slice(0, -1) : pathname.startsWith(p),
  )
}

/**
 * Rutas donde una respuesta cacheada es un problema de verdad: `ya_voto`
 * guardado en el disco del navegador es un voto perdido o un doble intento, y
 * `ya_postulado` cacheado le muestra a alguien una pantalla que no es la suya.
 *
 * Con el matcher nuevo estas rutas ya no pasan por acá en el caso normal: el
 * `no-store` real lo ponen next.config.ts (páginas) y los handlers (_comun.ts).
 * Se conserva por la misma razón que las listas: defensa si el matcher diverge.
 */
const SIN_CACHE = [
  '/v/',
  '/v$',
  '/api/votacion/',
  '/p/',
  '/api/postulacion/',
  '/mesa',
  '/api/mesa/',
  '/f/',
  '/api/ficha/',
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
  const pathname = request.nextUrl.pathname

  // Rutas públicas sin sesión: no se crea el cliente ni se mira la cookie.
  // Antes esto venía DESPUÉS de getUser(); no costaba red para el visitante
  // anónimo (auth-js corta en AuthSessionMissingError sin request si no hay
  // cookie — verificado en GoTrueClient._getUser), pero sí para el operador
  // logueado que abría un link público, y de paso refrescaba una sesión que la
  // ruta no usa.
  if (esPublica(pathname, PUBLIC_SIN_SESION)) {
    const response = NextResponse.next({ request })
    if (esPublica(pathname, SIN_CACHE)) {
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    }
    return response
  }

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

  const isPublic = esPublica(pathname, PUBLIC_PATHS)

  // DEV: si no hay sesión, la firmamos acá mismo. `signInWithPassword` escribe
  // las cookies de sesión sobre `response` (vía el callback setAll de arriba), así
  // que a partir de esta request ya hay usuario y `/login` no se muestra. Las
  // rutas de PUBLIC_SIN_SESION nunca llegan acá (early return de arriba).
  let usuario = user
  if (!usuario && DEV_AUTO_LOGIN) {
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
