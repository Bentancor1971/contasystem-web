/**
 * Genera el fondo de la tarjeta de cumpleaños para ATRI.
 * Salida:
 *   <repo>/design/atri-cumpleanos-fondo.svg   (vector, editable)
 *   <repo>/design/atri-cumpleanos-fondo.png   (raster 1200x800 para subir)
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = 'c:/Users/benta/Documents/Proyecto Contable Socios V1/contasystem-web-carga/design'
const W = 1200
const H = 800

const C = {
  bgDark:      '#15191b',
  bgMid:       '#22282a',
  bgGlow:      '#303a3d',
  watermark:   '#2a3437',
  teal:        '#3FA9AF',
  tealBright:  '#5FC5CB',
  orange:      '#F08C21',
  gray:        '#9AA1A2',
  light:       '#E8ECED',
  tagline:     '#8A9293',
}

// ── helpers geométricos ────────────────────────────────────────────────
const fx = (n) => n.toFixed(2)
function pt(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
function donutSector(cx, cy, ri, ro, a1, a2) {
  const large = a2 - a1 > 180 ? 1 : 0
  const [x1, y1] = pt(cx, cy, ro, a1)
  const [x2, y2] = pt(cx, cy, ro, a2)
  const [x3, y3] = pt(cx, cy, ri, a2)
  const [x4, y4] = pt(cx, cy, ri, a1)
  return (
    `M${fx(x1)} ${fx(y1)} A${ro} ${ro} 0 ${large} 1 ${fx(x2)} ${fx(y2)} ` +
    `L${fx(x3)} ${fx(y3)} A${ri} ${ri} 0 ${large} 0 ${fx(x4)} ${fx(y4)} Z`
  )
}

// ── apertura segmentada (ícono ATRI estilizado) ────────────────────────
function aperture(cx, cy, R, { opacity = 1, mono = null } = {}) {
  const ri = R * 0.60
  const ro = R
  const gap = 7 // grados

  const segs = [
    // (clockwise desde arriba) — teal arriba, naranja en la base
    { a1: 0,   a2: 60,  c: C.teal },
    { a1: 60,  a2: 120, c: C.teal },
    { a1: 120, a2: 180, c: C.orange },
    { a1: 180, a2: 240, c: C.orange },
    { a1: 240, a2: 300, c: C.teal },
    { a1: 300, a2: 360, c: C.gray },
  ]

  let s = `<g opacity="${opacity}">`
  for (const seg of segs) {
    const fill = mono ?? seg.c
    s += `<path d="${donutSector(cx, cy, ri, ro, seg.a1 + gap / 2, seg.a2 - gap / 2)}" fill="${fill}"/>`
  }
  // anillo interno fino
  s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.46).toFixed(2)}" fill="none" stroke="${mono ?? C.gray}" stroke-width="${(R * 0.045).toFixed(2)}" stroke-opacity="0.55"/>`
  // centro
  s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.34).toFixed(2)}" fill="${C.bgDark}"/>`
  s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.34).toFixed(2)}" fill="none" stroke="${mono ?? C.teal}" stroke-width="${(R * 0.045).toFixed(2)}" stroke-opacity="0.7"/>`
  // iris
  s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.13).toFixed(2)}" fill="${mono ?? C.teal}"/>`
  s += `</g>`
  return s
}

// ── confeti / chispas ──────────────────────────────────────────────────
function dot(x, y, r, c, o) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`
}
function ring(x, y, r, c, o) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="2" opacity="${o}"/>`
}
function stick(x, y, s, rot, c, o) {
  const w = s * 2.6
  const h = s * 0.58
  return `<rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="${c}" opacity="${o}" transform="rotate(${rot} ${x} ${y})"/>`
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

// Confeti: bien lejos del centro (donde va el texto del saludo).
const confetti = [
  // top-left
  stick(120, 90, 14, 30, C.teal, 0.85),
  dot(70, 60, 5, C.orange, 0.85),
  spark(245, 150, 17, C.tealBright, 0.9),
  ring(60, 175, 8, C.gray, 0.55),
  dot(290, 55, 4, C.tealBright, 0.8),
  stick(180, 175, 12, -20, C.orange, 0.75),
  dot(340, 110, 3.5, C.teal, 0.7),

  // top-right
  spark(965, 75, 21, C.orange, 0.9),
  dot(1080, 135, 5, C.teal, 0.85),
  stick(1010, 175, 14, -38, C.tealBright, 0.85),
  ring(1150, 60, 7, C.gray, 0.55),
  dot(885, 165, 4, C.orange, 0.75),
  stick(1110, 100, 11, 22, C.teal, 0.75),

  // mid sides (sutiles)
  dot(45, 360, 3, C.gray, 0.45),
  spark(1140, 420, 12, C.tealBright, 0.7),
  dot(1160, 320, 4, C.orange, 0.55),
  dot(35, 510, 3.5, C.teal, 0.4),

  // bottom-left
  stick(95, 660, 14, 40, C.orange, 0.8),
  dot(140, 745, 5, C.teal, 0.85),
  ring(60, 700, 7, C.gray, 0.55),
  spark(60, 620, 13, C.tealBright, 0.7),

  // bottom-right
  spark(1085, 665, 16, C.orange, 0.85),
  dot(1145, 745, 5, C.tealBright, 0.8),
  stick(1020, 745, 12, -28, C.teal, 0.8),
  ring(1150, 640, 7, C.gray, 0.55),
].join('\n  ')

// ── armado del SVG ─────────────────────────────────────────────────────
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="70%">
      <stop offset="0%"  stop-color="${C.bgGlow}"/>
      <stop offset="48%" stop-color="${C.bgMid}"/>
      <stop offset="100%" stop-color="${C.bgDark}"/>
    </radialGradient>
  </defs>

  <!-- 1. Fondo con glow + viñeta -->
  <rect width="${W}" height="${H}" fill="${C.bgDark}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- 2. Watermarks de la apertura, en esquinas, muy tenues -->
  ${aperture(40, 30, 235, { opacity: 0.55, mono: C.watermark })}
  ${aperture(1180, 790, 320, { opacity: 0.65, mono: C.watermark })}

  <!-- 3. Confeti -->
  ${confetti}

  <!-- 4. Logo ATRI: apertura en color (arriba) -->
  ${aperture(600, 112, 62, { opacity: 1 })}

  <!-- 5. Wordmark "ATRI" (abajo) -->
  <text x="600" y="660"
        text-anchor="middle"
        font-family="Arial Black, Arial, 'Segoe UI', sans-serif"
        font-weight="900"
        font-size="86"
        letter-spacing="6"
        fill="${C.teal}">ATRI</text>

  <!-- 6. Tagline -->
  <text x="600" y="700"
        text-anchor="middle"
        font-family="Arial, 'Segoe UI', sans-serif"
        font-weight="600"
        font-size="15"
        letter-spacing="3"
        fill="${C.tagline}">ASOCIACIÓN DE TÉCNICOS EN RADIACIONES E IMAGENOLOGÍA</text>
</svg>
`

// ── escribir SVG ───────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true })
const svgPath = path.join(OUT_DIR, 'atri-cumpleanos-fondo.svg')
fs.writeFileSync(svgPath, svg, 'utf8')
console.log('SVG:', svgPath)

// ── rasterizar a PNG si sharp está disponible ──────────────────────────
let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.log('sharp no disponible — solo se generó el SVG.')
  process.exit(0)
}

const pngPath = path.join(OUT_DIR, 'atri-cumpleanos-fondo.png')
await sharp(Buffer.from(svg), { density: 192 })
  .resize(W, H, { fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toFile(pngPath)
console.log('PNG:', pngPath)
