/**
 * POST /api/votacion/[token]/validar   body: { digitos }
 *
 * Endpoint PÚBLICO. Segundo factor: los últimos N dígitos de la cédula del
 * titular. Recién si aciertan, `validar_credencial` devuelve el nombre visible
 * del votante y la boleta. Antes de eso no sale nada de la elección por acá.
 *
 * El conteo de intentos y el bloqueo (5 fallos → 15 minutos) los lleva la base,
 * por credencial. El tope por IP de este handler cubre lo otro: al que prueba
 * muchas credenciales distintas.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ocultarInexistente, validarCredencial } from '@/lib/elecciones'
import { digitosValidos, tokenValido } from '@/lib/elecciones-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { SIN_CACHE } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: { digitos?: unknown }
    try {
      body = (await req.json()) as { digitos?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }

    const digitos = digitosValidos(body.digitos)
    // Un token mal formado y unos dígitos con basura salen por la misma puerta
    // que unos dígitos equivocados: nada de lo que responde este handler permite
    // deducir si la credencial existe.
    if (!tokenValido(token) || digitos === null) {
      return NextResponse.json({ error: 'digitos_incorrectos' }, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.votoValidar))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(await validarCredencial(admin, token, digitos))
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/votacion/[token]/validar] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
