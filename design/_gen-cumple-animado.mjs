/**
 * Genera los banners ANIMADOS (GIF) del mail de cumpleaños de ATRI y AUP.
 *
 *   node design/_gen-cumple-animado.mjs          → las dos
 *   node design/_gen-cumple-animado.mjs atri     → solo una
 *
 * Salida (junto a este script):
 *   <empresa>-cumpleanos-animado.gif   (1200x380, loop infinito, para subir)
 *   <empresa>-cumpleanos-animado.png   (cuadro estático, para revisar)
 *
 * Por qué GIF: Gmail y Outlook descartan las animaciones CSS del mail; el
 * GIF animado es lo único que se mueve en todos los clientes (Outlook de
 * escritorio muestra el primer cuadro, por eso el cuadro 0 tiene que
 * verse completo por sí solo).
 *
 * Misma paleta y composición que los banners estáticos (_gen-atri-bg.mjs),
 * con: confeti que cae, globos que flotan, destellos que titilan y las
 * aperturas de fondo girando. Todo es periódico en t ∈ [0, 1) con
 * frecuencias enteras, así el loop no tiene salto.
 *
 * Requiere sharp ≥ 0.34 (viene con Next en node_modules).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url))
const W = 1200
const H = 380
const FRAMES = 48
const DELAY_MS = 70 // 48 × 70 ms ≈ 3,4 s por vuelta

const EMPRESAS = {
  atri: {
    sigla: 'ATRI',
    nombre: 'ASOCIACIÓN DE TÉCNICOS EN RADIACIONES E IMAGENOLOGÍA',
  },
  aup: {
    sigla: 'AUP',
    nombre: 'ASOCIACIÓN URUGUAYA DE PSICOMOTRICIDAD',
  },
}

const C = {
  bgCream:    '#fbfaf5',
  bgEdge:     '#ece8d8',
  bgGlow:     '#f3f8f7',
  watermark:  '#d5dfe0',
  teal:       '#47a5ae',
  tealDeep:   '#3a8d96',
  orange:     '#f48424',
  orangeDeep: '#d97011',
  gray:       '#9ca3af',
  grayDark:   '#656464',
  iconDark:   '#2b3a3c',
}

const TAU = Math.PI * 2
const fx = (n) => n.toFixed(2)

// ────────────────────────────────────────────────────────────────────
// Formas
// ────────────────────────────────────────────────────────────────────

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

/** Apertura segmentada monocroma (watermark), girada `rot` grados. */
function aperture(cx, cy, R, rot, color, opacity) {
  const ri = R * 0.6
  const gap = 7
  let s = `<g opacity="${opacity}" transform="rotate(${fx(rot)} ${cx} ${cy})">`
  for (let a = 0; a < 360; a += 60) {
    s += `<path d="${donutSector(cx, cy, ri, R, a + gap / 2, a + 60 - gap / 2)}" fill="${color}"/>`
  }
  s += `<circle cx="${cx}" cy="${cy}" r="${fx(R * 0.46)}" fill="none" stroke="${color}" stroke-width="${fx(R * 0.045)}" stroke-opacity="0.55"/>`
  s += `<circle cx="${cx}" cy="${cy}" r="${fx(R * 0.34)}" fill="${color}"/>`
  s += `</g>`
  return s
}

function spark(x, y, s, c, o) {
  const h = s * 0.28
  const d =
    `M ${fx(x)} ${fx(y - s)} ` +
    `Q ${fx(x + h)} ${fx(y - h)} ${fx(x + s)} ${fx(y)} ` +
    `Q ${fx(x + h)} ${fx(y + h)} ${fx(x)} ${fx(y + s)} ` +
    `Q ${fx(x - h)} ${fx(y + h)} ${fx(x - s)} ${fx(y)} ` +
    `Q ${fx(x - h)} ${fx(y - h)} ${fx(x)} ${fx(y - s)} Z`
  return `<path d="${d}" fill="${c}" opacity="${fx(o)}"/>`
}

