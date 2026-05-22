/**
 * Genera el fondo de la tarjeta de cumpleaños para AUP.
 * Salida:
 *   <repo>/design/aup-cumpleanos-fondo.svg   (vector, editable)
 *   <repo>/design/aup-cumpleanos-fondo.png   (raster 1200x800 para subir)
 *
 * Paleta inspirada en el logo de AUP (Asociación Uruguaya de Psicomotricidad):
 *   naranja cálido + azul marino + blanco. Motivo: líneas onduladas
 *   (movimiento, psicomotricidad) + anillos como guiño al badge circular.
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = 'c:/Users/benta/Documents/Proyecto Contable Socios V1/contasystem-web-carga/design'
const W = 1200
const H = 800

const C = {
  bgGlow:        '#E78838',
  bgOrange:      '#DD701F',
  bgOrangeDeep:  '#9A4A0E',
  navy:          '#1E2E5D',
  navyLight:     '#324577',
  white:         '#FFFFFF',
  warm:          '#FFE6BE',
  taglineSoft:   '#FCE2BA',
}

const fx = (n) => n.toFixed(2)

// ── helpers de figuras ────────────────────────────────────────────────
function dot(x, y, r, c, o) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`
}
function ring(x, y, r, c, o, sw = 2) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="${sw}" opacity="${o}"/>`
}
function spark(x, y, s, c, o) {
  const h = s * 0.28
  const d =
    `M ${x} ${y - s} ` +
    `Q ${x + h} ${y - h} ${x + s} ${y} ` +
    `Q ${x + h} ${y + h} ${x} ${y + s} ` +
    `Q ${x - h} ${y + h} ${x - s} ${y} ` +
    `Q ${x - h} ${y - h} ${x} ${y - s} Z`
  return `<path d="${d}" fill="${c}" opacity="${o}"/>`
}
/** Una mini onda (1 ciclo), gira con rot. */
function curl(cx, cy, size, rot, color, opacity, sw = 2.5) {
  const s = size
  const d = `M ${-s} 0 Q ${-s / 2} ${-s * 0.65} 0 0 Q ${s / 2} ${s * 0.65} ${s} 0`
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" opacity="${opacity}" transform="translate(${cx} ${cy}) rotate(${rot})"/>`
}

