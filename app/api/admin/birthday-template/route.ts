/**
 * GET /api/admin/birthday-template?empresa_id=...&plantilla_empresa=...
 *   → Plantilla guardada de una empresa (o los valores por defecto).
 *
 * PUT /api/admin/birthday-template
 *   body: { empresa_id, plantilla_empresa, asunto, denominacion, cuerpo,
 *           imagen_fondo_path, texto_color, panel_color, panel_opacidad }
 *   → Upserta la fila en birthday_email_templates.
 *
 * - `empresa_id`        = empresa activa de la web app (para el permiso).
 * - `plantilla_empresa` = empresa del cron (socios_datos.empresa_id) cuya
 *                         plantilla se está leyendo/editando.
 *
 * Autorización: caller con `puede_ver_config` (ver lib/birthday-auth.ts).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertPuedeVerConfig } from '@/lib/birthday-auth'
import { DEFAULT_BIRTHDAY_TEMPLATE } from '@/lib/birthday-email-template'
import {
  TEMPLATE_TABLE,
  TEMPLATE_COLUMNS,
  storagePublicUrl,
  esTablaInexistente,
  type TemplateRow,
} from '@/lib/birthday-template-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ────────────────────────────────────────────────────────────────────
// GET
// ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const empresaId = req.nextUrl.searchParams.get('empresa_id') ?? ''
    const plantillaEmpresa =
      req.nextUrl.searchParams.get('plantilla_empresa') ?? ''

    const auth = await assertPuedeVerConfig(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!plantillaEmpresa) {
      return NextResponse.json(
        { error: 'plantilla_empresa requerido' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    const d = DEFAULT_BIRTHDAY_TEMPLATE

    const { data, error } = await admin
      .from(TEMPLATE_TABLE)
      .select(TEMPLATE_COLUMNS)
      .eq('empresa_id', plantillaEmpresa)
      .maybeSingle()

    if (error && !esTablaInexistente(error)) {
      return NextResponse.json(
        { error: `Error leyendo la plantilla: ${error.message}` },
        { status: 500 },
      )
    }

    const tablaExiste = !(error && esTablaInexistente(error))
    const row = (data ?? null) as TemplateRow | null

    return NextResponse.json({
      empresaId: plantillaEmpresa,
      tablaExiste,
      existeFila: !!row,
      asunto: row?.asunto ?? d.asunto,
      denominacion: row?.denominacion ?? d.denominacion,
      cuerpo: row?.cuerpo ?? d.cuerpo,
      imagenFondoPath: row?.imagen_fondo_path ?? null,
      imagenUrl: storagePublicUrl(admin, row?.imagen_fondo_path),
      textoColor: row?.texto_color ?? d.textoColor,
      panelColor: row?.panel_color ?? d.panelColor,
      panelOpacidad: row?.panel_opacidad ?? d.panelOpacidad,
      activo: row?.activo ?? false,
      soloActivos: row?.solo_activos !== false,
      gmailUser: row?.gmail_user ?? '',
      fromName: row?.from_name ?? '',
      // Nunca se devuelve la App Password — solo si está cargada.
      gmailAppPasswordSet: !!row?.gmail_app_password,
    })
  } catch (err) {
    console.error('[GET /api/admin/birthday-template] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ────────────────────────────────────────────────────────────────────
// PUT
// ────────────────────────────────────────────────────────────────────

interface PutBody {
  empresa_id?: unknown
  plantilla_empresa?: unknown
  asunto?: unknown
  denominacion?: unknown
  cuerpo?: unknown
  imagen_fondo_path?: unknown
  texto_color?: unknown
  panel_color?: unknown
  panel_opacidad?: unknown
  activo?: unknown
  solo_activos?: unknown
  gmail_user?: unknown
  from_name?: unknown
  gmail_app_password?: unknown
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export async function PUT(req: NextRequest) {
  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const empresaId = typeof body.empresa_id === 'string' ? body.empresa_id : ''
  const plantillaEmpresa =
    typeof body.plantilla_empresa === 'string' ? body.plantilla_empresa : ''

  const auth = await assertPuedeVerConfig(empresaId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!plantillaEmpresa) {
    return NextResponse.json(
      { error: 'plantilla_empresa requerido' },
      { status: 400 },
    )
  }

  // Validación de campos
  const asunto = typeof body.asunto === 'string' ? body.asunto.trim() : ''
  const denominacion =
    typeof body.denominacion === 'string' ? body.denominacion.trim() : ''
  const cuerpo = typeof body.cuerpo === 'string' ? body.cuerpo.trim() : ''
  const imagenFondoPath =
    typeof body.imagen_fondo_path === 'string' && body.imagen_fondo_path.trim()
      ? body.imagen_fondo_path.trim()
      : null
  const textoColor =
    typeof body.texto_color === 'string' ? body.texto_color.trim() : ''
  const panelColor =
    typeof body.panel_color === 'string' ? body.panel_color.trim() : ''
  const panelOpacidad =
    typeof body.panel_opacidad === 'number' ? Math.round(body.panel_opacidad) : NaN
  const activo = typeof body.activo === 'boolean' ? body.activo : false
  // Default seguro: si el cliente no manda el campo, asumimos "solo activos"
  // (coincide con el DEFAULT TRUE de la columna).
  const soloActivos =
    typeof body.solo_activos === 'boolean' ? body.solo_activos : true

  // Casilla Gmail. La App Password solo se actualiza si vino una nueva
  // (el editor manda el campo vacío cuando no se cambia).
  const gmailUser =
    typeof body.gmail_user === 'string' ? body.gmail_user.trim() : ''
  const fromName =
    typeof body.from_name === 'string' ? body.from_name.trim() : ''
  const gmailAppPassword =
    typeof body.gmail_app_password === 'string'
      ? body.gmail_app_password.replace(/\s+/g, '')
      : ''

  if (!asunto || asunto.length > 200) {
    return NextResponse.json(
      { error: 'El asunto es obligatorio (máximo 200 caracteres)' },
      { status: 400 },
    )
  }
  if (!denominacion || denominacion.length > 80) {
    return NextResponse.json(
      { error: 'La denominación es obligatoria (máximo 80 caracteres)' },
      { status: 400 },
    )
  }
  if (!cuerpo || cuerpo.length > 2000) {
    return NextResponse.json(
      { error: 'El cuerpo es obligatorio (máximo 2000 caracteres)' },
      { status: 400 },
    )
  }
  if (!HEX_RE.test(textoColor) || !HEX_RE.test(panelColor)) {
    return NextResponse.json(
      { error: 'Los colores deben ser hexadecimales (#rrggbb)' },
      { status: 400 },
    )
  }
  if (!Number.isFinite(panelOpacidad) || panelOpacidad < 0 || panelOpacidad > 100) {
    return NextResponse.json(
      { error: 'La opacidad del panel debe estar entre 0 y 100' },
      { status: 400 },
    )
  }
  if (gmailUser && !EMAIL_RE.test(gmailUser)) {
    return NextResponse.json(
      { error: 'La casilla Gmail no es un email válido' },
      { status: 400 },
    )
  }
  if (fromName.length > 80) {
    return NextResponse.json(
      { error: 'El nombre del remitente admite hasta 80 caracteres' },
      { status: 400 },
    )
  }
  if (gmailAppPassword.length > 100) {
    return NextResponse.json(
      { error: 'La App Password es demasiado larga' },
      { status: 400 },
    )
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.from(TEMPLATE_TABLE).upsert(
      {
        empresa_id: plantillaEmpresa,
        asunto,
        denominacion,
        cuerpo,
        imagen_fondo_path: imagenFondoPath,
        texto_color: textoColor,
        panel_color: panelColor,
        panel_opacidad: panelOpacidad,
        activo,
        solo_activos: soloActivos,
        gmail_user: gmailUser || null,
        from_name: fromName || null,
        // Solo se escribe la App Password si el editor mandó una nueva.
        ...(gmailAppPassword ? { gmail_app_password: gmailAppPassword } : {}),
        actualizado_en: new Date().toISOString(),
        actualizado_por: auth.userId,
      },
      { onConflict: 'empresa_id' },
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

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PUT /api/admin/birthday-template] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