/** Globo con brillo, nudo e hilo ondulante. */
function balloon(x, y, r, color, sway) {
  const ry = r * 1.2
  const knotY = y + ry
  const tail = 95
  const c1x = x + sway * 14
  const c2x = x - sway * 10
  return (
    `<path d="M ${fx(x)} ${fx(knotY + 6)} C ${fx(c1x)} ${fx(knotY + tail * 0.35)} ` +
    `${fx(c2x)} ${fx(knotY + tail * 0.7)} ${fx(x + sway * 6)} ${fx(knotY + tail)}" ` +
    `fill="none" stroke="${C.gray}" stroke-width="1.6" stroke-opacity="0.8"/>` +
    `<path d="M ${fx(x - 6)} ${fx(knotY + 7)} L ${fx(x + 6)} ${fx(knotY + 7)} L ${fx(x)} ${fx(knotY - 2)} Z" fill="${color}"/>` +
    `<ellipse cx="${fx(x)}" cy="${fx(y)}" rx="${fx(r)}" ry="${fx(ry)}" fill="${color}"/>` +
    `<ellipse cx="${fx(x - r * 0.38)}" cy="${fx(y - ry * 0.42)}" rx="${fx(r * 0.2)}" ry="${fx(r * 0.34)}" ` +
    `fill="#ffffff" opacity="0.45" transform="rotate(-24 ${fx(x - r * 0.38)} ${fx(y - ry * 0.42)})"/>`
  )
}

// ────────────────────────────────────────────────────────────────────
// Elementos animados (posiciones base; t ∈ [0, 1))
// ────────────────────────────────────────────────────────────────────

/** RNG determinístico: el GIF sale igual en cada corrida. */
function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const PALETA_CONFETI = [C.teal, C.tealDeep, C.orange, C.orangeDeep, C.teal, C.orange, C.gray]

/**
 * Confeti cayendo por los costados (x < 250 o x > 950): el centro queda
 * limpio para la sigla y el nombre. `vueltas` = cuántas veces cruza el
 * banner por loop (entero → loop sin salto).
 */
function crearConfeti() {
  const r = rng(7)
  const piezas = []
  for (let i = 0; i < 30; i++) {
    const izquierda = i % 2 === 0
    piezas.push({
      x: izquierda ? 20 + r() * 230 : 950 + r() * 230,
      fase: r(),
      vueltas: 1 + Math.floor(r() * 2),
      vaiven: 6 + r() * 12,
      giros: (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2)),
      rot0: r() * 360,
      tipo: ['stick', 'stick', 'dot', 'ring', 'square'][Math.floor(r() * 5)],
      tam: 7 + r() * 7,
      color: PALETA_CONFETI[Math.floor(r() * PALETA_CONFETI.length)],
      opacidad: 0.6 + r() * 0.35,
    })
  }
  return piezas
}
const CONFETI = crearConfeti()

function confetiFrame(t) {
  return CONFETI.map((p) => {
    const recorrido = H + 60
    const y = ((p.fase + p.vueltas * t) % 1) * recorrido - 30
    const x = p.x + p.vaiven * Math.sin(TAU * (2 * t + p.fase))
    const rot = p.rot0 + 360 * p.giros * t
    // "Aleteo": el papel se ve de canto y de frente al girar.
    const flip = Math.max(0.25, Math.abs(Math.cos(TAU * (2 * t + p.fase))))
    const o = fx(p.opacidad)
    const tr = `transform="translate(${fx(x)} ${fx(y)}) rotate(${fx(rot)}) scale(1 ${fx(flip)})"`
    switch (p.tipo) {
      case 'stick': {
        const w = p.tam * 2.4, h = p.tam * 0.55
        return `<rect x="${fx(-w / 2)}" y="${fx(-h / 2)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(h / 2)}" fill="${p.color}" opacity="${o}" ${tr}/>`
      }
      case 'square': {
        const s = p.tam * 0.9
        return `<rect x="${fx(-s / 2)}" y="${fx(-s / 2)}" width="${fx(s)}" height="${fx(s)}" rx="1.5" fill="${p.color}" opacity="${o}" ${tr}/>`
      }
      case 'ring':
        return `<circle cx="${fx(x)}" cy="${fx(y)}" r="${fx(p.tam * 0.6)}" fill="none" stroke="${p.color}" stroke-width="2" opacity="${o}"/>`
      default:
        return `<circle cx="${fx(x)}" cy="${fx(y)}" r="${fx(p.tam * 0.38)}" fill="${p.color}" opacity="${o}"/>`
    }
  }).join('')
}

/** Destellos que titilan (crecen y se apagan) desfasados entre sí. */
const DESTELLOS = [
  { x: 330, y: 95,  s: 16, c: C.tealDeep, fase: 0 },
  { x: 880, y: 80,  s: 20, c: C.orange,   fase: 0.35 },
  { x: 395, y: 300, s: 11, c: C.orange,   fase: 0.6 },
  { x: 820, y: 310, s: 12, c: C.teal,     fase: 0.15 },
  { x: 460, y: 55,  s: 8,  c: C.orange,   fase: 0.8 },
  { x: 760, y: 50,  s: 9,  c: C.tealDeep, fase: 0.5 },
]

