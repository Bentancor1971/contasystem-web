/**
 * PUT /api/admin/birthday-settings
 *   body: { empresa_id, hora_envio }
 *   → Actualiza la hora de envío (0-23, Montevideo) del cron de cumpleaños.
 *
 * `empresa_id` = empresa activa de la web app (solo para el chequeo de
 * permiso). La hora es un ajuste global.
 *
 * Autorización: caller con `puede_ver_config`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertPuedeVerConfig } from '@/lib/birthday-auth'
import { SETTINGS_TABLE, esTablaInexistente } from '@/lib/birthday-template-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PutBody {
  empresa_id?: unknown
  hora_envio?: unknown
}

export async function PUT(req: NextRequest) {
  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const empresaId = typeof body.empresa_id === 'string' ? body.empresa_id : ''
  const auth = await assertPuedeVerConfig(empresaId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const horaEnvio =
    typeof body.hora_envio === 'number' ? Math.round(body.hora_envio) : NaN
  if (!Number.isFinite(horaEnvio) || horaEnvio < 0 || horaEnvio > 23) {
    return NextResponse.json(
      { error: 'La hora de envío debe estar entre 0 y 23' },
      { status: 400 },
    )
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.from(SETTINGS_TABLE).upsert(
      {
        id: 1,
        hora_envio: horaEnvio,
        actualizado_en: new Date().toISOString(),
        actualizado_por: auth.userId,
      },
      { onConflict: 'id' },
    )

    if (error) {
      if (esTablaInexistente(error)) {
        return NextResponse.json(
          {
            error:
              'Falta crear la tabla. Ejecutá supabase/birthday_email_templates.sql en Supabase.',
          },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: `No se pudo guardar: ${error.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, horaEnvio })
  } catch (err) {
    console.error('[PUT /api/admin/birthday-settings] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
