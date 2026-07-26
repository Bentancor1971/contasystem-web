/**
 * Extracción del token desde lo que devuelve el lector de QR.
 *
 * El QR del recibo codifica `{eventos_web_base_url}/a/{token}`, pero el escáner
 * tiene que aceptar indistintamente:
 *   - la URL completa            → https://carga.contasystem.uy/a/abc123
 *   - la URL con query/hash      → https://…/a/abc123?utm=mail
 *   - el token pelado            → abc123
 *
 * Sin imports: pura, se usa igual en el cliente (antes de llamar al server) y
 * en el endpoint (que nunca confía en lo que le manda el navegador).
 */

/**
 * El token que emite el desktop es `encode(gen_random_bytes(16),'hex')` — 32
 * chars hex. Aceptamos un rango más amplio para no quedar atados a ese formato
 * si el desktop lo cambia, pero lo suficientemente estrecho como para descartar
 * en el navegador un QR de WiFi, una vCard o un texto cualquiera sin gastar un
 * viaje al servidor.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/

/**
 * Devuelve el token, o null si el texto escaneado no puede serlo.
 * null ⇒ la pantalla muestra "QR no reconocido" sin llamar al servidor.
 */
export function extraerToken(raw: string | null | undefined): string | null {
  const texto = (raw ?? '').trim()
  if (!texto) return null

  // Último segmento de la ruta. Sirve para la URL completa y, como el token
  // pelado no tiene barras, también para él.
  let candidato = texto

  if (/^https?:\/\//i.test(texto)) {
    let path: string
    try {
      path = new URL(texto).pathname
    } catch {
      return null
    }
    const segmentos = path.split('/').filter(Boolean)
    if (segmentos.length === 0) return null
    candidato = decodeURIComponent(segmentos[segmentos.length - 1])
  } else {
    // Token pelado: puede venir con query/hash pegados si el QR trae una URL
    // relativa. Cortamos ahí y nos quedamos con el último segmento igual.
    candidato = candidato.split(/[?#]/)[0]
    const segmentos = candidato.split('/').filter(Boolean)
    if (segmentos.length === 0) return null
    candidato = segmentos[segmentos.length - 1]
  }

  return TOKEN_RE.test(candidato) ? candidato : null
}
