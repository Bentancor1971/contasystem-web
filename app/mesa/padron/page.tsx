/**
 * `/mesa/padron` — la pantalla del día.
 *
 * El Server Component sólo resuelve la identidad del puesto (de la cookie) y
 * dibuja el marco: el padrón lo pide el cliente, porque después de la carga
 * inicial vive de deltas cada 12 segundos y eso no se hace desde el servidor.
 *
 * Sin cookie no hay nada que mostrar y se va a `/mesa`. Que la sesión de la
 * base siga viva o no lo resuelve la primera llamada al padrón: si venció, la
 * pantalla lo dice y ofrece volver a entrar, en vez de rebotar sola.
 */

import { redirect } from 'next/navigation'
import { leerInfoMesa, leerSesionMesa } from '@/lib/mesa-sesion'
import { BarraMesa, Marco } from '../Marco'
import { BotonSalir } from '../LoginMesa'
import { Padron } from './Padron'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function PadronPage() {
  const [sesion, info] = await Promise.all([leerSesionMesa(), leerInfoMesa()])
  if (!sesion || !info) redirect('/mesa')

  const tramo =
    info.tramo_desde || info.tramo_hasta
      ? `Atiende ${info.tramo_desde ?? 'inicio'} – ${info.tramo_hasta ?? 'fin'}`
      : null

  return (
    <Marco ancho="3xl">
      <BarraMesa
        mesa={info.mesa}
        sede={info.sede}
        eleccion={info.eleccion}
        esPresidente={info.es_presidente}
        derecha={<BotonSalir />}
      />
      {tramo && <p className="font-mono text-[13px] text-ink-3 -mt-3 mb-4">{tramo}</p>}

      <Padron mesaId={info.mesa_id} esPresidente={info.es_presidente} />
    </Marco>
  )
}
