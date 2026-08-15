/**
 * `/v/mesa` — la terminal de mesa: la tablet que se deja en el local para que la
 * persona marque su boleta sola.
 *
 * Es el cuarto secreto. La otra forma de votar en el local —la mesa del
 * desktop— tiene un problema que no se arregla del lado del desktop: la boleta
 * se marca en la pantalla del operador, y el fiscal ve lo que la persona vota.
 * Acá el operador identifica con la cédula física contra el padrón, entrega el
 * código impreso, y la persona vota sin nadie mirando.
 *
 * Esta ruta ENVUELVE el flujo de voto que ya existe; no lo reemplaza. `/v`,
 * `/v/{token}` y `emitir_voto` no se tocan. Lo que cambia es quién la abre (una
 * llave que genera el desktop), qué pasa al terminar (vuelve sola al inicio) y
 * qué pasa si el votante se va por la mitad (se descarta todo).
 *
 * Requiere `46_voto_kiosco.sql` aplicado en la base de la web.
 *
 * ⚠️ El nombre estático `mesa` gana sobre `[token]` en el App Router, así que
 * esta ruta no le saca ningún link personal a nadie: un token no puede valer
 * literalmente "mesa".
 */

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerSesionKiosco, terminalVigente } from '@/lib/kiosco'
import { MontarTerminal } from './MontarTerminal'
import { Terminal } from './Terminal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Terminal de mesa',
  // Nada de esto se indexa, y ninguna URL de acá tiene por qué viajar en un
  // header Referer. Mismo criterio que `/v/{token}` y `/mesa`.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function TerminalMesaPage() {
  const sesion = await leerSesionKiosco()

  // La sesión se revalida contra la nube en cada carga, igual que en cada
  // llamada de la API: es el camino por el que "Regenerar" y "Cerrar terminal"
  // del desktop tumban una tablet que está en otro edificio.
  let vigente = false
  if (sesion) {
    try {
      vigente = await terminalVigente(createAdminClient(), sesion)
    } catch {
      // Sin cliente admin no hay votación posible; se muestra el montaje, que
      // es la pantalla que puede explicar qué pasa en vez de fingir que anda.
      vigente = false
    }
  }

  if (sesion && vigente) {
    return (
      <Terminal
        info={{
          eleccion_id: sesion.eleccion_id,
          eleccion: sesion.eleccion,
          terminal: sesion.terminal,
        }}
      />
    )
  }

  // Con cookie pero sin vigencia, la terminal se cayó sola: la llave se
  // regeneró, la cerraron, o el acto terminó. El operador tiene que enterarse
  // de eso y no de un "escribí la llave" a secas.
  return <MontarTerminal caida={!!sesion} />
}
