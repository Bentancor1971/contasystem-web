/**
 * Chequeo de autorización para los endpoints de la feature de cumpleaños
 * (estado y edición de la plantilla).
 *
 * La config del cron es global, pero el modelo de permisos de la app es
 * por empresa. Por eso recibimos el `empresa_id` de la empresa ACTIVA de
 * la web app (la del usuario, en empresas_online_remoto) y verificamos
 * que tenga `puede_ver_config` ahí.
 *
 * OJO (E7): esto sólo autoriza "puede ver ALGUNA configuración" — NO alcanza
 * para operar sobre la empresa DESTINO (la plantilla que se lee/edita, la
 * casilla Gmail que se cambia, los socios que se listan), que puede ser
 * cualquier otra que venga en el body/query. Para eso está
 * `assertAccesoEmpresaDestino` más abajo: los endpoints tienen que llamar a
 * las dos.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPermisosEfectivos } from '@/lib/permisos'

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }

export async function assertPuedeVerConfig(empresaId: string): Promise<AuthResult> {
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
  if (!efectivos.permisos.puede_ver_config) {
    return {
      ok: false,
      status: 403,
      error: 'Tu rol no tiene permiso para ver la configuración',
    }
  }

  return { ok: true, userId: user.id }
}

/**
 * ¿El usuario tiene acceso a `empresaId` — la empresa DESTINO sobre la que se
 * va a operar (leer/escribir su plantilla de cumpleaños, su casilla Gmail, o
 * listar sus socios), no la empresa activa del caller?
 *
 * E7: antes de esto, `assertPuedeVerConfig` validaba `puede_ver_config` sobre
 * la empresa activa y el endpoint operaba sobre CUALQUIER `plantilla_empresa`
 * / `filter_empresa` del body o el query, sin volver a chequear nada — un
 * contador de la empresa A podía leer y escribir la plantilla y la casilla
 * Gmail + App Password de la empresa B, y listar el padrón de todas.
 *
 * Reproduce a mano la semántica de `user_has_empresa` (docs/supabase/05_
 * comprobantes_online.sql): fila directa en `user_empresas`, o indirecta vía
 * `user_grupos` contra el `grupo_id` de esa empresa en
 * `empresas_online_remoto`. Tiene que reimplementarse acá (no alcanza con
 * RLS) porque estos endpoints leen con el cliente admin (service_role), que
 * bypassa las policies — el scope por tenant lo pone la web, no Postgres.
 */
export async function assertAccesoEmpresaDestino(
  userId: string,
  empresaId: string,
): Promise<boolean> {
  if (!userId || !empresaId) return false

  const admin = createAdminClient()

  const { data: directa } = await admin
    .from('user_empresas')
    .select('user_id')
    .eq('user_id', userId)
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (directa) return true

  const { data: empresaRow } = await admin
    .from('empresas_online_remoto')
    .select('grupo_id')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  const grupoId = (empresaRow as { grupo_id: string | null } | null)?.grupo_id
  if (!grupoId) return false

  const { data: grupoRow } = await admin
    .from('user_grupos')
    .select('user_id')
    .eq('user_id', userId)
    .eq('grupo_id', grupoId)
    .maybeSingle()
  return !!grupoRow
}

/**
 * Todas las empresas a las que el usuario tiene acceso: unión de las filas
 * directas en `user_empresas` y las que le llegan por grupo (vía
 * `user_grupos` → `empresas_online_remoto.grupo_id`).
 *
 * Para filtrar LISTADOS que antes mostraban las empresas de todo el mundo
 * (E7, decisión: cerrar el cruce de tenant): `birthday-config` (qué casillas
 * Gmail están configuradas) y `socios` (el padrón) tienen que ofrecer sólo
 * las empresas del caller, no las de `empresas_api_keys`/`empresas_online_remoto`
 * completas.
 */
export async function empresasAccesiblesParaUsuario(userId: string): Promise<Set<string>> {
  const admin = createAdminClient()
  const ids = new Set<string>()
  if (!userId) return ids

  const { data: directas } = await admin
    .from('user_empresas')
    .select('empresa_id')
    .eq('user_id', userId)
  for (const r of (directas ?? []) as { empresa_id: string | null }[]) {
    if (r.empresa_id) ids.add(r.empresa_id)
  }

  const { data: grupos } = await admin
    .from('user_grupos')
    .select('grupo_id')
    .eq('user_id', userId)
  const grupoIds = [
    ...new Set(
      (grupos ?? [])
        .map((g) => (g as { grupo_id: string | null }).grupo_id)
        .filter((g): g is string => !!g),
    ),
  ]
  if (grupoIds.length > 0) {
    const { data: empresasGrupo } = await admin
      .from('empresas_online_remoto')
      .select('empresa_id')
      .in('grupo_id', grupoIds)
    for (const r of (empresasGrupo ?? []) as { empresa_id: string | null }[]) {
      if (r.empresa_id) ids.add(r.empresa_id)
    }
  }

  return ids
}
