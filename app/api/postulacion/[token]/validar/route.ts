/**
 * POST /api/postulacion/[token]/validar   body: { digitos }
 *
 * Endpoint PÚBLICO. Segundo factor: los últimos N dígitos de la cédula del
 * titular. Recién si aciertan, `validar_invitado` devuelve el nombre visible y
 * la situación de deuda de esa persona. Antes de eso no sale nada por acá.
 *
 * Que la deuda esté detrás del factor no es un detalle: es el dato más sensible
 * que maneja este módulo, y un link reenviado no puede ser la vía para leerlo.
 *
 * El conteo de intentos y el bloqueo (5 fallos → 15 minutos) los lleva la base,
 * por credencial. El tope por IP de este handler cubre lo otro: al que prueba
 * muchas credenciales distintas.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ocultarInexistente, validarInvitado } from '@/lib/convocatorias'
import { digitosValidos, tokenValido } from '@/lib/convocatorias-types'
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
    if (!(await permitido(admin, req, LIMITES.postulacionValidar))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(await validarInvitado(admin, token, digitos))
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/postulacion/[token]/validar] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
