/**
 * `/mesa/recuento` — cerrar la urna. Sólo con PIN de presidente.
 *
 * Se resuelve en el servidor porque son tres lecturas de una sola vez —boleta,
 * recuento ya cargado y control— y ninguna necesita refrescarse sola: la
 * pantalla la abre una persona, al final del día, para cargar números.
 *
 * El `es_presidente` de la cookie decide si se DIBUJA la pantalla. Quién puede
 * guardar y cerrar lo decide la base, en cada llamada, con la sesión: falsear
 * la cookie muestra el formulario y no habilita nada.
 */

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { mesaBoleta, mesaControl, mesaRecuentoActual } from '@/lib/mesa'
import { leerInfoMesa, leerSesionMesa } from '@/lib/mesa-sesion'
import { esErrorMesa } from '@/lib/mesa-types'
import { BarraMesa, Aviso, Marco } from '../Marco'
import { BotonSalir } from '../LoginMesa'
import { Recuento } from './Recuento'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function RecuentoPage() {
  const [sesion, info] = await Promise.all([leerSesionMesa(), leerInfoMesa()])
  if (!sesion || !info) redirect('/mesa')

  const marco = (children: React.ReactNode) => (
    <Marco>
      <BarraMesa
        mesa={info.mesa}
        sede={info.sede}
        eleccion={info.eleccion}
        esPresidente={info.es_presidente}
        derecha={<BotonSalir />}
      />
      {children}
    </Marco>
  )

  if (!info.es_presidente) {
    return marco(
      <Aviso
        titulo="Hace falta el PIN de presidente"
        detalle="El recuento y el cierre de la urna sólo se cargan con ese PIN. Este puesto entró con el de operación."
        tono="medio"
      >
        <a href="/mesa/padron" className="btn-secondary w-full mt-4 inline-block text-center">
          Volver al padrón
        </a>
      </Aviso>,
    )
  }

  const admin = createAdminClient()
  const [boleta, control, guardado] = await Promise.all([
    mesaBoleta(admin, sesion),
    mesaControl(admin, sesion),
    mesaRecuentoActual(admin, sesion),
  ])

  // Cualquiera de las tres puede venir con la sesión vencida. Se ofrece volver a
  // entrar en vez de redirigir solo: con la cookie todavía puesta, un redirect a
  // /mesa y de vuelta acá sería un rebote sin explicación.
  if (esErrorMesa(boleta) || esErrorMesa(control) || esErrorMesa(guardado)) {
    return marco(
      <Aviso
        titulo="La sesión de la mesa venció"
        detalle="Volvé a entrar con el código y el PIN de presidente. Lo que ya se marcó está guardado."
        tono="alto"
      >
        <div className="mt-4">
          <BotonSalir etiqueta="Volver a entrar" />
        </div>
      </Aviso>,
    )
  }

  return marco(
    <>
      {guardado.cargado_at && (
        <p className="text-ink-3 text-[13px] mb-4">
          Ya hay un recuento cargado. Lo que se guarde acá lo reemplaza entero.
        </p>
      )}
      <Recuento
        papeletas={boleta.papeletas}
        controlInicial={control}
        filasIniciales={guardado.filas}
      />
    </>,
  )
}
