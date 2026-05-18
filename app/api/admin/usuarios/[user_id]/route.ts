/**
 * PATCH /api/admin/usuarios/[user_id]
 *   body: { empresa_id: string, nombre?: string, rol?: 'admin'|'contador'|'usuario' }
 *
 * Actualiza el nombre (en auth.user_metadata) y/o el rol (en user_empresas)
 * de un usuario respecto de una empresa. Exige rol admin en esa empresa.
 *
 * Guard: el caller no puede demoterse a sí mismo (cambiar su propio rol).
 *        Para promover/demoter al propio admin, otro admin debe hacerlo,
 *        o se hace por SQL directo.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPermisosEfectivos } from '@/lib/permisos'
import { ROLES, isRolValido, type Rol } from '@/lib/roles'

async function assertCallerPuedeGestionarUsuarios(empresaId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }
> {
  if (!empresaId || typeof empresaId !== 'string') {
    return { ok: false, status: 400, error: 'empresa_id requerido' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, status: 401, error: 'No autenticado' }
  }

  const efectivos = await getPermisosEfectivos(supabase, user.id, empresaId)
  if (!efectivos) {
    return { ok: false, status: 403, error: 'Sin acceso a esa empresa' }
  }
  if (!efectivos.permisos.puede_gestionar_usuarios) {
    return {
      ok: false,
      status: 403,
      error: 'Tu rol no tiene permiso para gestionar usuarios en esta empresa',
    }
  }

  return { ok: true, userId: user.id }
}

interface PatchBody {
  empresa_id?: unknown
  nombre?: unknown
  rol?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ user_id: string }> },
) {
  const { user_id: targetUserId } = await params

  if (!targetUserId) {
    return NextResponse.json({ error: 'user_id requerido' }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const empresaId = typeof body.empresa_id === 'string' ? body.empresa_id : ''

  const nombre =
    typeof body.nombre === 'string' ? body.nombre.trim() : undefined
  const rolReq = body.rol

  if (!empresaId) {
    return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })
  }
  if (nombre === undefined && rolReq === undefined) {
    return NextResponse.json(
      { error: 'Nada para actualizar (enviá nombre y/o rol)' },
      { status: 400 },
    )
  }
  if (nombre !== undefined && (nombre.length === 0 || nombre.length > 80)) {
    return NextResponse.json(
      { error: 'Nombre inválido (1-80 caracteres)' },
      { status: 400 },
    )
  }

  let rol: Rol | undefined = undefined
  if (rolReq !== undefined) {
    if (!isRolValido(rolReq)) {
      return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
    }
    rol = rolReq
  }

  const check = await assertCallerPuedeGestionarUsuarios(empresaId)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }

  // Guard: el caller no puede cambiar su propio rol
  if (rol !== undefined && check.userId === targetUserId && rol !== ROLES.ADMIN) {
    return NextResponse.json(
      {
        error:
          'No podés cambiar tu propio rol. Pedile a otro admin (o usá SQL directo).',
      },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  // 1) Verificar que el target user pertenece a la empresa
  const { data: existing, error: existingErr } = await admin
    .from('user_empresas')
    .select('user_id, rol')
    .eq('user_id', targetUserId)
    .eq('empresa_id', empresaId)
    .single()

  if (existingErr || !existing) {
    return NextResponse.json(
      { error: 'Ese usuario no pertenece a esta empresa' },
      { status: 404 },
    )
  }

  // 2) Actualizar nombre en user_metadata (mergeando para preservar otras keys)
  if (nombre !== undefined) {
    const { data: getRes, error: getErr } =
      await admin.auth.admin.getUserById(targetUserId)
    if (getErr || !getRes?.user) {
      return NextResponse.json(
        { error: `No se pudo leer el usuario: ${getErr?.message ?? 'desconocido'}` },
        { status: 500 },
      )
    }
    const prevMeta = (getRes.user.user_metadata ?? {}) as Record<string, unknown>
    const { error: updErr } = await admin.auth.admin.updateUserById(
      targetUserId,
      { user_metadata: { ...prevMeta, nombre } },
    )
    if (updErr) {
      return NextResponse.json(
        { error: `No se pudo actualizar el nombre: ${updErr.message}` },
        { status: 500 },
      )
    }
  }

  // 3) Actualizar rol en user_empresas
  if (rol !== undefined) {
    const { error } = await admin
      .from('user_empresas')
      .update({ rol })
      .eq('user_id', targetUserId)
      .eq('empresa_id', empresaId)
    if (error) {
      return NextResponse.json(
        { error: `No se pudo actualizar el rol: ${error.message}` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ ok: true, user_id: targetUserId, nombre, rol })
}
