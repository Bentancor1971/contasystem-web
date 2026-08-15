/**
 * El token reservado que sirve para probar el acceso sin tocar a ningún votante.
 *
 * El desktop manda un mail de prueba antes de disparar el lote —para ver cómo
 * queda el texto, la imagen y el botón— y hasta ahora ese botón no podía apuntar
 * a `/v/{token}` ni a `/p/{token}`: el único token que existe es el de una
 * persona real, y una copia del mail con ese token adentro deja la papeleta de
 * otro a mano de quien abra la casilla, le marca la apertura y el click en su
 * fila de tracking, y en el peor caso termina en un voto usurpado.
 *
 * Por eso el token de prueba **no existe en la base y no tiene que existir**.
 * `prueba-acceso` es una constante, no una fila: los tokens reales son UUID que
 * genera el desktop, así que nunca va a haber colisión.
 *
 * Lo que la pantalla hace con él es correr **el mismo camino de acceso** que
 * corre un link real —levantar la service key, llegar a Supabase, ejecutar la
 * misma RPC— y contar cómo le fue. Es la diferencia con apuntar a la página
 * pública: ahí sólo se comprueba que el dominio responde; acá se comprueba que
 * el despliegue puede hablar con la base, que es donde falla de verdad un
 * acceso (variable de entorno sin cargar, service key rotada, RPC sin permisos
 * después de un `revoke`).
 *
 * **Lo que NO prueba:** que un token real resuelva. La RPC contesta "esta
 * credencial no existe" —que es la respuesta correcta para un token inventado—
 * y eso no dice nada sobre el padrón. Para eso hay que abrir una credencial de
 * verdad.
 *
 * ⚠️ Server-only: arrastra el cliente admin.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarCredencial } from '@/lib/elecciones'
import { buscarConvocatoria } from '@/lib/convocatorias'
import { ipDeHeaders, LIMITES, permitidoPorIp } from '@/lib/rate-limit'

/**
 * El token de la URL de prueba: `{base}/v/prueba-acceso` y `{base}/p/prueba-acceso`.
 *
 * Tiene que pasar `tokenValido` —8 a 100 caracteres de `[A-Za-z0-9_-]`— para
 * que la prueba recorra la misma puerta que un link real y no un desvío.
 */
export const TOKEN_PRUEBA = 'prueba-acceso'

/** Se compara sin distinguir mayúsculas: un mail puede llegar con el link capitalizado. */
export function esTokenDePrueba(token: string): boolean {
  return token.toLowerCase() === TOKEN_PRUEBA
}

export type ModuloPrueba = 'votacion' | 'convocatoria'

export interface PasoPrueba {
  titulo: string
  ok: boolean
  detalle: string
}

export interface ResultadoPrueba {
  /** false si algún paso falló: es lo que decide el titular de la pantalla. */
  ok: boolean
  pasos: PasoPrueba[]
}

/** Qué RPC atiende el primer paso de cada módulo. Es la que se prueba. */
const RPC: Record<ModuloPrueba, string> = {
  votacion: 'buscar_credencial',
  convocatoria: 'buscar_convocatoria',
}

/**
 * Corre el camino de acceso con el token reservado y devuelve qué respondió cada
 * tramo. Nunca lanza: un acceso roto tiene que poder contarse en la pantalla, no
 * terminar en un 500 —que es justamente el síntoma que se está diagnosticando—.
 */
export async function diagnosticarAcceso(
  modulo: ModuloPrueba,
  tokenRecibido: string,
  headersEntrantes: Headers,
): Promise<ResultadoPrueba> {
  const rpc = RPC[modulo]
  const pasos: PasoPrueba[] = [
    {
      titulo: 'La página respondió',
      ok: true,
      detalle:
        'El dominio, la ruta y el despliegue están bien: si estás leyendo esto, el link del ' +
        'mail llegó a destino.',
    },
    {
      titulo: 'El link llegó entero',
      ok: true,
      detalle:
        `Se recibió el token «${tokenRecibido}» tal cual. Un cliente de correo que parte las ` +
        'URLs largas lo habría dejado cortado y esta pantalla diría que el link no es válido.',
    },
  ]

  // La conexión con la base es lo primero que puede faltar, y falta entera: sin
  // service key no hay a quién preguntarle nada.
  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch (err) {
    pasos.push({
      titulo: 'Falta la configuración de la base',
      ok: false,
      detalle:
        `${mensajeDe(err)}. Con un link real esta pantalla daría un error del servidor. Se ` +
        'arregla en las variables de entorno del despliegue, no en el desktop.',
    })
    return { ok: false, pasos }
  }

  // Bucket propio: probar el acceso no puede gastarle el cupo a quien está
  // votando desde la misma IP —en un local con wifi compartida, son la misma—.
  const ip = ipDeHeaders(headersEntrantes)
  if (!(await permitidoPorIp(admin, ip, LIMITES.pruebaAcceso))) {
    pasos.push({
      titulo: 'Demasiadas pruebas desde esta conexión',
      ok: false,
      detalle:
        'El tope por IP cortó esta prueba. Esperá unos minutos y volvé a abrir el link: no es ' +
        'un problema del acceso, y a quien vote desde esta misma conexión no le afecta.',
    })
    return { ok: false, pasos }
  }

  try {
    const r =
      modulo === 'votacion'
        ? await buscarCredencial(admin, TOKEN_PRUEBA)
        : await buscarConvocatoria(admin, TOKEN_PRUEBA)

    // Que exista una credencial con este token significa que alguien la cargó a
    // mano: el link de prueba estaría abriendo el acceso de una persona real.
    if ('ok' in r && r.ok === true) {
      pasos.push({
        titulo: 'Hay una credencial real con el token de prueba',
        ok: false,
        detalle:
          `${rpc} devolvió una credencial para «${TOKEN_PRUEBA}», que tendría que ser un token ` +
          'inexistente. Revisá el padrón: mientras esa fila esté, el link de prueba abre el ' +
          'acceso de esa persona.',
      })
      return { ok: false, pasos }
    }

    pasos.push({
      titulo: 'La base respondió',
      ok: true,
      detalle:
        `${rpc} contestó que esta credencial no existe, que es exactamente lo que corresponde ` +
        'para un token de prueba. El camino completo —despliegue, service key, permisos de la ' +
        'función— está funcionando.',
    })
    return { ok: true, pasos }
  } catch (err) {
    pasos.push({
      titulo: 'La base no respondió',
      ok: false,
      detalle:
        `${rpc} falló: ${mensajeDe(err)}. Con un link real esta pantalla diría «el link no es ` +
        'válido», que es el mismo síntoma y no distingue una credencial vencida de una base ' +
        'inalcanzable. Revisá la service key y los permisos de la función.',
    })
    return { ok: false, pasos }
  }
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
