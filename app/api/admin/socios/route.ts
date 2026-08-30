/**
 * GET /api/admin/socios?empresa_id=...&filter_empresa=...&mes=...&q=...&estado=...
 *
 * Listado de socios para el panel /configuracion/personas. Solo lectura.
 *
 * - `empresa_id`     · empresa activa del caller (para autorización).
 * - `filter_empresa` · opcional, filtra los socios por esa empresa.
 *                      Si se omite, devuelve socios de todas las empresas
 *                      del registro (empresas_api_keys).
 * - `mes`            · opcional, 1..12. Filtra por mes de cumpleaños.
 * - `q`              · opcional, búsqueda ilike sobre nombre + apellido.
 * - `estado`         · opcional, valor exacto de `estado_registro_nombre`.
 *                      Valor especial `__none__` = sin estado registrado.
 *
 * Además devuelve `estados`: lista de valores distintos presentes en el
 * scope de empresas (para poblar el dropdown del cliente).
 *
 * Autorización: caller con `puede_ver_config` en `empresa_id` Y el scope de
 * empresas se restringe a las que el caller tiene asignadas (E7, decisión:
 * cerrar el cruce de tenant) — antes, sin `filter_empresa`, se devolvía el
 * padrón de TODAS las empresas del registro.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertPuedeVerConfig,
  empresasAccesiblesParaUsuario,
} from '@/lib/birthday-auth'
import { loadEmpresasRegistro } from '@/lib/birthday-template-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIMIT = 200
/** Cap de filas leídas para extraer estados únicos. Más que de sobra: típicamente hay <20 estados distintos. */
const ESTADOS_SCAN_LIMIT = 5000
/** Valor especial en el query param para representar "estado nulo". */
const ESTADO_NULL_SENTINEL = '__none__'

interface SocioRow {
  id: string
  nombre: string | null
  apellido: string | null
  mail: string | null
  fecha_nacimiento: string | null
  empresa_id: string | null
  estado_registro_nombre: string | null
}

/**
 * Cache de módulo para los estados distintos de un scope de empresas. Antes
 * se recalculaban con un scan de hasta 5.000 filas en CADA tecla de la
 * búsqueda (el debounce del cliente dispara un GET nuevo, y los estados no
 * dependen de `q`/`mes` — sólo del scope de empresas, que casi nunca cambia
 * mientras se escribe). TTL corto: un estado nuevo en el padrón tarda como
 * mucho 5 min en aparecer en el dropdown, y se sirve de memoria el resto del
 * tiempo. Vive por instancia de función (se resetea en cold start).
 */
const ESTADOS_CACHE_TTL_MS = 5 * 60 * 1000
const estadosCache = new Map<
  string,
  { at: number; estados: string[]; tieneSinEstado: boolean }
>()

async function estadosDistintos(
  admin: SupabaseClient,
  scopeIds: string[],
): Promise<{ estados: string[]; tieneSinEstado: boolean }> {
  const key = [...scopeIds].sort().join(',')
  const cached = estadosCache.get(key)
  if (cached && Date.now() - cached.at < ESTADOS_CACHE_TTL_MS) {
    return { estados: cached.estados, tieneSinEstado: cached.tieneSinEstado }
  }

  const { data, error } = await admin
    .from('socios_datos')
    .select('estado_registro_nombre')
    .is('deleted_at', null)
    .in('empresa_id', scopeIds)
    .limit(ESTADOS_SCAN_LIMIT)
  if (error) throw new Error(`Error consultando estados: ${error.message}`)

  let huboNull = false
  const set = new Set<string>()
  for (const r of (data ?? []) as { estado_registro_nombre: string | null }[]) {
    const v = r.estado_registro_nombre?.trim()
    if (v) set.add(v)
    else huboNull = true
  }
  const estados = [...set].sort((a, b) => a.localeCompare(b, 'es'))
  estadosCache.set(key, { at: Date.now(), estados, tieneSinEstado: huboNull })
  return { estados, tieneSinEstado: huboNull }
}

/** PostgREST cuando no encuentra la función pedida (falta aplicar el SQL). */
function esRpcInexistente(code: string | undefined): boolean {
  return code === 'PGRST202' || code === '42883'
}

