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
  ROLES,
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

/** PostgREST cuando no encuentra la función pedida (falta la migración). */
const PGRST_FUNCION_INEXISTENTE = new Set(['PGRST202', '42883'])

/**
 * P4: intenta resolver todo en UN viaje con la RPC `mis_permisos` (SQL 63 —
 * `docs/supabase/63_app_web_fixes.sql`). SECURITY DEFINER, usa `auth.uid()`
 * — sólo tiene sentido si `client` lleva la sesión del propio `userId` (los
 * call sites de este archivo siempre pasan el user recién leído de
 * `auth.getUser()` sobre ESE mismo client, así que coincide).
 *
 * Devuelve `undefined` cuando el RPC no existe todavía (no se aplicó el SQL)
 * o falló por cualquier otro motivo: el caller cae al camino de siempre.
 * Devuelve `null` cuando el RPC respondió pero no hay acceso (`via: null`).
 */
async function tryMisPermisosRpc(
  client: SupabaseClient,
  empresaId: string,
): Promise<{ rol: Rol; permisos: PermisosRol } | null | undefined> {
  const { data, error } = await client.rpc('mis_permisos', {
    p_empresa_id: empresaId,
  })
  if (error) {
    if (!PGRST_FUNCION_INEXISTENTE.has(error.code ?? '')) {
      console.warn(`[permisos] RPC mis_permisos falló, degradando · ${error.message}`)
    }
    return undefined
  }
  const row = data as {
    rol: string | null
    puede_cargar: boolean
    puede_ver_config: boolean
    puede_gestionar_usuarios: boolean
    puede_gestionar_roles: boolean
    via: 'empresa' | 'grupo' | null
  } | null
  if (!row || !row.via || !isRolValido(row.rol)) return null
  return {
    rol: row.rol,
    permisos: {
      puede_cargar: !!row.puede_cargar,
      puede_ver_config: !!row.puede_ver_config,
      puede_gestionar_usuarios: !!row.puede_gestionar_usuarios,
      puede_gestionar_roles: !!row.puede_gestionar_roles,
    },
  }
}

/**
 * Permisos efectivos para un (user, empresa). Primero intenta la RPC
 * `mis_permisos` (1 viaje); si no existe (SQL 63 sin aplicar) degrada al
 * camino de siempre: lee el rol del user y luego la fila correspondiente en
 * rol_permisos (con fallback a defaults).
 *
 * E18: un usuario asignado por GRUPO (`user_grupos`, no `user_empresas`)
 * pasaba de largo acá — `null` a la primera consulta— y el server le
 * devolvía 403 en todo `/api/checkin/*` y `/api/admin/*`, aunque la RLS de
 * las tablas sí lo dejara pasar por `user_has_grupo` (05_comprobantes_online.sql).
 * Si no hay fila directa, se busca el `grupo_id` de la empresa en
 * `empresas_online_remoto` y se chequea `user_grupos` contra ese grupo — la
 * misma resolución que ya hacía `user_has_empresa` en SQL. El rol para un
 * acceso por grupo es siempre `usuario` (el mínimo): no hay un concepto de
 * "rol de grupo" separado, así que no se inventa nada más permisivo. (La
 * RPC hace exactamente esta misma resolución del lado de Postgres.)
 */
export async function getPermisosEfectivos(
  client: SupabaseClient,
  userId: string,
  empresaId: string,
): Promise<{ rol: Rol; permisos: PermisosRol } | null> {
  const viaRpc = await tryMisPermisosRpc(client, empresaId)
  if (viaRpc !== undefined) return viaRpc

  const { data: rolRow, error: rolErr } = await client
    .from('user_empresas')
    .select('rol')
    .eq('user_id', userId)
    .eq('empresa_id', empresaId)
    .maybeSingle()

  let rol: Rol
  if (!rolErr && rolRow && isRolValido(rolRow.rol)) {
    rol = rolRow.rol
  } else {
    const rolGrupo = await resolverRolPorGrupo(client, userId, empresaId)
    if (!rolGrupo) return null
    rol = rolGrupo
  }

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

/**
 * Resuelve el rol de un usuario sin fila directa en `user_empresas`, vía
 * `user_grupos`: busca el `grupo_id` de la empresa en `empresas_online_remoto`
 * y chequea si el user tiene ese grupo asignado. Devuelve `usuario` (el
 * default más bajo) si hay match, o `null` si no hay acceso por ningún lado —
 * mismo criterio que `user_has_empresa` en SQL (05_comprobantes_online.sql).
 */
async function resolverRolPorGrupo(
  client: SupabaseClient,
  userId: string,
  empresaId: string,
): Promise<Rol | null> {
  const { data: empresaRow, error: empresaErr } = await client
    .from('empresas_online_remoto')
    .select('grupo_id')
    .eq('empresa_id', empresaId)
    .maybeSingle()

  const grupoId = (empresaRow as { grupo_id: string | null } | null)?.grupo_id
  if (empresaErr || !grupoId) return null

  const { data: grupoRow, error: grupoErr } = await client
    .from('user_grupos')
    .select('user_id')
    .eq('user_id', userId)
    .eq('grupo_id', grupoId)
    .maybeSingle()

  if (grupoErr || !grupoRow) return null
  return ROLES.USUARIO
}
