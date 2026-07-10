/**
 * Saneador de HTML por allowlist, sin dependencias.
 *
 * Se aplica al HTML que un usuario con `puede_ver_config` carga en
 * /configuracion/eventos y que después se inyecta en páginas públicas y mails.
 *
 * Es defensa en profundidad, NO una frontera de confianza: el control real es
 * que sólo un rol de configuración puede escribir ese HTML. Para HTML de
 * fuentes no confiables usá DOMPurify/sanitize-html.
 *
 * Implementación: tokenizador que respeta comillas (un `>` dentro de un valor
 * no termina la etiqueta). Todo `<` que no abra una etiqueta válida se escapa,
 * de modo que la salida siempre es HTML bien formado.
 */

/** Tags permitidos (texto, inline básico y estructura simple). */
const TAGS_PERMITIDOS = new Set([
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'small', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
])

/** Tags que se descartan junto con TODO su contenido. */
const TAGS_OPACOS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math',
])

/** Tags sin contenido. */
const TAGS_VACIOS = new Set(['br', 'hr', 'img'])

/** Atributos permitidos por tag (además de los globales). */
const ATTRS_POR_TAG: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
}

/** Atributos permitidos en cualquier tag. `style` y `class` quedan fuera. */
const ATTRS_GLOBALES = new Set(['title'])

const HREF_OK = /^(https?:|mailto:|tel:|#|\/)/i
const SRC_OK = /^(https?:\/\/|\/|data:image\/(png|jpe?g|gif|webp);base64,)/i

/** Escapa texto para insertarlo en HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface Attr { nombre: string; valor: string }
interface Tag {
  /** Índice justo después del `>` de cierre. */
  fin: number
  esCierre: boolean
  nombre: string
  attrs: Attr[]
  autoCierre: boolean
}

const esEspacio = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/**
 * Intenta parsear una etiqueta que empieza en `pos` (donde hay un '<').
 * Devuelve null si no es una etiqueta bien formada (p. ej. `<` suelto o
 * etiqueta sin `>` de cierre).
 */
function parseTag(s: string, pos: number): Tag | null {
  const n = s.length
  let i = pos + 1
  if (i >= n) return null

  let esCierre = false
  if (s[i] === '/') {
    esCierre = true
    i++
  }

  // Nombre de la etiqueta
  const inicioNombre = i
  while (i < n && /[a-zA-Z0-9]/.test(s[i])) i++
  if (i === inicioNombre) return null // `<` suelto, `<3`, `<!` …
  const nombre = s.slice(inicioNombre, i).toLowerCase()

  const attrs: Attr[] = []
  let autoCierre = false

  while (i < n) {
    while (i < n && esEspacio(s[i])) i++
    if (i >= n) return null // sin `>` → etiqueta incompleta

    if (s[i] === '>') return { fin: i + 1, esCierre, nombre, attrs, autoCierre }
    if (s[i] === '/' && s[i + 1] === '>') {
      autoCierre = true
      return { fin: i + 2, esCierre, nombre, attrs, autoCierre }
    }

    // Nombre del atributo
    const iniAttr = i
    while (i < n && !esEspacio(s[i]) && s[i] !== '=' && s[i] !== '>' && s[i] !== '/') i++
    if (i === iniAttr) {
      i++ // carácter raro: avanzar para no quedar en bucle
      continue
    }
    const attrNombre = s.slice(iniAttr, i).toLowerCase()

    while (i < n && esEspacio(s[i])) i++
    let valor = ''
    if (s[i] === '=') {
      i++
      while (i < n && esEspacio(s[i])) i++
      const comilla = s[i]
      if (comilla === '"' || comilla === "'") {
        // Clave: un `>` dentro de comillas NO cierra la etiqueta.
        const cierre = s.indexOf(comilla, i + 1)
        if (cierre === -1) return null // comilla sin cerrar → etiqueta inválida
        valor = s.slice(i + 1, cierre)
        i = cierre + 1
      } else {
        const iniVal = i
        while (i < n && !esEspacio(s[i]) && s[i] !== '>') i++
        valor = s.slice(iniVal, i)
      }
    }
    attrs.push({ nombre: attrNombre, valor })
  }
  return null // se acabó la entrada sin `>`
}

function valorSeguro(attr: string, valor: string): boolean {
  const v = valor.trim()
  if (attr === 'href') return HREF_OK.test(v)
  if (attr === 'src') return SRC_OK.test(v)
  return !/^\s*(javascript|vbscript|data)\s*:/i.test(v)
}

