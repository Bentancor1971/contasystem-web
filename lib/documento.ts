/**
 * Normalización y hash de documentos (cédula/CI).
 *
 * DEBE coincidir 1:1 con contasystem-desktop `src/utils/crypto.ts`:
 *   - normalizeDocumento: elimina espacios, puntos y guiones (deja el resto tal cual).
 *   - hashDocumento: SHA-256 (hex) del texto normalizado, codificado UTF-8.
 *
 * Se usa para buscar un socio por cédula contra `socios_datos.documento_hash`
 * sin exponer ni almacenar la cédula en claro en el flujo público.
 */

import { createHash } from 'node:crypto'

/** Elimina espacios, puntos y guiones. Mismo criterio que el desktop. */
export function normalizeDocumento(documento: string): string {
  return documento.replace(/[\s.\-]/g, '')
}

/** SHA-256 hex del documento normalizado (idéntico a socios_datos.documento_hash). */
export function hashDocumento(documento: string): string {
  const normalized = normalizeDocumento(documento)
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}
