/**
 * POST /api/votacion/mesa/codigo   body: { codigo }
 *
 * Empieza a atender a una persona: canjea el código impreso que le entregó el
 * operador por un pase para votar EN ESTA terminal.
 *
 * Dos controles que no existen en `/v` y son la razón de que esta ruta exista
 * en vez de reusar `/api/votacion/codigo`:
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
 * Lo que NO cambia: el segundo factor se pide igual. El operador ya vio la
 * cédula, pero la planilla de códigos está arriba de la mesa y sin dígitos quien
 * la agarra vota por toda la lista.
 */

import { buscarCredencial, resolverCodigo } from '@/lib/elecciones'
import { esError } from '@/lib/elecciones-types'
import { firmarPase } from '@/lib/kiosco'
import { LIMITES, permitidoPorClave, RESPUESTA_429 } from '@/lib/rate-limit'
import { claveTerminal, conTerminal, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Tope defensivo. El código son 10 caracteres; se aceptan separadores. */
const MAX_LARGO = 40

export async function POST(req: Request) {
  try {
    const t = await conTerminal()
    if (!t.ok) return t.res

    let body: { codigo?: unknown }
    try {
      body = (await req.json()) as { codigo?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    if (!(await permitidoPorClave(t.admin, claveTerminal(t.sesion), LIMITES.kioscoCodigo))) {
      return json(RESPUESTA_429, 429)
    }

    const crudo = typeof body.codigo === 'string' ? body.codigo.trim() : ''
    if (!crudo || crudo.length > MAX_LARGO) {
      return json({ error: 'codigo_inexistente' })
    }

    // La normalización real —mayúsculas, sin espacios ni guiones— la hace el RPC.
    const canje = await resolverCodigo(t.admin, crudo)
    if (esError(canje)) return json(canje)

    // Estado de la credencial. Se pide igual que en `/v/{token}`, y por lo mismo:
    // no trae el nombre ni la boleta, que salen recién con el segundo factor.
    const estado = await buscarCredencial(t.admin, canje.token)
    if (esError(estado)) return json(estado)

    if (estado.eleccion.id !== t.sesion.eleccion_id) {
      return json({ error: 'otra_eleccion' })
    }

    // Lo que impide votar, en el orden en que le sirve a quien está parado
    // adelante: "ya votaste" es más informativo que "la votación cerró".
    if (estado.ya_voto) return json({ error: 'ya_voto' })
    if (!estado.habilitado) return json({ error: 'no_habilitado' })
    if (estado.bloqueado) return json({ error: 'bloqueado' })
    if (estado.ventana === 'no_abierta') {
      return json({ error: 'no_abierta', desde: estado.eleccion.fecha_apertura })
    }
    if (estado.ventana === 'cerrada_web') {
      return json({ error: 'cerrada_web', desde: estado.eleccion.fecha_cierre_web })
    }
    if (estado.ventana !== 'abierta') return json({ error: 'eleccion_cerrada' })

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
