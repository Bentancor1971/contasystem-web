/**
 * POST /api/checkin/marcar
 * body: { empresa_id, evento_id, token }
 *
 * Marca la asistencia de una entrada. Es lo ÚNICO que la web escribe del
 * modelo de entradas: `asistio_at` / `asistio_por` / `asistio_origen`, y siempre
 * a través del RPC `marcar_asistencia_entrada` (idempotente).
 *
 * Lo usan por igual el escáner y el modo lista de /checkin.
 *
 * Dos controles que el SQL no puede hacer, porque el RPC es SECURITY DEFINER y
 * sólo recibe un token:
 *   - empresa: una entrada de otra empresa se responde 'no_encontrada' — el
 *     mismo texto que un token inexistente, para no confirmar que existe.
 *   - evento: una entrada de otro evento de la MISMA empresa se responde
 *     'otro_evento' y no se marca. Casi siempre es el operador con el evento
 *     equivocado seleccionado, o alguien con el QR de otra fecha.
 *
 * `asistio_por` sale del email de la SESIÓN, nunca del body: es la traza de
 * quién escaneó y no tiene por qué ser falsificable desde el navegador.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAccesoEmpresa } from '@/lib/checkin-auth'
import { extraerToken } from '@/lib/checkin-token'
import {
  buscarEntrada,
  contarEvento,
  leerEntradaCruda,
  marcarAsistencia,
  marcarAsistenciaScoped,
} from '@/lib/entradas'
import type { MarcarResponse } from '@/lib/entradas-types'

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

    // El cliente ya lo sanea antes de llamar, pero acá no se confía en eso.
    const token = extraerToken(body?.token)
    if (!token) {
      const res: MarcarResponse = { resultado: 'no_encontrada', entrada: null, conteo: null }
      return NextResponse.json(res)
    }

    const admin = createAdminClient()

    // P5: un solo viaje con la RPC `marcar_asistencia_scoped` (63_app_web_
    // fixes.sql) en vez de leerEntradaCruda + marcarAsistencia + contarEvento.
    // Si el SQL no está aplicado, degrada sola al camino de siempre.
    const viaRpc = await marcarAsistenciaScoped(admin, token, empresaId, eventoId, auth.email)
    if (viaRpc) {
      return NextResponse.json(viaRpc)
    }

    const cruda = await leerEntradaCruda(admin, token)

    if (!cruda || cruda.empresa_id !== empresaId) {
      const res: MarcarResponse = { resultado: 'no_encontrada', entrada: null, conteo: null }
      return NextResponse.json(res)
    }

    if (cruda.evento_id !== eventoId) {
      const { entrada } = await buscarEntrada(admin, token)
      const res: MarcarResponse = {
        resultado: 'otro_evento',
        entrada: entrada ?? null,
        conteo: null,
      }
      return NextResponse.json(res)
    }

    const { resultado, entrada } = await marcarAsistencia(admin, token, auth.email)
    const conteo = await contarEvento(admin, empresaId, eventoId)

    const res: MarcarResponse = { resultado, entrada: entrada ?? null, conteo }
    return NextResponse.json(res)
  } catch (err) {
    console.error('[POST /api/checkin/marcar] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
