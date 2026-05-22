/**
 * POST /api/admin/birthday-template/imagen?empresa_id=...&plantilla_empresa=...
 *   body: multipart/form-data con el campo `file` (imagen).
 *   → Sube la imagen de fondo al bucket 'birthday-assets' y devuelve
 *     { ok, path, url }. El `path` se guarda después con el PUT de la
 *     plantilla.
 *
 * Autorización: caller con `puede_ver_config`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertPuedeVerConfig } from '@/lib/birthday-auth'
import { BIRTHDAY_BUCKET, storagePublicUrl } from '@/lib/birthday-template-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 3 * 1024 * 1024 // 3 MB
const EXT_POR_TIPO: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export async function POST(req: NextRequest) {
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

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json(
        { error: 'Se esperaba multipart/form-data' },
        { status: 400 },
      )
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Falta el archivo (campo "file")' },
        { status: 400 },
      )
    }

    const ext = EXT_POR_TIPO[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: 'Formato no permitido. Usá PNG, JPG o WebP.' },
        { status: 400 },
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'La imagen supera el límite de 3 MB.' },
        { status: 400 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    // Timestamp en el nombre → evita que el cliente de mail muestre una
    // imagen cacheada cuando se reemplaza el fondo.
    const path = `${plantillaEmpresa}/fondo-${Date.now()}.${ext}`

    const admin = createAdminClient()
    const { error } = await admin.storage
      .from(BIRTHDAY_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: true })

    if (error) {
      const faltaBucket = /bucket.*not found|not found.*bucket/i.test(error.message)
      return NextResponse.json(
        {
          error: faltaBucket
            ? 'Falta el bucket de Storage. Ejecutá supabase/birthday_email_templates.sql en Supabase.'
            : `No se pudo subir la imagen: ${error.message}`,
        },
        { status: faltaBucket ? 409 : 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      path,
      url: storagePublicUrl(admin, path),
    })
  } catch (err) {
    console.error('[POST /api/admin/birthday-template/imagen] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
