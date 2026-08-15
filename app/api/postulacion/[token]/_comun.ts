/**
 * Pieza compartida por los cuatro route handlers de postulación.
 * No es una ruta: en el App Router sólo `route.ts` lo es.
 *
 * La validación de token y dígitos vive en `lib/convocatorias-types.ts` porque
 * la usa también la página.
 */

/**
 * Ninguna de las cuatro llamadas se puede cachear. `ya_postulado` cacheado deja
 * a alguien mirando una pantalla que no es la suya.
 */
export const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const
