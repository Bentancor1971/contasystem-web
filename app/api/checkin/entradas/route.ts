/**
 * GET /api/checkin/entradas?empresa_id=&evento_id=&q=&rol=&orden=
 *
 * Listado de entradas de un evento para el CONTROL MANUAL de /checkin — el
 * respaldo cuando el QR no se puede leer (pantalla rota, brillo al mínimo, mail
 * perdido) y la forma de pasar lista a mano.
 *
 * Sólo lectura: marcar sigue yendo por POST /api/checkin/marcar, así el camino
 * de escritura es uno solo para la cámara y para la lista.
 *
 * Parámetros:
 *   q      · busca por nombre completo o documento.
 *   rol    · rol del evento. Ausente = sólo asistentes (el caso normal en la
 *            puerta); `__todos__` = sin filtrar; cualquier otro = exacto.
 *            El bucket de asistentes incluye las entradas sin rol asignado.
 *   orden  · 'nombre' (como lo guardó el desktop) | 'apellido' (pasar lista).
 *
 * Autorización: caller miembro de `empresa_id` (ver lib/checkin-auth).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAccesoEmpresa } from '@/lib/checkin-auth'
import { contarEvento, resolverNombres } from '@/lib/entradas'
import {
  ROL_ASISTENTE,
  ROL_TODOS,
  type EntradaListada,
  type OrdenLista,
} from '@/lib/entradas-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Filas que se devuelven al navegador. */
const LIMIT = 200
/**
 * Filas que se leen antes de ordenar. El orden por apellido se resuelve acá
 * (hace falta la ficha del socio), así que hay que traer más que `LIMIT` o el
 * recorte se haría sobre el orden equivocado.
 */
const FETCH_CAP = 1000

interface FilaCruda {
  token: string
  nombre_completo: string
  documento: string | null
  categoria_nombre: string | null
  rol_nombre: string | null
  numero: string | null
  estado: 'valida' | 'anulada'
  asistio_at: string | null
  asistio_por: string | null
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const empresaId = sp.get('empresa_id') ?? ''
    const eventoId = sp.get('evento_id') ?? ''
    const q = (sp.get('q') ?? '').trim()
    const rol = sp.get('rol') ?? ROL_ASISTENTE
    const orden: OrdenLista = sp.get('orden') === 'apellido' ? 'apellido' : 'nombre'

    const auth = await assertAccesoEmpresa(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!eventoId) {
      return NextResponse.json({ error: 'evento_id requerido' }, { status: 400 })
    }

    const admin = createAdminClient()

    let query = admin
      .from('entradas_remoto')
      .select(
        'token, nombre_completo, documento, categoria_nombre, rol_nombre, numero, estado, asistio_at, asistio_por',
        { count: 'exact' },
      )
      .eq('empresa_id', empresaId)
      .eq('evento_id', eventoId)

    if (rol === ROL_ASISTENTE) {
      // Sin rol asignado = asistente: así lo trata el desktop, y si no la
      // mayoría de la gente no aparecería en el filtro por defecto.
      query = query.or(`rol_nombre.eq.${ROL_ASISTENTE},rol_nombre.is.null`)
    } else if (rol !== ROL_TODOS) {
      query = query.eq('rol_nombre', rol)
    }

    if (q) {
      // Escapar los wildcards de LIKE, y sacar los caracteres que PostgREST usa
      // como separadores dentro de `or(...)` — una coma en el término partiría
      // el filtro en dos y devolvería cualquier cosa.
      const esc = q.replace(/([\\%_])/g, '\\$1').replace(/[,()"]/g, ' ')
      query = query.or(`nombre_completo.ilike.%${esc}%,documento.ilike.%${esc}%`)
    }

    const [{ data, error, count }, conteo] = await Promise.all([
      query.order('nombre_completo', { ascending: true }).limit(FETCH_CAP),
      contarEvento(admin, empresaId, eventoId),
    ])

    if (error) {
      return NextResponse.json(
        { error: `Error consultando entradas: ${error.message}` },
        { status: 500 },
      )
    }

    const crudas = (data ?? []) as FilaCruda[]

    // Nombre y apellido separados: sólo hacen falta para ordenar y mostrar
    // "APELLIDO, Nombre", así que se resuelven en una sola consulta por tanda.
    const fichas = await resolverNombres(
      admin,
      crudas.map((f) => f.documento ?? ''),
      empresaId,
    )

    const entradas: EntradaListada[] = crudas.map((f) => {
      const ficha = f.documento ? fichas.get(f.documento.trim()) : undefined
      return {
        ...f,
        nombre: ficha?.nombre ?? null,
        apellido: ficha?.apellido ?? null,
      }
    })

    const clave = (e: EntradaListada) =>
      orden === 'apellido' && e.apellido
        ? `${e.apellido} ${e.nombre ?? ''}`.trim()
        : e.nombre_completo
    entradas.sort((a, b) => clave(a).localeCompare(clave(b), 'es', { sensitivity: 'base' }))

    return NextResponse.json({
      entradas: entradas.slice(0, LIMIT),
      total: count ?? entradas.length,
      limit: LIMIT,
      orden,
      rol,
      conteo,
    })
  } catch (err) {
    console.error('[GET /api/checkin/entradas] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
