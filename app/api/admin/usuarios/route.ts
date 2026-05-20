/**
 * GET  /api/admin/usuarios?empresa_id=...
 *   → Lista usuarios con acceso a la empresa.
 *
 * POST /api/admin/usuarios
 *   body: { empresa_id, email, password, rol }
 *   → Crea cuenta en auth.users + asocia a la empresa con el rol indicado.
 *
 * Ambos endpoints exigen que el caller sea admin en la empresa indicada.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPermisosEfectivos } from '@/lib/permisos'
import { ROLES, isRolValido, type Rol } from '@/lib/roles'

interface UsuarioRow {
  user_id: string
  email: string | null
  nombre: string | null
  rol: Rol
  created_at: string
}

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

// ────────────────────────────────────────────────────────────────────
// GET
// ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const empresaId = req.nextUrl.searchParams.get('empresa_id') ?? ''
    const check = await assertCallerPuedeGestionarUsuarios(empresaId)
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status })
    }

    const admin = createAdminClient()

    // 1) Pertenencias a la empresa
    const { data: rows, error: rowsErr } = await admin
      .from('user_empresas')
      .select('user_id, rol, created_at')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: true })

    if (rowsErr) {
      return NextResponse.json({ error: rowsErr.message }, { status: 500 })
    }

    // 2) Email + nombre (de user_metadata) desde auth.users (vía admin.listUsers)
    const userIds = new Set((rows ?? []).map((r) => r.user_id as string))
    const metaById = new Map<
      string,
      { email: string | null; nombre: string | null }
    >()

    // listUsers pagina; pedimos páginas hasta cubrir el set
    let page = 1
    const perPage = 200
    while (metaById.size < userIds.size) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (!data || data.users.length === 0) break
      for (const u of data.users) {
        if (userIds.has(u.id)) {
          const meta = (u.user_metadata ?? {}) as Record<string, unknown>
          const nombre = typeof meta.nombre === 'string' ? meta.nombre : null
          metaById.set(u.id, { email: u.email ?? null, nombre })
        }
      }
      if (data.users.length < perPage) break
      page++
      if (page > 50) break // safety net
    }

    const usuarios: UsuarioRow[] = (rows ?? []).map((r) => {
      const meta = metaById.get(r.user_id as string)
      return {
        user_id: r.user_id as string,
        email: meta?.email ?? null,
        nombre: meta?.nombre ?? null,
        rol: (isRolValido(r.rol) ? r.rol : ROLES.USUARIO) as Rol,
        created_at: r.created_at as string,
      }
    })

    return NextResponse.json({ usuarios })
  } catch (err) {
    // Sin este catch, cualquier excepción (createAdminClient sin env,
    // fallo de red a Supabase, etc.) devolvía un 500 con body vacío —
    // imposible de diagnosticar desde el toast del frontend.
    console.error('[GET /api/admin/usuarios] error inesperado:', err)
    const msg =
      err instanceof Error ? err.message : 'Error interno al listar usuarios'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ────────────────────────────────────────────────────────────────────
// POST
// ────────────────────────────────────────────────────────────────────

interface CreateBody {
  empresa_id?: unknown
  nombre?: unknown
  email?: unknown
  password?: unknown
  rol?: unknown
}

export async function POST(req: NextRequest) {
  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const empresaId = typeof body.empresa_id === 'string' ? body.empresa_id : ''
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const rolReq = body.rol

  if (!empresaId) {
    return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })
  }
  if (!nombre || nombre.length > 80) {
    return NextResponse.json(
      { error: 'Nombre requerido (máximo 80 caracteres)' },
      { status: 400 },
    )
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: 'Password debe tener al menos 8 caracteres' },
      { status: 400 },
    )
  }
  if (!isRolValido(rolReq)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
  }
  const rol: Rol = rolReq

  const check = await assertCallerPuedeGestionarUsuarios(empresaId)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }

  const admin = createAdminClient()

  // 1) Crear usuario en auth.users (email_confirm:true para login inmediato)
  //    El nombre se guarda en user_metadata.nombre — se puede leer luego desde
  //    auth.users.raw_user_meta_data->>'nombre' (SQL) o user.user_metadata.nombre (JS).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre },
  })

  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'No se pudo crear el usuario'
    // Errores típicos: email ya existe, password débil
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // 2) Asociar a la empresa con el rol indicado
  const { error: linkErr } = await admin.from('user_empresas').insert({
    user_id: created.user.id,
    empresa_id: empresaId,
    rol,
  })

  if (linkErr) {
    // Rollback: si no pudimos asociar, mejor borrar el user que dejarlo huérfano
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json(
      { error: `Usuario creado pero no se pudo asociar a la empresa: ${linkErr.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    user_id: created.user.id,
    email: created.user.email,
    nombre,
    rol,
  })
}
