/**
 * Autorización de los endpoints de /checkin.
 *
 * El requisito es pertenecer a la empresa, no un permiso fino: quien controla
 * la puerta suele tener el rol `usuario` (el que menos permisos tiene) y aun
 * así tiene que poder marcar asistencias. No se agrega un permiso nuevo a la
 * matriz de roles porque no habría a quién negárselo dentro de la empresa.
 *
 * Lo que SÍ hace falta es el scope por empresa: `marcar_asistencia_entrada` es
 * SECURITY DEFINER y sólo recibe un token, así que sin este chequeo un operador
 * de la empresa A podría marcar una entrada de la empresa B con sólo tener el
 * token. Los endpoints verifican `empresa_id` de la entrada contra ésta.
 */

import { createClient } from '@/lib/supabase/server'
import { getPermisosEfectivos } from '@/lib/permisos'

export type CheckinAuth =
  | { ok: true; userId: string; email: string; empresaId: string }
  | { ok: false; status: number; error: string }

export async function assertAccesoEmpresa(
  empresaId: string,
): Promise<CheckinAuth> {
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

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? '',
    empresaId,
  }
}
