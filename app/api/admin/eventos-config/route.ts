/**
 * GET /api/admin/eventos-config?empresa_id=...&evento_id=...
 *   → { eventos: [...], config } — lista de eventos de la empresa y, si se pasa
 *     evento_id, la config guardada de ese evento (o los defaults).
 *
 * PUT /api/admin/eventos-config
 *   body: { empresa_id, evento_id, ...flags, ...html }
 *   → Upserta la fila en evento_web_config.
 *
 * Autorización: caller con `puede_ver_config` sobre `empresa_id`. Además se
 * valida que el evento pertenezca a esa empresa (no cruzar tenants).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertPuedeVerConfig } from '@/lib/birthday-auth'
import { esTablaInexistente } from '@/lib/birthday-template-store'
import { DEFAULT_EVENTO_WEB_CONFIG } from '@/lib/eventos-types'
import { EVENTO_CONFIG_TABLE, rowToConfig } from '@/lib/evento-web-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FALTA_TABLA =
  'Falta crear la tabla. Ejecutá supabase/evento_web_config.sql en Supabase.'

/** Campos del evento que la pantalla muestra (algunos solo lectura, vienen del desktop). */
const EVENTO_COLS =
  'id, slug, nombre, tipo, estado, fecha_inicio, texto_antes, texto_despues, ' +
  'transporte_disponible, alimentacion_disponible, datos_deposito'

/** Verifica que el evento exista y pertenezca a la empresa. */
async function eventoDeEmpresa(
  admin: ReturnType<typeof createAdminClient>,
  eventoId: string,
  empresaId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('eventos_remoto')
    .select('id')
    .eq('id', eventoId)
    .eq('empresa_id', empresaId)
    .maybeSingle()
  return !!data
}

// ────────────────────────────────────────────────────────────────────
// GET
// ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const empresaId = req.nextUrl.searchParams.get('empresa_id') ?? ''
    const eventoId = req.nextUrl.searchParams.get('evento_id') ?? ''

    const auth = await assertPuedeVerConfig(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createAdminClient()

    const { data: eventos, error: evErr } = await admin
      .from('eventos_remoto')
      .select(EVENTO_COLS)
      .eq('empresa_id', empresaId)
      .neq('estado', 'anulado')
      .order('fecha_inicio', { ascending: false })

    if (evErr) {
      return NextResponse.json(
        { error: `Error leyendo eventos: ${evErr.message}` },
        { status: 500 },
      )
    }

    let config = { ...DEFAULT_EVENTO_WEB_CONFIG }
    let tablaExiste = true
    let existeFila = false

    if (eventoId) {
      const { data, error } = await admin
        .from(EVENTO_CONFIG_TABLE)
        .select('*')
        .eq('evento_id', eventoId)
        .maybeSingle()

      if (error) {
        if (!esTablaInexistente(error)) {
          return NextResponse.json(
            { error: `Error leyendo la config: ${error.message}` },
            { status: 500 },
          )
        }
        tablaExiste = false
      } else if (data) {
        existeFila = true
        config = rowToConfig(data as Record<string, unknown>)
      }
    }

    return NextResponse.json({
      eventos: eventos ?? [],
      eventoId: eventoId || null,
      tablaExiste,
      existeFila,
      config,
    })
  } catch (err) {
    console.error('[GET /api/admin/eventos-config] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ────────────────────────────────────────────────────────────────────
// PUT
// ────────────────────────────────────────────────────────────────────

const BOOL_FIELDS = [
  'mostrar_apellido',
  'apellido_obligatorio',
  'mostrar_email',
  'email_obligatorio',
  'mostrar_telefono',
  'telefono_obligatorio',
  'mostrar_categoria',
  'permitir_categoria_otros',
  'mostrar_transporte',
  'mostrar_alimentacion',
  'mostrar_total',
  'permitir_pago_transferencia',
] as const

const HTML_FIELDS = [
  'pagina_html_encabezado',
  'pagina_html_pie',
  'mail_acuse_asunto',
  'mail_acuse_html',
  'mail_acuse_pago_asunto',
  'mail_acuse_pago_html',
  'certificado_html',
] as const

/** Tope defensivo por campo HTML. */
const MAX_HTML = 20_000

export async function PUT(req: NextRequest) {
  try {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const empresaId = typeof body.empresa_id === 'string' ? body.empresa_id : ''
    const eventoId = typeof body.evento_id === 'string' ? body.evento_id : ''

    const auth = await assertPuedeVerConfig(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!eventoId) {
      return NextResponse.json({ error: 'evento_id requerido' }, { status: 400 })
    }

    const admin = createAdminClient()
    if (!(await eventoDeEmpresa(admin, eventoId, empresaId))) {
      return NextResponse.json(
        { error: 'El evento no pertenece a esta empresa' },
        { status: 403 },
      )
    }

    const row: Record<string, unknown> = {
      evento_id: eventoId,
      empresa_id: empresaId,
      actualizado_en: new Date().toISOString(),
      actualizado_por: auth.userId,
    }

    for (const f of BOOL_FIELDS) {
      row[f] = typeof body[f] === 'boolean' ? body[f] : DEFAULT_EVENTO_WEB_CONFIG[f]
    }
    for (const f of HTML_FIELDS) {
      const v = typeof body[f] === 'string' ? (body[f] as string).trim() : ''
      if (v.length > MAX_HTML) {
        return NextResponse.json(
          { error: `El campo ${f} supera ${MAX_HTML} caracteres` },
          { status: 400 },
        )
      }
      row[f] = v || null
    }

    const { error } = await admin
      .from(EVENTO_CONFIG_TABLE)
      .upsert(row, { onConflict: 'evento_id' })

    if (error) {
      if (esTablaInexistente(error)) {
        return NextResponse.json({ error: FALTA_TABLA }, { status: 409 })
      }
      return NextResponse.json(
        { error: `No se pudo guardar: ${error.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PUT /api/admin/eventos-config] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