function destellosFrame(t) {
  return DESTELLOS.map((d) => {
    const k = 0.5 + 0.5 * Math.sin(TAU * (t + d.fase))
    return spark(d.x, d.y, d.s * (0.45 + 0.55 * k), d.c, 0.35 + 0.6 * k)
  }).join('')
}

/** Globos que flotan en el lugar (sube-baja + vaivén del hilo). */
const GLOBOS = [
  { x: 190,  y: 140, r: 30, c: C.teal,   fase: 0 },
  { x: 135,  y: 195, r: 24, c: C.orange, fase: 0.4 },
  { x: 1010, y: 135, r: 30, c: C.orange, fase: 0.2 },
  { x: 1065, y: 190, r: 24, c: C.teal,   fase: 0.65 },
]

function globosFrame(t) {
  return GLOBOS.map((g) => {
    const dy = 7 * Math.sin(TAU * (t + g.fase))
    const sway = Math.sin(TAU * (t + g.fase + 0.25))
    return balloon(g.x + 3 * sway, g.y + dy, g.r, g.c, sway)
  }).join('')
}

// ────────────────────────────────────────────────────────────────────
// Cuadro
// ────────────────────────────────────────────────────────────────────

function frameSvg(empresa, t) {
  // 6 segmentos iguales → girar 60° por loop vuelve a la misma imagen.
  const giro = 60 * t
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="70%">
      <stop offset="0%"  stop-color="${C.bgGlow}"/>
      <stop offset="48%" stop-color="${C.bgCream}"/>
      <stop offset="100%" stop-color="${C.bgEdge}"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${C.bgCream}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  ${aperture(40, 30, 200, giro, C.watermark, 0.5)}
  ${aperture(1180, 370, 220, -giro, C.watermark, 0.5)}

  ${destellosFrame(t)}
  ${globosFrame(t)}
  ${confetiFrame(t)}

  <text x="600" y="118"
        text-anchor="middle"
        font-family="Arial, 'Segoe UI', sans-serif"
        font-weight="700"
        font-size="24"
        letter-spacing="7"
        fill="${C.orange}">¡FELIZ CUMPLEAÑOS!</text>

  <text x="600" y="228"
        text-anchor="middle"
        font-family="Arial Black, Arial, 'Segoe UI', sans-serif"
        font-weight="900"
        font-size="100"
        letter-spacing="8"
        fill="${C.teal}">${empresa.sigla}</text>

  <text x="600" y="272"
        text-anchor="middle"
        font-family="Arial, 'Segoe UI', sans-serif"
        font-weight="600"
        font-size="16"
        letter-spacing="3.5"
        fill="${C.grayDark}">${empresa.nombre}</text>
</svg>
`
}

async function renderFrame(svg) {
  return sharp(Buffer.from(svg), { density: 144 })
    .resize(W, H, { fit: 'fill' })
    .png()
    .toBuffer()
}

async function generar(clave) {
  const empresa = EMPRESAS[clave]
  const frames = []
  for (let i = 0; i < FRAMES; i++) {
    frames.push(await renderFrame(frameSvg(empresa, i / FRAMES)))
  }

  const gifPath = path.join(OUT_DIR, `${clave}-cumpleanos-animado.gif`)
  await sharp(frames, { join: { animated: true } })
    .gif({
      loop: 0,
      delay: Array(FRAMES).fill(DELAY_MS),
      effort: 10,
      dither: 0, // sin tramado: evita que el fondo "hierva" entre cuadros
      interFrameMaxError: 6,
      interPaletteMaxError: 12,
    })
    .toFile(gifPath)

  const pngPath = path.join(OUT_DIR, `${clave}-cumpleanos-animado.png`)
  fs.writeFileSync(pngPath, frames[0])

  const kb = (fs.statSync(gifPath).size / 1024).toFixed(0)
  console.log(`${empresa.sigla}: ${gifPath} (${kb} KB) · ${pngPath}`)
}

const pedidas = process.argv.slice(2)
for (const clave of pedidas.length ? pedidas : Object.keys(EMPRESAS)) {
  if (!EMPRESAS[clave]) {
    console.error(`Empresa desconocida: ${clave} (opciones: ${Object.keys(EMPRESAS).join(', ')})`)
    process.exit(1)
  }
  await generar(clave)
}
