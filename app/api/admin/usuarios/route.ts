/**
 * GET  /api/admin/usuarios?empresa_id=...
 *   → Lista usuarios con acceso a la empresa.
 *
 * POST /api/admin/usuarios
 *   body: { empresa_id, email, password, rol }
 *   → Crea cuenta en auth.users + asocia a la empresa con el rol indicado.
 *
 * Ambos endpoints exigen que el caller tenga `puede_gestionar_usuarios` en la
 * empresa indicada — NO que sea admin: ese permiso es editable en la matriz de
 * /configuracion/roles y el rol contador lo tiene por default (ver
 * lib/roles.ts DEFAULT_PERMISOS). Por eso asignar el rol `admin` en sí mismo
 * tiene un chequeo aparte y más estricto (E8, ver POST): "gestionar usuarios"
 * no alcanza para crear otro admin, sólo un admin puede hacerlo.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
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
  | { ok: true; userId: string; rol: Rol }
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

  return { ok: true, userId: user.id, rol: efectivos.rol }
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

    // 2) Email + nombre (de user_metadata) desde auth.users.
    //    Antes esto paginaba listUsers de a 200 hasta cubrir el set entero
    //    (hasta 50 páginas = 10.000 usuarios recorridos para resolver, en el
    //    caso típico, un puñado de ids). Con el id ya conocido alcanza un
    //    getUserById por usuario, y como son independientes van en paralelo.
    const userIds = [...new Set((rows ?? []).map((r) => r.user_id as string))]
    const metaById = new Map<
      string,
      { email: string | null; nombre: string | null }
    >()
    const metaResultados = await Promise.all(
      userIds.map(async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id)
        if (error || !data?.user) return null
        const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
        const nombre = typeof meta.nombre === 'string' ? meta.nombre : null
        return [id, { email: data.user.email ?? null, nombre }] as const
      }),
    )
    for (const entry of metaResultados) {
      if (entry) metaById.set(entry[0], entry[1])
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

  // E8: crear (o promover a) un admin es el cambio de máximo privilegio del
  // sistema. "Gestionar usuarios" es un permiso editable en la matriz de roles
  // y el rol contador lo tiene por default — con sólo eso, antes se podía
  // crear un admin nuevo. Ahora hace falta SER admin para poder nombrar uno.
  if (rol === ROLES.ADMIN && check.rol !== ROLES.ADMIN) {
    return NextResponse.json(
      { error: 'Sólo un admin puede crear usuarios con rol admin' },
      { status: 403 },
    )
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
    // El caso típico de "falla" acá no es un error: es que la persona ya
    // tiene cuenta en Auth por OTRA empresa (mismo Supabase Auth para todo el
    // proyecto). Antes esto le devolvía el mensaje crudo de GoTrue y no había
    // forma de asociarla desde acá — había que ir a SQL. Detectamos el
    // duplicado y, si ya existe, la asociamos a esta empresa en vez de fallar.
    const yaExiste =
      createErr?.code === 'email_exists' ||
      /already registered|already exists|already been registered/i.test(
        createErr?.message ?? '',
      )
    if (!yaExiste) {
      return NextResponse.json(
        { error: createErr?.message ?? 'No se pudo crear el usuario' },
        { status: 400 },
      )
    }
    return await asociarUsuarioExistente(admin, { email, empresaId, rol, nombre })
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

/**
 * Busca por email un usuario que ya existe en Auth (de otra empresa) y lo
 * asocia a `empresaId` con `rol`, en vez de dejar que la creación falle con
 * el mensaje crudo de GoTrue.
 *
 * `listUsers` no filtra por email (ver GoTrueAdminApi), así que acá sí hay que
 * paginar — pero es el camino de excepción (un alta que pisa un email
 * existente), no el listado de cada carga de pantalla como era antes en GET.
 */
async function asociarUsuarioExistente(
  admin: SupabaseClient,
  args: { email: string; empresaId: string; rol: Rol; nombre: string },
) {
  const emailNorm = args.email.toLowerCase()
  let encontrado: { id: string; nombre: string | null } | null = null
  for (let page = 1; page <= 50 && !encontrado; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      return NextResponse.json(
        { error: `No se pudo buscar el usuario existente: ${error.message}` },
        { status: 500 },
      )
    }
    if (!data || data.users.length === 0) break
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === emailNorm)
    if (u) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>
      encontrado = { id: u.id, nombre: typeof meta.nombre === 'string' ? meta.nombre : null }
    }
    if (data.users.length < 200) break
  }

  if (!encontrado) {
    return NextResponse.json(
      { error: 'Ese email ya existe en Auth pero no se pudo encontrar para asociarlo' },
      { status: 409 },
    )
  }

  const { data: yaAsociado } = await admin
    .from('user_empresas')
    .select('user_id')
    .eq('user_id', encontrado.id)
    .eq('empresa_id', args.empresaId)
    .maybeSingle()
  if (yaAsociado) {
    return NextResponse.json(
      { error: 'Ese usuario ya tiene acceso a esta empresa' },
      { status: 409 },
    )
  }

  const { error: linkErr } = await admin.from('user_empresas').insert({
    user_id: encontrado.id,
    empresa_id: args.empresaId,
    rol: args.rol,
  })
  if (linkErr) {
    return NextResponse.json(
      { error: `No se pudo asociar el usuario existente: ${linkErr.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    asociado: true,
    user_id: encontrado.id,
    email: args.email,
    nombre: encontrado.nombre ?? args.nombre,
    rol: args.rol,
  })
}
