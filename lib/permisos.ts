/**
 * Helpers para leer/escribir la matriz de permisos por (empresa, rol).
 *
 * - El frontend lee los permisos del usuario actual vía /api/admin/permisos
 *   (o directamente desde supabase con el cliente del browser).
 * - El backend usa estos helpers contra el cliente admin para enforcement.
 *
 * Si una empresa no tiene fila en `rol_permisos` para un rol, se cae a
 * los defaults definidos en lib/roles.ts (DEFAULT_PERMISOS).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_PERMISOS,
  isRolValido,
  permisosConDefaults,
  ROLES_LIST,
  type PermisosRol,
  type Rol,
} from './roles'

interface RolPermisosRow {
  rol: string
  puede_cargar: boolean
  puede_ver_config: boolean
  puede_gestionar_usuarios: boolean
  puede_gestionar_roles: boolean
}

/**
 * Devuelve la matriz completa (3 roles) para una empresa, mergeando con
 * los defaults para los roles que aún no tienen fila.
 */
export async function getMatrizPermisos(
  client: SupabaseClient,
  empresaId: string,
): Promise<Record<Rol, PermisosRol>> {
  const { data, error } = await client
    .from('rol_permisos')
    .select(
      'rol, puede_cargar, puede_ver_config, puede_gestionar_usuarios, puede_gestionar_roles',
    )
    .eq('empresa_id', empresaId)

  if (error) throw error

  const matriz: Record<Rol, PermisosRol> = {
    admin: { ...DEFAULT_PERMISOS.admin },
    contador: { ...DEFAULT_PERMISOS.contador },
    usuario: { ...DEFAULT_PERMISOS.usuario },
  }

  for (const row of (data ?? []) as RolPermisosRow[]) {
    if (!isRolValido(row.rol)) continue
    matriz[row.rol] = permisosConDefaults(row.rol, {
      puede_cargar: row.puede_cargar,
      puede_ver_config: row.puede_ver_config,
      puede_gestionar_usuarios: row.puede_gestionar_usuarios,
      puede_gestionar_roles: row.puede_gestionar_roles,
    })
  }

  // Aseguramos que ROLES_LIST no quede desincronizado con la matriz
  for (const rol of ROLES_LIST) {
    if (!matriz[rol]) matriz[rol] = { ...DEFAULT_PERMISOS[rol] }
  }

  return matriz
}

/**
 * Permisos efectivos para un (user, empresa). Lee el rol del user y luego
 * la fila correspondiente en rol_permisos (con fallback a defaults).
 */
export async function getPermisosEfectivos(
  client: SupabaseClient,
  userId: string,
  empresaId: string,
): Promise<{ rol: Rol; permisos: PermisosRol } | null> {
  const { data: rolRow, error: rolErr } = await client
    .from('user_empresas')
    .select('rol')
    .eq('user_id', userId)
    .eq('empresa_id', empresaId)
    .single()

  if (rolErr || !rolRow) return null
  if (!isRolValido(rolRow.rol)) return null
  const rol: Rol = rolRow.rol

  const { data: permRow, error: permErr } = await client
    .from('rol_permisos')
    .select(
      'puede_cargar, puede_ver_config, puede_gestionar_usuarios, puede_gestionar_roles',
    )
    .eq('empresa_id', empresaId)
    .eq('rol', rol)
    .maybeSingle()

  // Si no se puede leer la fila de permisos (sin fila, error de red, RLS),
  // degradamos a los defaults del rol — igual que hace el cliente en
  // AppShell. Un error de lectura no debe ser más fatal que una fila
  // ausente: ambos casos están cubiertos por DEFAULT_PERMISOS.
  if (permErr) {
    console.warn(
      `[permisos] no se pudo leer rol_permisos para empresa=${empresaId} rol=${rol}, usando defaults · ${permErr.message}`,
    )
  }

  const permisos = permisosConDefaults(rol, permRow ?? null)
  return { rol, permisos }
}
