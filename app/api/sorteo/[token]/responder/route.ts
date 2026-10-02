/**
 * POST /api/sorteo/[token]/responder   body: { acepta: boolean }
 *
 * Endpoint PÚBLICO. El favorecido de un sorteo confirma o rechaza su cupo.
 * `responder_confirmacion_sorteo` hace cumplir todo: una sola respuesta,
 * dentro del plazo (fecha de Montevideo) y con el cupo todavía abierto en el
 * desktop. Una respuesta es definitiva desde acá; un cambio lo hace la
 * secretaría. El desktop la baja con el poller, como las inscripciones.
 *
 * Un GET nunca responde: los links del mail sólo abren la página, porque los
 * antivirus de correo siguen los links solos.
 */

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { responderConfirmacionSorteo } from '@/lib/sorteo-confirmacion'
import { enviarConstanciaCupo } from '@/lib/sorteo-confirmacion-acuse'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { tokenValido } from '@/lib/sorteo-confirmacion-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: { acepta?: unknown }
    try {
      body = (await req.json()) as { acepta?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }
    if (!tokenValido(token)) {
      return NextResponse.json({ error: 'credencial_inexistente' }, { headers: SIN_CACHE })
    }
    if (typeof body.acepta !== 'boolean') {
      return NextResponse.json({ error: 'respuesta_invalida' }, { status: 400, headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.sorteoResponder))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = await responderConfirmacionSorteo(admin, token, body.acepta)
    if ('ok' in r && r.ok) {
      // Constancia por mail (fase 10). Con `after()`: el SMTP son 1-3 s que no
      // tienen por qué demorar la respuesta, que ya quedó guardada. El mail no
      // viaja al navegador: la pantalla sólo sabe si va a salir una constancia.
      // Antes de decir "te enviamos una constancia" se mira que la empresa tenga
      // casilla: es una consulta liviana, como hace la inscripción con su acuse.
      const constancia = r.constancia && (await loadGmailAccountForEmpresa(admin, r.constancia.empresa_id))
        ? r.constancia
        : null
      if (constancia) after(() => enviarConstanciaCupo(admin, constancia).then(() => undefined))
      return NextResponse.json(
        { ok: true, respuesta: r.respuesta, respuesta_at: r.respuesta_at, constancia: !!constancia },
        { headers: SIN_CACHE },
      )
    }
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/sorteo/[token]/responder] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
