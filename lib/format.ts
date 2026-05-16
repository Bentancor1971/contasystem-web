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

/** Aplica formato uruguayo mientras el user tipea. "12450" → "12.450". "12450,5" → "12.450,5". */
export function formatMontoLive(raw: string): string {
  if (!raw) return ''
  // Permitir solo dígitos y una coma
  const cleaned = raw.replace(/[^\d,]/g, '')
  const [intPart, decPart] = cleaned.split(',')
  const intFormatted = intPart ? new Intl.NumberFormat('es-UY').format(parseInt(intPart, 10)) : ''
  if (decPart !== undefined) {
    return `${intFormatted},${decPart.slice(0, 2)}`
  }
  return intFormatted
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