/** Onda sinusoidal de N ciclos, de x0 a x0+length, centrada en y0. */
function wave(x0, y0, length, amp, wavelength, color, opacity, sw) {
  const cycles = Math.ceil(length / wavelength)
  let d = `M ${fx(x0)} ${fx(y0)}`
  for (let i = 0; i < cycles; i++) {
    const seg = x0 + i * wavelength
    d += ` Q ${fx(seg + wavelength * 0.25)} ${fx(y0 - amp)} ${fx(seg + wavelength * 0.5)} ${fx(y0)}`
    d += ` Q ${fx(seg + wavelength * 0.75)} ${fx(y0 + amp)} ${fx(seg + wavelength)} ${fx(y0)}`
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" opacity="${opacity}"/>`
}

/** Doble anillo, guiño al badge circular del logo (navy sólido). */
function badge(cx, cy, R, opacity, color) {
  // Navy SÓLIDO (no transparente) y strokes finos. El navy translúcido
  // sobre naranja se neutraliza ópticamente y se ve marrón — un azul
  // saturado con opacidad alta sí lee como azul.
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${(R * 0.035).toFixed(2)}" opacity="${opacity}"/>
    <circle cx="${cx}" cy="${cy}" r="${(R * 0.90).toFixed(2)}" fill="none" stroke="${color}" stroke-width="${(R * 0.012).toFixed(2)}" opacity="${(opacity * 0.7).toFixed(2)}"/>
  </g>`
}

// ── confeti orgánico (puntos, anillos, curls, chispas) ────────────────
const confetti = [
  // top-left
  dot(80, 70, 5, C.white, 0.9),
  curl(160, 110, 18, 25, C.white, 0.65),
  ring(60, 175, 8, C.navy, 0.55, 2.2),
  spark(245, 150, 16, C.white, 0.85),
  dot(305, 70, 4, C.warm, 0.85),
  curl(330, 165, 14, -15, C.navy, 0.5),
  dot(195, 60, 3.5, C.white, 0.8),

  // top-right
  curl(945, 90, 20, -20, C.white, 0.7),
  spark(1075, 145, 18, C.white, 0.85),
  dot(1145, 65, 5, C.navy, 0.6),
  ring(1000, 75, 7, C.white, 0.65, 2.2),
  curl(1110, 185, 14, 30, C.warm, 0.65),
  dot(880, 175, 4, C.navy, 0.55),

  // mid sides (sutiles)
  dot(45, 360, 3.5, C.white, 0.4),
  spark(1140, 420, 12, C.white, 0.6),
  curl(45, 510, 12, 60, C.warm, 0.45),
  dot(1160, 320, 4, C.navy, 0.45),
  dot(35, 250, 3, C.warm, 0.5),

  // bottom-left
  curl(95, 660, 15, 35, C.white, 0.7),
  dot(140, 745, 5, C.warm, 0.85),
  ring(60, 710, 7, C.navy, 0.55, 2.2),
  spark(55, 615, 13, C.white, 0.7),
  dot(180, 615, 4, C.white, 0.65),

  // bottom-right
  spark(1085, 660, 16, C.white, 0.8),
  curl(1145, 745, 14, -25, C.warm, 0.7),
  ring(1020, 745, 7, C.navy, 0.55, 2.2),
  dot(1150, 640, 4.5, C.white, 0.7),
  curl(1115, 615, 12, 18, C.white, 0.6),
].join('\n  ')

// ── armado del SVG ────────────────────────────────────────────────────
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="72%">
      <stop offset="0%"  stop-color="${C.bgGlow}"/>
      <stop offset="50%" stop-color="${C.bgOrange}"/>
      <stop offset="100%" stop-color="${C.bgOrangeDeep}"/>
    </radialGradient>
  </defs>

  <!-- 1. Fondo naranja con glow + viñeta -->
  <rect width="${W}" height="${H}" fill="${C.bgOrange}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- 2. Anillos navy como guiño al badge AUP — centrados off-canvas
       (se ve solo el arco elegante en la esquina) -->
  ${badge(0, 0, 310, 0.85, '#27397B')}
  ${badge(W, H, 345, 0.85, '#27397B')}

  <!-- 3. Ondas blancas (movimiento) — abajo y arriba del centro -->
  ${wave(-20, 215, W + 40, 11, 210, C.white, 0.38, 7)}
  ${wave(-20, 590, W + 40, 13, 230, C.white, 0.40, 8)}
  <!-- onda navy muy sutil cruzando el área del texto -->
  ${wave(-20, 405, W + 40, 9, 260, C.navy, 0.10, 5)}

  <!-- 4. Confeti orgánico -->
  ${confetti}

  <!-- 5. Wordmark "AUP" (abajo) — italic serif evocando el lettering del logo -->
  <text x="600" y="660"
        text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-style="italic"
        font-weight="700"
        font-size="96"
        letter-spacing="6"
        fill="${C.white}">AUP</text>

  <!-- 6. Tagline -->
  <text x="600" y="702"
        text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-style="italic"
        font-weight="400"
        font-size="18"
        letter-spacing="2"
        fill="${C.taglineSoft}">Asociación Uruguaya de Psicomotricidad</text>
</svg>
`

// ── escribir SVG ──────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true })
const svgPath = path.join(OUT_DIR, 'aup-cumpleanos-fondo.svg')
fs.writeFileSync(svgPath, svg, 'utf8')
console.log('SVG:', svgPath)

// ── rasterizar a PNG ──────────────────────────────────────────────────
let sharp
try {
  sharp = (await import('sharp')).default
} catch (e) {
  console.log('sharp no disponible:', e.message)
  process.exit(0)
}

const pngPath = path.join(OUT_DIR, 'aup-cumpleanos-fondo.png')
await sharp(Buffer.from(svg), { density: 192 })
  .resize(W, H, { fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toFile(pngPath)
console.log('PNG:', pngPath)
