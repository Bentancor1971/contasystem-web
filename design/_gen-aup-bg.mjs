/**
 * Genera el fondo de la tarjeta de cumpleaños para AUP.
 * Salida:
 *   <repo>/design/aup-cumpleanos-fondo.svg
 *   <repo>/design/aup-cumpleanos-fondo.png   (1200x800, para subir)
 *
 * Paleta tomada del CSS real de aup-new.vercel.app (los cálidos del sitio):
 *   #f5cba1 durazno · #fbeb83 amarillo suave · #fcfbf8 crema ·
 *   #e57c15 naranja · #230d66 navy (acento).
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = 'c:/Users/benta/Documents/Proyecto Contable Socios V1/contasystem-web-carga/design'
const W = 1200
const H = 800

const C = {
  bgGlow:       '#fdf3c9',   // glow amarillo-crema en el centro
  bgPeachLight: '#fae3c5',
  bgPeach:      '#f5cba1',   // durazno (cálido AUP)
  bgPeachDeep:  '#e0a373',   // viñeta más cálida
  navy:         '#230d66',   // brand navy/púrpura
  navyLight:    '#3c2a8a',
  orange:       '#e57c15',   // brand orange
  warmYellow:   '#fbeb83',   // amarillo suave del sitio
  cream:        '#fcfbf8',
}

const fx = (n) => n.toFixed(2)

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
function curl(cx, cy, size, rot, color, opacity, sw = 2.5) {
  const s = size
  const d = `M ${-s} 0 Q ${-s / 2} ${-s * 0.65} 0 0 Q ${s / 2} ${s * 0.65} ${s} 0`
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" opacity="${opacity}" transform="translate(${cx} ${cy}) rotate(${rot})"/>`
}

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
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${(R * 0.035).toFixed(2)}" opacity="${opacity}"/>
    <circle cx="${cx}" cy="${cy}" r="${(R * 0.90).toFixed(2)}" fill="none" stroke="${color}" stroke-width="${(R * 0.012).toFixed(2)}" opacity="${(opacity * 0.7).toFixed(2)}"/>
  </g>`
}

// Confeti en cálidos del sitio + navy de acento
const confetti = [
  // top-left
  dot(80, 70, 5, C.navy, 0.75),
  curl(160, 110, 18, 25, C.navy, 0.55),
  ring(60, 175, 8, C.navy, 0.55, 2.2),
  spark(245, 150, 16, C.cream, 0.95),
  dot(305, 70, 4, C.orange, 0.85),
  curl(330, 165, 14, -15, C.navy, 0.5),
  dot(195, 60, 3.5, C.warmYellow, 0.95),

  // top-right
  curl(945, 90, 20, -20, C.navy, 0.55),
  spark(1075, 145, 18, C.cream, 0.95),
  dot(1145, 65, 5, C.navy, 0.7),
  ring(1000, 75, 7, C.navy, 0.55, 2.2),
  curl(1110, 185, 14, 30, C.warmYellow, 0.9),
  dot(880, 175, 4, C.orange, 0.85),

  // mid sides
  dot(45, 360, 3.5, C.navy, 0.45),
  spark(1140, 420, 12, C.cream, 0.7),
  curl(45, 510, 12, 60, C.navy, 0.45),
  dot(1160, 320, 4, C.orange, 0.65),
  dot(35, 250, 3, C.warmYellow, 0.85),

  // bottom-left
  curl(95, 660, 15, 35, C.navy, 0.55),
  dot(140, 745, 5, C.warmYellow, 0.95),
  ring(60, 710, 7, C.navy, 0.55, 2.2),
  spark(55, 615, 13, C.cream, 0.85),
  dot(180, 615, 4, C.orange, 0.85),

  // bottom-right
  spark(1085, 660, 16, C.cream, 0.9),
  curl(1145, 745, 14, -25, C.warmYellow, 0.95),
  ring(1020, 745, 7, C.navy, 0.55, 2.2),
  dot(1150, 640, 4.5, C.orange, 0.85),
  curl(1115, 615, 12, 18, C.navy, 0.5),
].join('\n  ')

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="75%">
      <stop offset="0%"  stop-color="${C.bgGlow}"/>
      <stop offset="35%" stop-color="${C.bgPeachLight}"/>
      <stop offset="70%" stop-color="${C.bgPeach}"/>
      <stop offset="100%" stop-color="${C.bgPeachDeep}"/>
    </radialGradient>
  </defs>

  <!-- 1. Fondo cálido: amarillo-crema glow → durazno → durazno profundo -->
  <rect width="${W}" height="${H}" fill="${C.bgPeach}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- 2. Anillos navy (guiño al badge AUP), centrados off-canvas -->
  ${badge(0, 0, 310, 0.85, C.navy)}
  ${badge(W, H, 345, 0.85, C.navy)}

  <!-- 3. Ondas navy (movimiento, psicomotricidad) -->
  ${wave(-20, 215, W + 40, 11, 210, C.navy, 0.22, 6)}
  ${wave(-20, 590, W + 40, 13, 230, C.navy, 0.24, 7)}
  <!-- onda sutil que cruza el área del texto -->
  ${wave(-20, 405, W + 40, 9, 260, C.navy, 0.08, 4)}

  <!-- 4. Confeti orgánico -->
  ${confetti}

  <!-- 5. Wordmark "AUP" en navy (la marca) -->
  <text x="600" y="660"
        text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-style="italic"
        font-weight="700"
        font-size="96"
        letter-spacing="6"
        fill="${C.navy}">AUP</text>

  <!-- 6. Tagline -->
  <text x="600" y="702"
        text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-style="italic"
        font-weight="400"
        font-size="18"
        letter-spacing="2"
        fill="${C.navy}"
        opacity="0.75">Asociación Uruguaya de Psicomotricidad</text>
</svg>
`

fs.mkdirSync(OUT_DIR, { recursive: true })
const svgPath = path.join(OUT_DIR, 'aup-cumpleanos-fondo.svg')
fs.writeFileSync(svgPath, svg, 'utf8')
console.log('SVG:', svgPath)

let sharp
try { sharp = (await import('sharp')).default } catch (e) {
  console.log('sharp no disponible:', e.message); process.exit(0)
}
const pngPath = path.join(OUT_DIR, 'aup-cumpleanos-fondo.png')
await sharp(Buffer.from(svg), { density: 192 })
  .resize(W, H, { fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toFile(pngPath)
console.log('PNG:', pngPath)
