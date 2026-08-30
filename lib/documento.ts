/**
 * Normalización y hash de documentos (cédula/CI).
 *
 * ⚠️ `hashDocumento` de acá NO coincide con `socios_datos.documento_hash`: el
 * desktop calcula ESE hash en base36 corto (ver
 * `src/lib/modules/socios-datos.ts` en el repo desktop), mientras que acá es
 * SHA-256 hex. Por eso la ficha del padrón se busca por `documento` EN CLARO
 * (ver `resolverParticipante` en lib/eventos.ts), nunca comparando hashes: los
 * dos algoritmos nunca van a coincidir, y "optimizar" ese lookup a una
 * comparación de hash dejaría a todo el padrón como "no encontrado".
 *
 * El `hashDocumento` de este archivo es el propio de la web: sólo se usa para
 * el `documento_hash` de `inscripciones_evento_remoto` / `pagos_evento_remoto`
 * (dedupe y búsqueda DENTRO de esas tablas), donde no hace falta coincidir con
 * nada del desktop — son dos hash de documento distintos, con dueños distintos.
 *
 *   - normalizeDocumento: elimina espacios, puntos y guiones (deja el resto tal cual).
 *   - hashDocumento: SHA-256 (hex) del texto normalizado, codificado UTF-8.
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
