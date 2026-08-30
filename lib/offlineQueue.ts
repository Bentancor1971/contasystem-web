'use client'

/**
 * Cola offline para cargas de comprobantes.
 *
 * Cuando no hay conexión (o el RPC de Supabase falla por red), el payload
 * se persiste en IndexedDB y se reintenta al recuperar conectividad. La
 * numeración (`numero_borrador`) la asigna el servidor al sincronizar, así
 * que en cola los items se muestran sin número.
 */

const DB_NAME = 'cs-carga-offline'
const DB_VERSION = 1
const STORE_COLA = 'cola'

export type ColaTipo = 'plantilla' | 'libre'
export type ColaRpc = 'upsert_comprobante_web' | 'upsert_comprobante_libre_web'

export interface ColaItemDisplay {
  fecha: string
  moneda_codigo: string
  monto_total: number
  descripcion: string | null
  plantilla_id: string | null
  contacto_id: string | null
  contacto_nombre: string | null
  cuenta_debe_libre_id: string | null
  cuenta_debe_libre_nombre: string | null
  cuenta_haber_libre_id: string | null
  cuenta_haber_libre_nombre: string | null
  cuenta_haber_override_id: string | null
  cuenta_haber_override_nombre: string | null
  tipo_comprobante_id: string | null
  tipo_comprobante_nombre: string | null
}

export interface ColaItem {
  id: string
  empresaId: string
  userId: string
  tipo: ColaTipo
  rpc: ColaRpc
  payload: Record<string, unknown>
  createdAt: string
  intentos: number
  ultimoError: string | null
  display: ColaItemDisplay
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_COLA)) {
        const store = db.createObjectStore(STORE_COLA, { keyPath: 'id' })
        store.createIndex('empresaId', 'empresaId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB'))
  })
}

function store(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE_COLA, mode).objectStore(STORE_COLA)
}

export function generarIdLocal(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `local-${crypto.randomUUID()}`
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Lista la cola de una empresa, filtrada por usuario.
 *
 * E2: antes filtraba sólo por `empresaId` — en un navegador compartido entre
 * operadores (mismo dispositivo de carga), el segundo que entraba veía y
 * sincronizaba los pendientes del primero, subiéndolos con su PROPIO
 * `created_by` y su nombre en el número de borrador
 * (14_numero_borrador_nombre.sql). El índice sigue siendo por `empresaId`
 * (no hace falta un índice compuesto para filtrar en memoria una lista que,
 * en la práctica, tiene a lo sumo un puñado de items).
 */
export async function listarCola(empresaId: string, userId: string): Promise<ColaItem[]> {
  try {
    const db = await open()
    return await new Promise<ColaItem[]>((resolve, reject) => {
      const req = store(db, 'readonly')
        .index('empresaId')
        .getAll(IDBKeyRange.only(empresaId))
      req.onsuccess = () => {
        const items = ((req.result as ColaItem[]) ?? []).filter(
          (item) => item.userId === userId,
        )
        // Más recientes primero
        items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        resolve(items)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function agregarACola(item: ColaItem): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const req = store(db, 'readwrite').add(item)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function actualizarEnCola(item: ColaItem): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const req = store(db, 'readwrite').put(item)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function eliminarDeCola(id: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const req = store(db, 'readwrite').delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Heurística para detectar si un error de Supabase/fetch fue por red caída
 * (vs. error de validación/permisos del servidor).
 *
 * E2 (era "clasifica de más"): antes CUALQUIER `TypeError` o mensaje con
 * "timeout"/"aborted" contaba como red — pero Postgres también dice
 * "statement timeout" y un `AbortController` propio también dice "aborted".
 * Con eso, un rechazo real del servidor podía terminar encolado como si fuera
 * un corte de conexión, y el operador nunca se enteraba de que la carga tenía
 * un problema de datos/permisos. Ahora:
 *   1. `navigator.onLine === false` sigue siendo señal fuerte y directa.
 *   2. Un error CON código (PostgREST/Postgres: RLS, 23505, JWT expirado…)
 *      NUNCA es de red, sin importar qué diga el mensaje — un fetch fallido
 *      a nivel de red no llega a tener `code`.
 *   3. Si no, sólo cuenta como red un `TypeError` cuyo mensaje mencione
 *      "fetch" — que es como los tres navegadores (Chrome, Firefox) redactan
 *      la falla real de la capa de red ("Failed to fetch",
 *      "NetworkError when attempting to fetch resource…").
 */
export function esErrorDeRed(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code) {
    return false
  }
  return err instanceof TypeError && /fetch/i.test(err.message)
}