function serializaAttrs(tag: string, attrs: Attr[]): string {
  const permitidos = ATTRS_POR_TAG[tag]
  const out: string[] = []
  for (const { nombre, valor } of attrs) {
    if (nombre.startsWith('on')) continue // handlers inline
    if (!ATTRS_GLOBALES.has(nombre) && !permitidos?.has(nombre)) continue
    if (!valorSeguro(nombre, valor)) continue
    out.push(`${nombre}="${escapeHtml(valor)}"`)
  }
  if (tag === 'a' && out.some((a) => a.startsWith('href='))) {
    if (!out.some((a) => a.startsWith('rel='))) out.push('rel="noopener noreferrer"')
    if (!out.some((a) => a.startsWith('target='))) out.push('target="_blank"')
  }
  return out.length ? ' ' + out.join(' ') : ''
}

/** Salta el contenido de un tag opaco hasta su cierre. Devuelve el índice tras `</tag>`. */
function saltaOpaco(s: string, desde: number, tag: string): number {
  const re = new RegExp(`</\\s*${tag}\\s*>`, 'i')
  const resto = s.slice(desde)
  const m = re.exec(resto)
  return m ? desde + m.index + m[0].length : s.length
}

/** Sanea un fragmento de HTML. Devuelve '' si la entrada es vacía/nula. */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return ''
  const s = String(input)
  const n = s.length
  let out = ''
  let i = 0
  /** Pila de tags abiertos permitidos, para cerrarlos al final. */
  const abiertos: string[] = []

  while (i < n) {
    const lt = s.indexOf('<', i)
    if (lt === -1) {
      out += escapeTexto(s.slice(i))
      break
    }
    out += escapeTexto(s.slice(i, lt))

    // Comentarios (incluye condicionales de IE): se descartan.
    if (s.startsWith('<!--', lt)) {
      const cierre = s.indexOf('-->', lt + 4)
      i = cierre === -1 ? n : cierre + 3
      continue
    }
    // Doctype / CDATA / etc.
    if (s.startsWith('<!', lt) || s.startsWith('<?', lt)) {
      const cierre = s.indexOf('>', lt)
      i = cierre === -1 ? n : cierre + 1
      continue
    }

    const tag = parseTag(s, lt)
    if (!tag) {
      // `<` que no abre etiqueta válida → texto literal.
      out += '&lt;'
      i = lt + 1
      continue
    }

    if (TAGS_OPACOS.has(tag.nombre)) {
      i = tag.esCierre ? tag.fin : saltaOpaco(s, tag.fin, tag.nombre)
      continue
    }

    if (!TAGS_PERMITIDOS.has(tag.nombre)) {
      i = tag.fin // se descarta la etiqueta, el contenido interior queda
      continue
    }

    if (tag.esCierre) {
      const idx = abiertos.lastIndexOf(tag.nombre)
      if (idx !== -1) {
        // Cierra también los que quedaron abiertos por dentro.
        for (let k = abiertos.length - 1; k >= idx; k--) out += `</${abiertos[k]}>`
        abiertos.length = idx
      }
      i = tag.fin
      continue
    }

    if (TAGS_VACIOS.has(tag.nombre)) {
      out += `<${tag.nombre}${serializaAttrs(tag.nombre, tag.attrs)} />`
    } else {
      out += `<${tag.nombre}${serializaAttrs(tag.nombre, tag.attrs)}>`
      if (!tag.autoCierre) abiertos.push(tag.nombre)
    }
    i = tag.fin
  }

  // Cierra lo que haya quedado abierto para no romper la página anfitriona.
  for (let k = abiertos.length - 1; k >= 0; k--) out += `</${abiertos[k]}>`
  return out.trim()
}

/** Escapa `<` y `>` sueltos del texto, preservando entidades existentes. */
function escapeTexto(t: string): string {
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Reemplaza las variables de plantilla `{clave}`. Las claves desconocidas se
 * dejan tal cual. Los valores deben venir ya escapados si el destino es HTML.
 */
export function aplicarVariables(
  plantilla: string,
  vars: Record<string, string>,
): string {
  return plantilla.replace(/\{(\w+)\}/g, (full, clave: string) =>
    Object.prototype.hasOwnProperty.call(vars, clave) ? vars[clave] : full,
  )
}
