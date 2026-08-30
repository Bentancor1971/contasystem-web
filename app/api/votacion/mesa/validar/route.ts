/**
 * POST /api/votacion/mesa/validar   body: { pase, digitos }
 *
 * Segundo factor en la terminal. Devuelve el nombre de pila y la boleta.
 *
 * El token no viene por body: viene adentro del pase firmado que emitió
 * `/codigo`, atado a esta terminal y a esta elección. Un token suelto no sirve
 * acá, y un pase de otra terminal tampoco.
 *
 * El bloqueo por credencial —5 fallos, 15 minutos— lo sigue haciendo la base,
 * igual que en `/v/{token}`. Lo que se relaja en modo mesa es el tope por IP, no
 * el que protege a cada votante.
 *
 * Usa `validar_credencial_kiosco` (61_, E5a): misma validación que `/v`, con la
 * exención del cierre del canal web activa, para que quien pasó `/codigo` con
 * `cerrada_web` tratado como abierto no se quede cortado acá. Sin 61_ aplicado
 * cae sola a `validar_credencial` de siempre —sin la exención—.
 */

import { digitosValidos } from '@/lib/elecciones-types'
import { leerPase, validarCredencialKiosco } from '@/lib/kiosco'
import { ocultarInexistente } from '@/lib/elecciones'
import { LIMITES, permitidoPorClave, RESPUESTA_429 } from '@/lib/rate-limit'
import { claveTerminal, conTerminal, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const t = await conTerminal()
    if (!t.ok) return t.res

    let body: { pase?: unknown; digitos?: unknown }
    try {
      body = (await req.json()) as { pase?: unknown; digitos?: unknown }
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }

    if (!(await permitidoPorClave(t.admin, claveTerminal(t.sesion), LIMITES.kioscoValidar))) {
      return json(RESPUESTA_429, 429)
    }

    const token = leerPase(body.pase, t.sesion.eleccion_id)
    // Un pase vencido es lo normal, no un ataque: alguien dejó la pantalla
    // abierta. Se manda a empezar de nuevo con el código.
    if (!token) return json({ error: 'pase_vencido' })

    const digitos = digitosValidos(body.digitos)
    // Mismo criterio que `/v`: nada de lo que sale de acá dice si la credencial
    // existe.
    if (digitos === null) return json({ error: 'digitos_incorrectos' })

    return json(ocultarInexistente(await validarCredencialKiosco(t.admin, token, digitos)))
  } catch (err) {
    return errorInterno('POST /api/votacion/mesa/validar', err)
  }
}
