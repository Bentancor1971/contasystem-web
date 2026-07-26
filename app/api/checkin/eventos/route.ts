/**
 * GET /api/checkin/eventos?empresa_id=...&dias=...
 *
 * Eventos con QRs emitidos, para el selector de /checkin. Devuelve además el
 * contador presentes/total de cada uno, que es lo que se muestra en la puerta.
 *
 * Sale de `entradas_remoto` y no de `eventos_remoto` a propósito: sólo tiene
 * sentido controlar la puerta de un evento que efectivamente emitió entradas.
 *
 * `dias` (default 60) acota hacia atrás por fecha del evento — sin ese corte la
 * consulta crecería con el histórico completo. Los eventos sin fecha cargada
 * entran siempre.
 *
 * Autorización: caller miembro de `empresa_id` (ver lib/checkin-auth).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAccesoEmpresa } from '@/lib/checkin-auth'
import { ROL_ASISTENTE, esAsistente, type EventoCheckin } from '@/lib/entradas-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DIAS_DEFAULT = 60
const DIAS_MAX = 3650
/** Tope duro de filas leídas. Con el corte por fecha nunca debería acercarse. */
const SCAN_LIMIT = 20000

interface Fila {
  evento_id: string
  evento_nombre: string
  evento_fecha: string | null
  evento_lugar: string | null
  estado: string
  asistio_at: string | null
  rol_nombre: string | null
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const empresaId = sp.get('empresa_id') ?? ''

    const auth = await assertAccesoEmpresa(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const diasRaw = Number(sp.get('dias'))
    const dias =
      Number.isFinite(diasRaw) && diasRaw > 0 ? Math.min(diasRaw, DIAS_MAX) : DIAS_DEFAULT

    const desde = new Date()
    desde.setUTCDate(desde.getUTCDate() - dias)
    const desdeISO = desde.toISOString().slice(0, 10)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('entradas_remoto')
      .select('evento_id, evento_nombre, evento_fecha, evento_lugar, estado, asistio_at, rol_nombre')
      .eq('empresa_id', empresaId)
      .or(`evento_fecha.gte.${desdeISO},evento_fecha.is.null`)
      .limit(SCAN_LIMIT)

    if (error) {
      return NextResponse.json(
        { error: `Error consultando entradas: ${error.message}` },
        { status: 500 },
      )
    }

    // Agrupado en memoria: PostgREST no expone GROUP BY y la cantidad de
    // eventos en la ventana es chica.
    const porEvento = new Map<string, EventoCheckin>()
    // Roles por evento: se cuentan acá y viajan con el evento, así el control
    // manual arma sus filtros sin volver a barrer todas las entradas.
    const rolesPorEvento = new Map<string, Map<string, number>>()

    for (const f of (data ?? []) as Fila[]) {
      let ev = porEvento.get(f.evento_id)
      if (!ev) {
        ev = {
          evento_id: f.evento_id,
          evento_nombre: f.evento_nombre,
          evento_fecha: f.evento_fecha,
          evento_lugar: f.evento_lugar,
          total: 0,
          presentes: 0,
          roles: [],
        }
        porEvento.set(f.evento_id, ev)
        rolesPorEvento.set(f.evento_id, new Map())
      }
      // Las anuladas no suman al total: no son gente que pueda llegar, y
      // dejarlas haría que el contador nunca cierre.
      if (f.estado === 'anulada') continue
      ev.total++
      if (f.asistio_at) ev.presentes++

      // Sin rol asignado = asistente, igual que en el desktop.
      const rol = esAsistente(f.rol_nombre) ? ROL_ASISTENTE : f.rol_nombre!
      const cuenta = rolesPorEvento.get(f.evento_id)!
      cuenta.set(rol, (cuenta.get(rol) ?? 0) + 1)
    }

    for (const [id, cuenta] of rolesPorEvento) {
      const ev = porEvento.get(id)
      if (!ev) continue
      // Asistente primero (es el filtro por defecto); el resto alfabético.
      ev.roles = [...cuenta.entries()]
        .map(([nombre, total]) => ({ nombre, total }))
        .sort((a, b) => {
          if (a.nombre === ROL_ASISTENTE) return -1
          if (b.nombre === ROL_ASISTENTE) return 1
          return a.nombre.localeCompare(b.nombre, 'es')
        })
    }

    // Más recientes primero; los sin fecha al final.
    const eventos = [...porEvento.values()].sort((a, b) => {
      if (a.evento_fecha === b.evento_fecha) {
        return a.evento_nombre.localeCompare(b.evento_nombre, 'es')
      }
      if (!a.evento_fecha) return 1
      if (!b.evento_fecha) return -1
      return b.evento_fecha.localeCompare(a.evento_fecha)
    })

    return NextResponse.json({ eventos })
  } catch (err) {
    console.error('[GET /api/checkin/eventos] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
