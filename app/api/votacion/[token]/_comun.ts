/**
 * Pieza compartida por los tres route handlers de votación.
 * No es una ruta: en el App Router sólo `route.ts` lo es.
 *
 * La validación de token y dígitos vive en `lib/elecciones-types.ts` porque la
 * usa también la página.
 */

/** Ninguna de las tres llamadas se puede cachear. `ya_voto` cacheado es un voto perdido. */
export const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const
