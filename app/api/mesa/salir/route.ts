/**
 * POST /api/mesa/salir
 *
 * Borra la sesión de la base (RPC `mesa_salir`, 61_) Y las cookies del puesto.
 * Antes de 61_ esto sólo borraba la cookie: el UUID seguía sirviendo hasta
 * 12 h, así que el celular prestado conservaba acceso al padrón entero con
 * documentos hasta que venciera solo.
 *
 * La cookie se borra SIEMPRE, pase lo que pase con el RPC: si `mesa_salir` no
 * existe todavía (falta aplicar 61_) o la llamada falla por lo que sea, este
 * dispositivo tiene que perder el acceso igual — es lo mínimo que "Salir" le
 * debe a quien lo aprieta.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { borrarSesionMesa, leerSesionMesa } from '@/lib/mesa-sesion'
import { errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const sesion = await leerSesionMesa()
    if (sesion) {
      try {
        const { error } = await createAdminClient().rpc('mesa_salir', { p_sesion: sesion })
        if (error) {
          console.warn(`[mesa/salir] mesa_salir no se pudo aplicar (¿falta 61_?): ${error.message}`)
        }
      } catch (err) {
        // Sin service key no hay a quién avisarle: la cookie se borra igual.
        console.warn('[mesa/salir] mesa_salir falló:', err)
      }
    }

    await borrarSesionMesa()
    return json({ ok: true })
  } catch (err) {
    return errorInterno('POST /api/mesa/salir', err)
  }
}
