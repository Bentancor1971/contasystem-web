/**
 * GET /api/admin/permisos?empresa_id=...
 *   → Devuelve la matriz completa (3 roles × N permisos) para la empresa,
 *     mergeada con los defaults de roles.ts.
 *
 * PUT /api/admin/permisos
 *   body: { empresa_id, matriz: { admin: PermisosRol, contador: PermisosRol, usuario: PermisosRol } }
 *   → Upserta las 3 filas en rol_permisos.
 *
 * Ambos endpoints exigen que el caller tenga `puede_gestionar_roles` en
 * la empresa indicada. Hay además una regla dura: el rol 'admin' no
 * puede perder `puede_gestionar_usuarios` ni `puede_gestionar_roles`
 * (anti-lockout).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatrizPermisos, getPermisosEfectivos } from '@/lib/permisos'
import {
  isRolValido,
  PERMISOS_INMUTABLES_ADMIN,
  PERMISOS_KEYS,
  ROLES,
  ROLES_LIST,
  type PermisosRol,
  type Rol,
} from '@/lib/roles'

async function assertCallerPuedeGestionarRoles(empresaId: string): Promise<
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
  if (!efectivos.permisos.puede_gestionar_roles) {
    return {
      ok: false,
      status: 403,
      error: 'Requiere permiso para gestionar roles en esta empresa',
    }
  }

  return { ok: true, userId: user.id }
}

// ────────────────────────────────────────────────────────────────────
// GET
// ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const empresaId = req.nextUrl.searchParams.get('empresa_id') ?? ''
  const check = await assertCallerPuedeGestionarRoles(empresaId)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }

  const admin = createAdminClient()
  try {
    const matriz = await getMatrizPermisos(admin, empresaId)
    return NextResponse.json({ matriz })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al leer permisos'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ────────────────────────────────────────────────────────────────────
// PUT
// ────────────────────────────────────────────────────────────────────

interface PutBody {
  empresa_id?: unknown
  matriz?: unknown
}

function parsePermisos(input: unknown): PermisosRol | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: Partial<PermisosRol> = {}
  for (const k of PERMISOS_KEYS) {
    if (typeof src[k] !== 'boolean') return null
    out[k] = src[k] as boolean
  }
  return out as PermisosRol
}

export async function PUT(req: NextRequest) {
  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const empresaId = typeof body.empresa_id === 'string' ? body.empresa_id : ''
  if (!empresaId) {
    return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })
  }

  if (!body.matriz || typeof body.matriz !== 'object') {
    return NextResponse.json({ error: 'matriz requerida' }, { status: 400 })
  }
  const matrizRaw = body.matriz as Record<string, unknown>

  const matriz: Record<Rol, PermisosRol> = {} as Record<Rol, PermisosRol>
  for (const rol of ROLES_LIST) {
    if (!(rol in matrizRaw)) {
      return NextResponse.json(
        { error: `Falta el rol '${rol}' en la matriz` },
        { status: 400 },
      )
    }
    const parsed = parsePermisos(matrizRaw[rol])
    if (!parsed) {
      return NextResponse.json(
        { error: `Permisos inválidos para el rol '${rol}'` },
        { status: 400 },
      )
    }
    matriz[rol] = parsed
  }

  // Validar otras claves no soportadas (p. ej. el frontend mandó un rol inválido)
  for (const k of Object.keys(matrizRaw)) {
    if (!isRolValido(k)) {
      return NextResponse.json(
        { error: `Rol no soportado en la matriz: '${k}'` },
        { status: 400 },
      )
    }
  }

  // Anti-lockout: admin no puede perder estos permisos
  for (const inmutable of PERMISOS_INMUTABLES_ADMIN) {
    if (!matriz[ROLES.ADMIN][inmutable]) {
      return NextResponse.json(
        {
          error: `El rol Administrador no puede perder '${inmutable}' (anti-lockout)`,
        },
        { status: 400 },
      )
    }
  }

  const check = await assertCallerPuedeGestionarRoles(empresaId)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }

  const admin = createAdminClient()

  const rows = ROLES_LIST.map((rol) => ({
    empresa_id: empresaId,
    rol,
    ...matriz[rol],
    row_updated_at: new Date().toISOString(),
  }))

  const { error } = await admin
    .from('rol_permisos')
    .upsert(rows, { onConflict: 'empresa_id,rol' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, matriz })
}
