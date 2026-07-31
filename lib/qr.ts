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
 * PNG del QR, para ADJUNTAR a un mail (referenciado por `cid:`).
 *
 * En el mail no sirve el SVG de arriba: Gmail no renderiza SVG inline y bloquea
 * las `data:` URIs, así que la única forma de que el código se vea sin salir a
 * internet es un adjunto embebido. `width` en px del lado del PNG — 320 entra
 * entero en la columna de 600 del recibo y se escanea bien desde el teléfono.
 */
export async function qrPng(texto: string): Promise<Buffer> {
  return QRCode.toBuffer(texto, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
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
