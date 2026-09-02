/**
 * Pieza compartida por los dos route handlers de la ficha web.
 * No es una ruta: en el App Router sólo `route.ts` lo es.
 *
 * La validación de token y los mensajes viven en `lib/ficha-types.ts` porque
 * los usa también la página y el client component.
 */

/**
 * Ninguna de las dos llamadas se puede cachear: la respuesta de `validar`
 * trae los datos personales de la ficha, y `guardar` es una escritura.
 */
export const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

/**
 * El factor tal como viaja en el body. A diferencia de votación acá es
 * SIEMPRE obligatorio (la ficha completa de una persona no se abre con el
 * link solo): vacío o con basura devuelve null, y el handler responde
 * `factor_incorrecto` sin tocar la base — por la misma puerta que un factor
 * equivocado, para no regalar información.
 *
 * No se normaliza acá (mayúsculas, espacios): eso lo hace el cliente según el
 * modo, que este handler no conoce sin una consulta de más. El hash de la base
 * es sobre el texto crudo, así que un factor sin normalizar simplemente no
 * coincide y gasta un intento, igual que uno mal tipeado.
 */
export function factorDelBody(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const f = v.trim()
  if (f === '' || f.length > 40) return null
  return f
}
