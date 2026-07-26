/**
 * Generación del QR (server-only, runtime nodejs).
 *
 * Se usa en /a/[token] para RE-DIBUJAR el mismo QR que el desktop mandó por
 * mail: quien llega con el link abierto pero sin la imagen (mail que no carga
 * las adjuntas, papel arrugado, captura borrosa) igual tiene algo que mostrar
 * en la puerta.
 */

import QRCode from 'qrcode'
import { headers } from 'next/headers'

/**
 * SVG del QR, listo para inyectar. Sin `width`/`height` propios: trae `viewBox`,
 * así que escala al contenedor (ver `.qr-box` en globals.css).
 */
export async function qrSvg(texto: string): Promise<string> {
  return QRCode.toString(texto, {
    type: 'svg',
    // 'M' tolera ~15% de daño: el equilibrio habitual entre densidad y
    // resistencia a pantalla rayada o papel doblado.
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#1a1814', light: '#ffffff' },
  })
}

/**
 * Origen público desde los headers del request (Server Component).
 * Equivalente a `origenPublico(req)` de lib/evento-acuse, que trabaja sobre un
 * Request de Route Handler.
 */
export async function origenPublicoDesdeHeaders(): Promise<string | null> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null
  const proto =
    h.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}
