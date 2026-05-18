/**
 * Roles fijos por (user, empresa). Ver docs/supabase/06_roles.sql + 07_rol_usuario.sql.
 *
 * - admin    → todo, incluida gestión de usuarios y roles
 * - contador → carga + configuración (sin gestión de usuarios/roles por defecto)
 * - usuario  → solo carga (rol por defecto al crear)
 *
 * Los permisos efectivos son editables por empresa desde
 * /configuracion/roles → ver docs/supabase/08_rol_permisos.sql.
 * Si una empresa no tiene fila para un rol, se cae a DEFAULT_PERMISOS.
 */

export const ROLES = {
  ADMIN: 'admin',
  CONTADOR: 'contador',
  USUARIO: 'usuario',
} as const

export type Rol = (typeof ROLES)[keyof typeof ROLES]

export const ROLES_LIST: Rol[] = [ROLES.ADMIN, ROLES.CONTADOR, ROLES.USUARIO]

export const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administrador',
  contador: 'Contador',
  usuario: 'Usuario',
}

export const ROL_DESCRIPCION: Record<Rol, string> = {
  admin: 'Acceso total · puede crear usuarios y asignar roles',
  contador: 'Carga + Configuración · sin gestión de usuarios',
  usuario: 'Solo carga de comprobantes',
}

export function isRolValido(v: unknown): v is Rol {
  return v === 'admin' || v === 'contador' || v === 'usuario'
}

export function isAdmin(rol: Rol | null | undefined): boolean {
  return rol === ROLES.ADMIN
}

// ────────────────────────────────────────────────────────────────────
// Permisos por rol (matriz editable por empresa)
// ────────────────────────────────────────────────────────────────────

export interface PermisosRol {
  puede_cargar: boolean
  puede_ver_config: boolean
  puede_gestionar_usuarios: boolean
  puede_gestionar_roles: boolean
}

export const PERMISOS_KEYS: (keyof PermisosRol)[] = [
  'puede_cargar',
  'puede_ver_config',
  'puede_gestionar_usuarios',
  'puede_gestionar_roles',
]

export const PERMISO_LABEL: Record<keyof PermisosRol, string> = {
  puede_cargar: 'Carga',
  puede_ver_config: 'Ver configuración',
  puede_gestionar_usuarios: 'Gestionar usuarios',
  puede_gestionar_roles: 'Gestionar roles',
}

export const PERMISO_DESCRIPCION: Record<keyof PermisosRol, string> = {
  puede_cargar: 'Crear y editar comprobantes en /carga',
  puede_ver_config: 'Acceso al menú de Configuración',
  puede_gestionar_usuarios: 'Crear usuarios y cambiarles el rol',
  puede_gestionar_roles: 'Editar esta matriz de permisos',
}

/**
 * Defaults usados cuando una empresa no tiene fila en `rol_permisos`
 * para un rol dado. Reproducen el comportamiento previo a la migración 08.
 */
export const DEFAULT_PERMISOS: Record<Rol, PermisosRol> = {
  admin: {
    puede_cargar: true,
    puede_ver_config: true,
    puede_gestionar_usuarios: true,
    puede_gestionar_roles: true,
  },
  contador: {
    puede_cargar: true,
    puede_ver_config: true,
    puede_gestionar_usuarios: false,
    puede_gestionar_roles: false,
  },
  usuario: {
    puede_cargar: true,
    puede_ver_config: false,
    puede_gestionar_usuarios: false,
    puede_gestionar_roles: false,
  },
}

/**
 * Permisos que el rol admin SIEMPRE debe tener, para evitar que un admin
 * se auto-bloquee al editar la matriz. Enforced en el endpoint PUT.
 */
export const PERMISOS_INMUTABLES_ADMIN: (keyof PermisosRol)[] = [
  'puede_gestionar_usuarios',
  'puede_gestionar_roles',
]

export function permisosConDefaults(
  rol: Rol,
  parcial: Partial<PermisosRol> | null | undefined,
): PermisosRol {
  return { ...DEFAULT_PERMISOS[rol], ...(parcial ?? {}) }
}

export function canSeeConfig(p: PermisosRol | null | undefined): boolean {
  return !!p?.puede_ver_config
}

export function canManageUsers(p: PermisosRol | null | undefined): boolean {
  return !!p?.puede_gestionar_usuarios
}

export function canManageRoles(p: PermisosRol | null | undefined): boolean {
  return !!p?.puede_gestionar_roles
}
