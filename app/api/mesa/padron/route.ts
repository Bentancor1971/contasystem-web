/**
 * GET /api/mesa/padron?desde=<ISO>
 *
 * Sin `desde`: el padrón completo de la elección de esta mesa. Con `desde` —el
 * `hasta` de la respuesta anterior, que sale del reloj de Postgres— sólo lo que
 * cambió. El dispositivo guarda la lista en memoria y busca ahí.
 *
 * ⚠️ Este endpoint NO recibe ni puede recibir un texto de búsqueda. Ni una
 * cédula ni un nombre. Un endpoint que contesta por una cédula suelta es un
 * oráculo de quién es socio aunque tenga login delante, y es exactamente lo que
 * el módulo entero evita. La búsqueda vive en `buscarEnPadron()`, del lado del
 * dispositivo. Ver docs/web/elecciones-mesa.md.
 */

import { mesaPadron } from '@/lib/mesa'
import { conSesion, errorInterno, json } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const s = await conSesion()
    if (!s.ok) return s.res

    const desde = new URL(req.url).searchParams.get('desde')
    // Una marca de agua rota traería un delta vacío para siempre y la pantalla
    // se quedaría congelada sin avisar. Se ignora y se manda el padrón entero.
    const valida = desde && !isNaN(new Date(desde).getTime()) ? desde : null

    return json(await mesaPadron(s.admin, s.sesion, valida))
  } catch (err) {
    return errorInterno('GET /api/mesa/padron', err)
  }
}
