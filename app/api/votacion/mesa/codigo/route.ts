/**
 * POST /api/votacion/mesa/codigo   body: { codigo }
 *
 * Empieza a atender a una persona: canjea el código impreso que le entregó el
 * operador por un pase para votar EN ESTA terminal.
 *
 * Tres cosas que no existen en `/v` y son la razón de que esta ruta exista en
 * vez de reusar `/api/votacion/codigo`:
 *
 *  1. **El código tiene que ser de la elección de la sesión.** Un código de otra
 *     elección, aunque sea perfectamente válido, se rechaza acá. Si no, la
 *     tablet montada para la elección de la Comisión Directiva serviría para
 *     votar la consulta del balance.
 *
 *  2. **El tope se cuenta por terminal, no por IP.** Es lo que compra la llave:
 *     doscientas personas votando desde la conexión del club no pueden trancarse
 *     entre ellas, y sigue habiendo tope.
 *
 *  3. **`cerrada_web` NO bloquea acá (E5a).** La terminal está EN el local: lo
 *     que cerró es el canal de internet, no la votación, y el voto de esta
 *     terminal sigue el camino de kiosco (`emitir_voto_kiosco`, 61_), exento de
 *     ese cierre por el GUC `app.kiosco`. Tratarlo como abierto acá es lo que
 *     hace que el resto del flujo (validar, emitir) tenga algo que emitir.
 *
 * Lo que NO cambia: el segundo factor se pide igual. El operador ya vio la
 * cédula, pero la planilla de códigos está arriba de la mesa y sin dígitos quien
 * la agarra vota por toda la lista.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { esError } from '@/lib/elecciones-types'
import { canjearCodigoKiosco, firmarPase, leerSesionKiosco, terminalVigente } from '@/lib/kiosco'
import { LIMITES, permitidoPorClave, RESPUESTA_429 } from '@/lib/rate-limit'
import { claveTerminal, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Tope defensivo. El código son 10 caracteres; se aceptan separadores. */
const MAX_LARGO = 40

export async function POST(req: Request) {
  try {
    const sesion = await leerSesionKiosco()
    if (!sesion) return json({ error: 'sesion_invalida' }, 401)

    let body: { codigo?: unknown }
    try {
      body = (await req.json()) as { codigo?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    const admin = createAdminClient()
    // P8: los dos viajes no dependen uno del otro — la vigencia de la terminal
    // y el tope de esta terminal se resuelven en paralelo, no en serie.
    const [vigente, permitido] = await Promise.all([
      terminalVigente(admin, sesion),
      permitidoPorClave(admin, claveTerminal(sesion), LIMITES.kioscoCodigo),
    ])
    if (!vigente) return json({ error: 'sesion_invalida' }, 401)
    if (!permitido) return json(RESPUESTA_429, 429)

    const crudo = typeof body.codigo === 'string' ? body.codigo.trim() : ''
    if (!crudo || crudo.length > MAX_LARGO) {
      return json({ error: 'codigo_inexistente' })
    }

    // P8 / E5a: `kiosco_canjear` (61_) junta resolver_codigo() + buscar_
    // credencial() en un viaje; sin ese script aplicado, cae sola a las dos
    // llamadas de siempre (más lenta, sin cambiar el resultado).
    const canje = await canjearCodigoKiosco(admin, crudo)
    if (esError(canje)) return json(canje)

    const estado = canje.estado
    if (estado.eleccion.id !== sesion.eleccion_id) {
      return json({ error: 'otra_eleccion' })
    }

    // Lo que impide votar, en el orden en que le sirve a quien está parado
    // adelante: "ya votaste" es más informativo que "la votación cerró".
    if (estado.ya_voto) return json({ error: 'ya_voto', emitido_at: estado.emitido_at })
    if (!estado.habilitado) return json({ error: 'no_habilitado' })
    if (estado.bloqueado) return json({ error: 'bloqueado' })
    if (estado.ventana === 'no_abierta') {
      return json({ error: 'no_abierta', desde: estado.eleccion.fecha_apertura })
    }
    // NUEVO (E5a): acá NO se corta con `cerrada_web` — ver el punto 3 del
    // encabezado. `validar` y `emitir` usan la RPC de kiosco, que trae la
    // misma exención.
    if (estado.ventana !== 'abierta' && estado.ventana !== 'cerrada_web') {
      return json({ error: 'eleccion_cerrada' })
    }

    return json({
      ok: true,
      // El token no vuelve pelado: viaja adentro de un pase firmado, atado a
      // esta terminal y a esta elección, y vive en memoria del browser hasta
      // que la persona emite o se va. No se guarda en ningún lado.
      pase: firmarPase(canje.token, estado.eleccion.id),
      verificacion_digitos: estado.verificacion_digitos,
      // El instructivo es donde la institución avisa que el voto es nominal.
      // Quien vota tiene derecho a leerlo también acá, no sólo en el mail.
      instructivo: estado.eleccion.instructivo,
      texto_despues: estado.eleccion.texto_despues,
    })
  } catch (err) {
    return errorInterno('POST /api/votacion/mesa/codigo', err)
  }
}
