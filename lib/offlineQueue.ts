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

export async function listarCola(empresaId: string): Promise<ColaItem[]> {
  try {
    const db = await open()
    return await new Promise<ColaItem[]>((resolve, reject) => {
      const req = store(db, 'readonly')
        .index('empresaId')
        .getAll(IDBKeyRange.only(empresaId))
      req.onsuccess = () => {
        const items = (req.result as ColaItem[]) ?? []
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
 */
export function esErrorDeRed(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (err instanceof TypeError) return true // fetch tira TypeError "Failed to fetch"
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  )
}
