/**
 * POST /api/votacion/mesa/desmontar   body: { llave }
 *
 * Baja la terminal de este dispositivo. **Pide la llave otra vez**, y no es
 * burocracia: en modo mesa no hay salida para el votante —ni links, ni menús—
 * justamente porque el dispositivo es compartido, y un botón que cualquiera
 * puede tocar para desmontar la tablet a mitad de la fila es la misma puerta
 * por otro lado.
 *
 * Con la llave en la mano el operador desmonta en cinco segundos. Sin ella, la
 * terminal se cierra igual desde el desktop —Elecciones → Credenciales → Cerrar
 * terminal—, que es el camino que funciona aunque la tablet ya no esté a mano.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { abrirKiosco, borrarSesionKiosco, leerSesionKiosco } from '@/lib/kiosco'
import { llaveNormalizada } from '@/lib/kiosco-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const sesion = await leerSesionKiosco()
    // Sin sesión no hay nada que proteger: se limpia y listo.
    if (!sesion) {
      await borrarSesionKiosco()
      return json({ ok: true })
    }

    let body: { llave?: unknown }
    try {
      body = (await req.json()) as { llave?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.kioscoAbrir))) {
      return json(RESPUESTA_429, 429)
    }

    const llave = llaveNormalizada(body.llave)
    if (llave === null) return json({ error: 'codigo_invalido' })

    const r = await abrirKiosco(admin, llave)
    if ('error' in r) {
      // `kiosco_no_disponible` (la función no existe: falta 46_) NO es "la
      // llave está mal" — es un problema de despliegue, y colapsarlo en
      // `codigo_invalido` mandaba al operador a revisar una llave que estaba
      // bien. Se deja pasar tal cual; el resto de los errores de `abrirKiosco`
      // sí se generalizan más abajo.
      return json(r.error === 'kiosco_no_disponible' ? r : { error: 'codigo_invalido' })
    }
    // La llave tiene que ser la de ESTA elección. Una llave válida de otra no
    // desmonta esta terminal: si no, alcanzaría con tener cualquier llave.
    if (r.eleccion_id !== sesion.eleccion_id) {
      return json({ error: 'codigo_invalido' })
    }

    await borrarSesionKiosco()
    return json({ ok: true })
  } catch (err) {
    return errorInterno('POST /api/votacion/mesa/desmontar', err)
  }
}
