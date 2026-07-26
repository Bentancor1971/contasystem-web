/**
 * POST /api/checkin/desmarcar
 * body: { empresa_id, evento_id, token }
 *
 * Da de baja una asistencia marcada por error. Es la vuelta atrás del marcado:
 * misma autorización, mismo scope por empresa y evento, misma forma de
 * respuesta.
 *
 * Requiere `supabase/desmarcar_asistencia.sql`. Si esa migración no está
 * corrida, se responde 501 con el nombre del archivo en vez de un 500 opaco.
 *
 * A propósito NO se expone desde el escáner: la cámara sirve para dejar entrar
 * gente, y un desmarcado accidental por un QR que quedó enfrente sería
 * exactamente el problema que esta pantalla viene a resolver. Se corrige desde
 * el control manual, con confirmación.
 *
 * `desmarcada_por` sale del email de la SESIÓN, nunca del body: es la traza de
 * quién revirtió la asistencia.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAccesoEmpresa } from '@/lib/checkin-auth'
import { extraerToken } from '@/lib/checkin-token'
import {
  buscarEntrada,
  contarEvento,
  desmarcarAsistencia,
  leerEntradaCruda,
  MigracionFaltante,
} from '@/lib/entradas'
import type { DesmarcarResponse } from '@/lib/entradas-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      empresa_id?: string
      evento_id?: string
      token?: string
    } | null

    const empresaId = body?.empresa_id ?? ''
    const eventoId = body?.evento_id ?? ''

    const auth = await assertAccesoEmpresa(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!eventoId) {
      return NextResponse.json({ error: 'evento_id requerido' }, { status: 400 })
    }

    const token = extraerToken(body?.token)
    if (!token) {
      const res: DesmarcarResponse = { resultado: 'no_encontrada', entrada: null, conteo: null }
      return NextResponse.json(res)
    }

    const admin = createAdminClient()
    const cruda = await leerEntradaCruda(admin, token)

    // Otra empresa se responde como inexistente, igual que en /marcar: no se
    // confirma que el token exista.
    if (!cruda || cruda.empresa_id !== empresaId) {
      const res: DesmarcarResponse = { resultado: 'no_encontrada', entrada: null, conteo: null }
      return NextResponse.json(res)
    }

    if (cruda.evento_id !== eventoId) {
      const { entrada } = await buscarEntrada(admin, token)
      const res: DesmarcarResponse = {
        resultado: 'otro_evento',
        entrada: entrada ?? null,
        conteo: null,
      }
      return NextResponse.json(res)
    }

    const { resultado, entrada } = await desmarcarAsistencia(admin, token, auth.email)
    const conteo = await contarEvento(admin, empresaId, eventoId)

    const res: DesmarcarResponse = { resultado, entrada: entrada ?? null, conteo }
    return NextResponse.json(res)
  } catch (err) {
    if (err instanceof MigracionFaltante) {
      return NextResponse.json({ error: err.message }, { status: 501 })
    }
    console.error('[POST /api/checkin/desmarcar] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