async function personasPorCumpleanosRpc(
  admin: SupabaseClient,
  scopeIds: string[],
  mesMM: string | null,
  qEsc: string,
  estadoRaw: string,
): Promise<{ socios: SocioRow[]; total: number } | undefined> {
  const { data, error } = await admin.rpc('personas_por_cumpleanos', {
    p_empresa_ids: scopeIds,
    p_mes_mm: mesMM,
    p_q: qEsc || null,
    p_estado: estadoRaw || null,
    p_limit: LIMIT,
  })
  if (error) {
    if (esRpcInexistente(error.code)) {
      console.warn(
        '[socios] RPC personas_por_cumpleanos no existe todavía · aplicar 63_app_web_fixes.sql',
      )
      return undefined
    }
    throw new Error(`Error consultando socios: ${error.message}`)
  }
  const rows = (data ?? []) as (SocioRow & { total_filtrado: number })[]
  const total = rows.length > 0 ? Number(rows[0].total_filtrado) : 0
  const socios = rows.map(({ total_filtrado: _total_filtrado, ...r }) => r)
  return { socios, total }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const empresaId = sp.get('empresa_id') ?? ''
    const filterEmpresa = sp.get('filter_empresa')?.trim() || null
    const mesRaw = sp.get('mes')?.trim() || null
    const qRaw = sp.get('q')?.trim() || ''
    const estadoRaw = sp.get('estado')?.trim() || ''

    const auth = await assertPuedeVerConfig(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createAdminClient()
    const accesibles = await empresasAccesiblesParaUsuario(auth.userId)
    // E7: el registro completo se filtra a las empresas del caller ANTES de
    // construir el scope — así ni el selector de empresas ni "todas" (sin
    // filter_empresa) exponen el padrón de una empresa ajena.
    const empresas = (await loadEmpresasRegistro(admin)).filter((e) =>
      accesibles.has(e.empresaId),
    )
    const empresaIds = empresas.map((e) => e.empresaId)

    // Si filterEmpresa viene pero no está en el registro (ya filtrado por
    // acceso), no devolvemos nada.
    let scopeIds: string[] = empresaIds
    if (filterEmpresa) {
      scopeIds = empresaIds.includes(filterEmpresa) ? [filterEmpresa] : []
    }

    if (scopeIds.length === 0) {
      return NextResponse.json({
        empresas,
        socios: [],
        total: 0,
        limit: LIMIT,
        estados: [],
      })
    }

    // Validar mes: 1..12 → "01".."12"
    let mesMM: string | null = null
    if (mesRaw) {
      const n = Number(mesRaw)
      if (Number.isInteger(n) && n >= 1 && n <= 12) {
        mesMM = String(n).padStart(2, '0')
      }
    }

    const qEsc = qRaw ? qRaw.replace(/([\\%_])/g, '\\$1') : ''

    // P: antes se ordenaba por apellido en SQL, se recortaba a LIMIT, y RECIÉN
    // ahí el cliente reordenaba por mes-día de cumpleaños — el "primeras 200"
    // que se le mostraba al usuario no era el top 200 por cumpleaños. La RPC
    // `personas_por_cumpleanos` (63_app_web_fixes.sql) ordena por
    // substr(fecha_nacimiento,6,5) ANTES del LIMIT. Si el SQL no está
    // aplicado, degrada sola al camino de siempre (orden por apellido).
    const [porRpc, { estados, tieneSinEstado }] = await Promise.all([
      personasPorCumpleanosRpc(admin, scopeIds, mesMM, qEsc, estadoRaw),
      estadosDistintos(admin, scopeIds),
    ])

    if (porRpc) {
      return NextResponse.json({
        empresas,
        socios: porRpc.socios,
        total: porRpc.total,
        limit: LIMIT,
        estados,
        tieneSinEstado,
      })
    }

    // ── Fallback: SQL 63 no aplicado ──────────────────────────────────────
    // Query base — count exacto para mostrar "X de N" cuando se trunca.
    let query = admin
      .from('socios_datos')
      .select(
        'id, nombre, apellido, mail, fecha_nacimiento, empresa_id, estado_registro_nombre',
        { count: 'exact' },
      )
      .is('deleted_at', null)
      .in('empresa_id', scopeIds)

    if (mesMM) {
      // fecha_nacimiento es TEXT ISO YYYY-MM-DD. `_` matchea 1 char en LIKE.
      query = query.like('fecha_nacimiento', `____-${mesMM}-%`)
    }

    if (qRaw) {
      query = query.or(`nombre.ilike.%${qEsc}%,apellido.ilike.%${qEsc}%`)
    }

    if (estadoRaw) {
      if (estadoRaw === ESTADO_NULL_SENTINEL) {
        query = query.is('estado_registro_nombre', null)
      } else {
        query = query.eq('estado_registro_nombre', estadoRaw)
      }
    }

    // Orden: por mes-día de cumpleaños (los sin fecha al final), luego apellido.
    // Sin la RPC no es trivial ordenar por substring desde PostgREST, así que
    // ordenamos por apellido — el recorte de LIMIT queda aproximado hasta que
    // se aplique 63_app_web_fixes.sql (el cliente reordena visualmente, pero
    // sobre este subconjunto).
    query = query
      .order('apellido', { ascending: true, nullsFirst: false })
      .order('nombre', { ascending: true, nullsFirst: false })
      .limit(LIMIT)

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json(
        { error: `Error consultando socios: ${error.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({
      empresas,
      socios: (data ?? []) as SocioRow[],
      total: count ?? (data?.length ?? 0),
      limit: LIMIT,
      estados,
      tieneSinEstado,
    })
  } catch (err) {
    console.error('[GET /api/admin/socios] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
