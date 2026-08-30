'use client'

/**
 * Fetch envuelto para las pantallas de /configuracion (y cualquier otra del
 * grupo `(app)`) que hablan con `/api/admin/*` o `/api/checkin/*`.
 *
 * Nace de U7/U8 (docs/web-performance-propuesta.md, repo desktop): cada
 * pantalla repetía su propio `fetch` + `res.json().catch(() => ({}))` +
 * `if (!res.ok) toast.error(...)`, con dos problemas:
 *
 *   1. Un 401 ("JWT expired", sesión vencida) se mostraba como un toast más
 *      y la pantalla se quedaba ahí, mostrando datos viejos o un spinner
 *      infinito — sin salida real hacia /login.
 *   2. El `error.message` de Postgres/PostgREST llegaba crudo al operador
 *      ("permission denied for table socios_datos", "JWT expired", "duplicate
 *      key value violates unique constraint …") — ruido técnico que no dice
 *      qué hacer.
 *
 * `fetchApi` no reemplaza el manejo de errores de cada pantalla: sigue
 * siendo cada `catch` el que decide qué hacer (mostrar un estado de error
 * con "Reintentar", un toast, etc.) — sólo centraliza la detección del 401 y
 * la traducción del mensaje.
 */

import { createClient } from '@/lib/supabase/client'

/** Error de una llamada a `fetchApi`, con el status HTTP si lo hubo. */
export class ApiError extends Error {
  /** 0 = nunca llegó a haber respuesta (falla de red/fetch). */
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Traduce fragmentos técnicos frecuentes de Postgres/PostgREST/Supabase Auth
 * a una frase que un operador entiende. Lo que no matchea ningún patrón se
 * devuelve tal cual — mejor un mensaje crudo que uno inventado que oculte el
 * problema real.
 */
const PATRONES_HUMANOS: { re: RegExp; texto: string }[] = [
  { re: /jwt expired|jwt.*invalid|invalid.*jwt/i, texto: 'Tu sesión venció. Iniciá sesión de nuevo.' },
  { re: /row-level security|permission denied/i, texto: 'No tenés permiso para hacer esto.' },
  { re: /duplicate key|already exists|already registered/i, texto: 'Ya existe un registro con esos datos.' },
  { re: /invalid input syntax/i, texto: 'Uno de los datos tiene un formato inválido.' },
  { re: /violates foreign key constraint/i, texto: 'La operación afecta un dato relacionado que no existe.' },
  { re: /timeout|statement timeout/i, texto: 'El servidor tardó demasiado en responder. Probá de nuevo.' },
  {
    re: /failed to fetch|networkerror|network error|load failed|fetch failed/i,
    texto: 'No se pudo conectar con el servidor. Revisá tu conexión.',
  },
]

/** Traduce un mensaje técnico a texto humano. Ver `PATRONES_HUMANOS`. */
export function mensajeHumano(raw: string): string {
  for (const p of PATRONES_HUMANOS) {
    if (p.re.test(raw)) return p.texto
  }
  return raw
}

/**
 * Cierra la sesión y manda a /login. Se usa una sola vez por navegación
 * (varias llamadas en vuelo con 401 al mismo tiempo no deberían disparar
 * varios `signOut`/redirects superpuestos).
 */
let cerrandoSesion = false
function sesionVencida(): void {
  if (cerrandoSesion) return
  cerrandoSesion = true
  const supabase = createClient()
  void supabase.auth.signOut().finally(() => {
    // Navegación dura (no router.replace): asegura que se limpie todo el
    // estado en memoria de la app además de la cookie de sesión.
    window.location.replace('/login')
  })
}

/**
 * `fetch` + `.json()` con manejo uniforme de 401 y mensajes de error.
 *
 * - Agrega `cache: 'no-store'` por default (las pantallas de config no
 *   quieren datos cacheados por el navegador).
 * - Ante 401, dispara `sesionVencida()` (signOut + replace a /login) y
 *   rechaza con un `ApiError` — el caller no necesita manejar el 401 en
 *   particular, sólo dejar que el catch general muestre algo mientras la
 *   navegación ya está en curso.
 * - Ante cualquier otro !res.ok, rechaza con `ApiError` cuyo mensaje ya pasó
 *   por `mensajeHumano`.
 * - Ante una falla de `fetch` en sí (sin red), rechaza con `ApiError`
 *   status 0 y el mensaje de "no se pudo conectar".
 */
export async function fetchApi<T = unknown>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(input, { cache: 'no-store', ...init })
  } catch (err) {
    throw new ApiError(
      mensajeHumano(err instanceof Error ? err.message : 'Failed to fetch'),
      0,
    )
  }

  if (res.status === 401) {
    sesionVencida()
    throw new ApiError('Tu sesión venció. Iniciando sesión de nuevo…', 401)
  }

  const data = (await res.json().catch(() => ({}))) as { error?: unknown }

  if (!res.ok) {
    const raw = typeof data.error === 'string' ? data.error : `Error ${res.status}`
    throw new ApiError(mensajeHumano(raw), res.status)
  }

  return data as T
}
