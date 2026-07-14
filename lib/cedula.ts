/**
 * Validación de cédula de identidad uruguaya (dígito verificador).
 *
 * Sin imports server-only: se usa en el server (inscribir/lookup) y en el
 * formulario público.
 *
 * OJO — sólo se exige a quien NO está en la base. El padrón que pushea el
 * desktop tiene documentos históricos que no pasan el DV (extranjeros, cédulas
 * viejas, números de socio cargados como documento): a esos NO se les puede
 * exigir un DV válido sin dejarlos afuera de su propio evento. La validación
 * existe para atajar el error de tipeo de alguien que se registra por primera
 * vez, no para reescribir el padrón.
 */

/** Coeficientes del dígito verificador de la CI uruguaya (7 dígitos + DV). */
const COEFICIENTES = [2, 9, 8, 7, 6, 3, 4]

/**
 * true si `documento` es una cédula uruguaya con dígito verificador correcto.
 * Acepta con o sin puntos/guiones. Cualquier cosa que no sean dígitos (una letra
 * de un pasaporte, por ejemplo) es inválida acá.
 */
export function esCedulaUruguayaValida(documento: string): boolean {
  const digitos = documento.replace(/[\s.\-]/g, '')
  if (!/^\d+$/.test(digitos)) return false
  // Con DV: 7 u 8 dígitos (las de 7 son cédulas viejas, con el millón implícito).
  if (digitos.length < 7 || digitos.length > 8) return false

  // Se completa a 8 con ceros a la izquierda: los 7 primeros son el número y el
  // último el verificador.
  const ci = digitos.padStart(8, '0')
  const suma = COEFICIENTES.reduce((acc, coef, i) => acc + coef * Number(ci[i]), 0)
  const dv = (10 - (suma % 10)) % 10
  return dv === Number(ci[7])
}
