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
 * Autorización: caller con `puede_ver_config` en `empresa_id`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertPuedeVerConfig } from '@/lib/birthday-auth'
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
    const empresas = await loadEmpresasRegistro(admin)
    const empresaIds = empresas.map((e) => e.empresaId)

    // Si filterEmpresa viene pero no está en el registro, no devolvemos nada.
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
      // Escapar wildcards de Postgres en el término de búsqueda.
      const esc = qRaw.replace(/([\\%_])/g, '\\$1')
      query = query.or(`nombre.ilike.%${esc}%,apellido.ilike.%${esc}%`)
    }

    if (estadoRaw) {
      if (estadoRaw === ESTADO_NULL_SENTINEL) {
        query = query.is('estado_registro_nombre', null)
      } else {
        query = query.eq('estado_registro_nombre', estadoRaw)
      }
    }

    // Orden: por mes-día de cumpleaños (los sin fecha al final), luego apellido.
    // En Supabase no es trivial ordenar por substring, así que ordenamos por
    // fecha_nacimiento textual (NULLS LAST) y luego por apellido — el textual
    // pone año primero, pero ordenar por mes/día se hace en el cliente.
    query = query
      .order('apellido', { ascending: true, nullsFirst: false })
      .order('nombre', { ascending: true, nullsFirst: false })
      .limit(LIMIT)

    // Lista de estados distintos en el scope de empresas (sin aplicar los
    // demás filtros — así el dropdown no se vacía al filtrar por mes/q).
    const estadosQuery = admin
      .from('socios_datos')
      .select('estado_registro_nombre')
      .is('deleted_at', null)
      .in('empresa_id', scopeIds)
      .limit(ESTADOS_SCAN_LIMIT)

    const [
      { data, error, count },
      { data: estadosData, error: estadosErr },
    ] = await Promise.all([query, estadosQuery])

    if (error) {
      return NextResponse.json(
        { error: `Error consultando socios: ${error.message}` },
        { status: 500 },
      )
    }
    if (estadosErr) {
      return NextResponse.json(
        { error: `Error consultando estados: ${estadosErr.message}` },
        { status: 500 },
      )
    }

    let huboNull = false
    const estadosSet = new Set<string>()
    for (const r of (estadosData ?? []) as {
      estado_registro_nombre: string | null
    }[]) {
      const v = r.estado_registro_nombre?.trim()
      if (v) estadosSet.add(v)
      else huboNull = true
    }
    const estados = [...estadosSet].sort((a, b) => a.localeCompare(b, 'es'))

    return NextResponse.json({
      empresas,
      socios: (data ?? []) as SocioRow[],
      total: count ?? (data?.length ?? 0),
      limit: LIMIT,
      estados,
      tieneSinEstado: huboNull,
    })
  } catch (err) {
    console.error('[GET /api/admin/socios] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
