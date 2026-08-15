/**
 * POST /api/postulacion/[token]/retirar   body: { digitos }
 *
 * Endpoint PÚBLICO. Da de baja la postulación y libera la credencial, para que
 * la persona pueda volver a anotarse si cambia de idea otra vez.
 *
 * Existe porque una postulación NO es un voto: no altera ningún resultado, así
 * que deshacerla no rompe nada. El límite lo pone la base: sólo se retira lo que
 * el desktop todavía no bajó (`estado = 'pendiente'`). Una vez importada es de
 * la comisión, y la respuesta lo dice con el mail de contacto a mano.
 *
 * Se pide el segundo factor igual que para anotarse: retirar la postulación de
 * otro con un link reenviado sería el peor uso posible de este botón.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ocultarInexistente, retirarPostulacion } from '@/lib/convocatorias'
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
    if (!tokenValido(token) || digitos === null) {
      return NextResponse.json({ error: 'digitos_incorrectos' }, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.postulacionRetirar))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(await retirarPostulacion(admin, token, digitos))
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/postulacion/[token]/retirar] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
