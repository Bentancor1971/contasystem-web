/**
 * POST /api/ficha/[token]/validar   body: { factor }
 *
 * Endpoint PÚBLICO. Segundo factor de la ficha: los últimos N dígitos del
 * documento (cédula válida) o el código corto del mail (cédula inválida).
 * Recién si acierta, `validar_credencial_ficha` entrega la identidad y este
 * handler lee los datos personales de socios_datos —con el scope del padrón,
 * como eventos— para prefillar el formulario. Antes de eso no sale nada.
 *
 * El conteo de intentos y el bloqueo (5 fallos → 15 minutos) los lleva la
 * base, por credencial. El tope por IP de este handler cubre lo otro: al que
 * prueba muchas credenciales distintas.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerFichaPersonal, ocultarInexistente, validarCredencialFicha } from '@/lib/ficha'
import { esError, tokenValido, type FichaValidada } from '@/lib/ficha-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { factorDelBody, SIN_CACHE } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: { factor?: unknown }
    try {
      body = (await req.json()) as { factor?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }

    const factor = factorDelBody(body.factor)
    // Un token mal formado y un factor con basura salen por la misma puerta que
    // un factor equivocado: nada de lo que responde este handler permite
    // deducir si la credencial existe.
    if (!tokenValido(token) || factor === null) {
      return NextResponse.json({ error: 'factor_incorrecto' }, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.fichaValidar))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(await validarCredencialFicha(admin, token, factor))
    if (esError(r)) {
      return NextResponse.json(r, { headers: SIN_CACHE })
    }

    // Los personales NO vienen de la RPC: se leen acá, con el documento en
    // claro que la credencial entregó recién tras validar el factor.
    const { encontrada, ficha } = await leerFichaPersonal(admin, r.empresa_id, r.documento)

    const respuesta: FichaValidada = {
      ok: true,
      cedula_valida: r.cedula_valida,
      ficha_encontrada: encontrada,
      ficha,
      membresia: r.membresia,
      catalogos: r.catalogos,
      campos: r.campos,
      confirmado_at: r.confirmado_at,
      cambios_pendientes: r.cambios_pendientes,
    }
    return NextResponse.json(respuesta, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/ficha/[token]/validar] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
