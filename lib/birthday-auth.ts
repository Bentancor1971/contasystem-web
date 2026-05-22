/**
 * Chequeo de autorización para los endpoints de la feature de cumpleaños
 * (estado y edición de la plantilla).
 *
 * La config del cron es global, pero el modelo de permisos de la app es
 * por empresa. Por eso recibimos el `empresa_id` de la empresa ACTIVA de
 * la web app (la del usuario, en empresas_online_remoto) y verificamos
 * que tenga `puede_ver_config` ahí.
 */

import { createClient } from '@/lib/supabase/server'
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
