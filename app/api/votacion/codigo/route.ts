/**
 * POST /api/votacion/codigo   body: { codigo }
 *
 * Endpoint PÚBLICO. Canjea el código impreso de una credencial entregada en
 * mano por el token de esa persona, para mandarla a su `/v/{token}` de siempre.
 *
 * **No saltea nada.** El segundo factor se pide igual en la pantalla de
 * votación: esto cambia la vía de entrada, no el control.
 *
 * A diferencia del segundo factor, acá NO hay bloqueo por credencial detrás —el
 * token tiene contador de intentos, el código no—, así que el tope por IP es la
 * única defensa contra probar en masa. Es más estrecho que el de votar a
 * propósito.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverCodigo } from '@/lib/elecciones'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { SIN_CACHE } from '../[token]/_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Tope defensivo de longitud. El código son 10 caracteres; se aceptan separadores. */
const MAX_LARGO = 40

export async function POST(req: Request) {
  try {
    let body: { codigo?: unknown }
    try {
      body = (await req.json()) as { codigo?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }

    const crudo = typeof body.codigo === 'string' ? body.codigo.trim() : ''
    // Un código vacío o desmesurado sale por la misma puerta que uno equivocado:
    // nada de lo que responde este handler dice si un código existe.
    if (!crudo || crudo.length > MAX_LARGO) {
      return NextResponse.json({ error: 'codigo_inexistente' }, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.votoCodigo))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    // La normalización real —mayúsculas, sin espacios ni guiones— la hace el RPC.
    const r = await resolverCodigo(admin, crudo)
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/votacion/codigo] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
