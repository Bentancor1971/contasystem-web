/**
 * Helpers de formato (Uruguay: punto miles, coma decimal).
 */

/** Formatea un número con punto como separador de miles y coma decimal. Ej: 12450.5 → "12.450,50" */
export function formatMonto(n: number): string {
  return new Intl.NumberFormat('es-UY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Parsea "12.450,50" (formato UY) → 12450.5. Devuelve NaN si no es válido. */
export function parseMonto(s: string): number {
  if (!s) return NaN
  // Quitar separadores de miles (puntos) y reemplazar coma decimal por punto
  const normalized = s.replace(/\./g, '').replace(',', '.')
  return parseFloat(normalized)
}

/** Aplica formato uruguayo mientras el user tipea. "12450" → "12.450". "12450,5" → "12.450,5".
 *  Conserva un signo "-" inicial para permitir importes negativos. */
export function formatMontoLive(raw: string): string {
  if (!raw) return ''
  const neg = raw.trimStart().startsWith('-')
  const sign = neg ? '-' : ''
  // Permitir solo dígitos y una coma (el signo se maneja aparte)
  const cleaned = raw.replace(/[^\d,]/g, '')
  if (!cleaned) return sign
  const [intPart, decPart] = cleaned.split(',')
  const intFormatted = intPart ? new Intl.NumberFormat('es-UY').format(parseInt(intPart, 10)) : ''
  if (decPart !== undefined) {
    return `${sign}${intFormatted},${decPart.slice(0, 2)}`
  }
  return `${sign}${intFormatted}`
}

// ── Importe como expresión aritmética (suma, resta, etc.) ──────────────────

/** Deja solo los caracteres válidos de un importe/expresión: dígitos,
 *  separadores (coma/punto), operadores + - * / y paréntesis. */
export function sanitizeMontoInput(raw: string): string {
  return raw.replace(/[^0-9.,+\-*/() ]/g, '')
}

/** True si el texto es una operación aritmética y no un número simple.
 *  Un "-" inicial cuenta como signo (negativo), no como operación. */
export function esExpresionMonto(s: string): boolean {
  const sinSigno = s.trim().replace(/^-/, '')
  return /[+\-*/()]/.test(sinSigno)
}

/**
 * Evalúa una expresión de importe en formato UY (punto = miles, coma = decimal)
 * admitiendo + - * / y paréntesis. Devuelve el número resultante o NaN.
 * Seguro: usa un parser propio, nunca eval()/new Function().
 */
export function evaluarMonto(s: string): number {
  if (!s || !s.trim()) return NaN
  // Normalizar formato UY → notación JS: quitar puntos de miles, coma → punto
  const expr = s.replace(/\./g, '').replace(/,/g, '.')
  // Validar que solo contenga la gramática permitida
  if (!/^[0-9+\-*/()\s.]+$/.test(expr)) return NaN
  try {
    return evalAritmetica(expr)
  } catch {
    return NaN
  }
}

/** Parser recursivo-descendente de aritmética básica: + - * / y paréntesis. */
function evalAritmetica(s: string): number {
  let i = 0
  const skipWs = () => {
    while (i < s.length && s[i] === ' ') i++
  }

  function parseExpr(): number {
    let v = parseTerm()
    for (;;) {
      skipWs()
      const c = s[i]
      if (c === '+') {
        i++
        v += parseTerm()
      } else if (c === '-') {
        i++
        v -= parseTerm()
      } else break
    }
    return v
  }

  function parseTerm(): number {
    let v = parseFactor()
    for (;;) {
      skipWs()
      const c = s[i]
      if (c === '*') {
        i++
        v *= parseFactor()
      } else if (c === '/') {
        i++
        v /= parseFactor()
      } else break
    }
    return v
  }

  function parseFactor(): number {
    skipWs()
    const c = s[i]
    if (c === '+') {
      i++
      return parseFactor()
    }
    if (c === '-') {
      i++
      return -parseFactor()
    }
    if (c === '(') {
      i++
      const v = parseExpr()
      skipWs()
      if (s[i] !== ')') throw new Error('paréntesis sin cerrar')
      i++
      return v
    }
    let num = ''
    while (i < s.length && (/[0-9]/.test(s[i]) || s[i] === '.')) {
      num += s[i]
      i++
    }
    if (!num) throw new Error('número esperado')
    const n = parseFloat(num)
    if (!isFinite(n)) throw new Error('número inválido')
    return n
  }

  const result = parseExpr()
  skipWs()
  if (i !== s.length) throw new Error('texto sobrante')
  if (!isFinite(result)) throw new Error('resultado no finito')
  return result
}

/** Maneja el cambio en un campo de importe: formateo vivo para números
 *  simples; texto crudo (sanitizado) cuando se está escribiendo una operación. */
export function onMontoInput(raw: string): string {
  const sane = sanitizeMontoInput(raw)
  return esExpresionMonto(sane) ? sane : formatMontoLive(sane)
}

/** Al salir del campo: evalúa la expresión y deja el número formateado.
 *  Si la expresión es inválida, conserva el texto para que el usuario corrija. */
export function normalizarMonto(s: string): string {
  if (!s || !s.trim()) return ''
  const n = evaluarMonto(s)
  return isFinite(n) ? formatMonto(n) : s
}

/** Formatea fecha ISO (YYYY-MM-DD) a "dd/mm/yyyy". */
export function formatFecha(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Fecha de hoy en formato ISO YYYY-MM-DD (zona local). */
export function hoyISO(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Símbolo de moneda. */
export function simboloMoneda(codigo: string): string {
  switch (codigo.toUpperCase()) {
    case 'UYU': return '$'
    case 'USD': return 'US$'
    case 'EUR': return '€'
    default: return codigo
  }
}
