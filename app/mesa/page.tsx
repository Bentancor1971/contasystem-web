/**
 * `/mesa` — entrar al puesto.
 *
 * Pantalla pública: no hay usuario del sistema detrás de una mesa. Lo que
 * autentica es el código impreso en la planilla más el PIN que se dicta aparte,
 * los dos generados por el desktop (src/routes/elecciones/mesas.tsx).
 *
 * Si el dispositivo ya tiene una sesión, se ofrece continuar en vez de
 * redirigir solo: una sesión vencida en la base pero con cookie viva haría un
 * rebote entre esta pantalla y el padrón, y en un local con mala conexión eso
 * es indistinguible de un sitio roto.
 */

import { leerInfoMesa } from '@/lib/mesa-sesion'
import { Marco } from './Marco'
import { BotonSalir, LoginMesa } from './LoginMesa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function MesaLoginPage() {
  const info = await leerInfoMesa()

  return (
    <Marco ancho="sm">
      <div className="rise">
        <span className="label-mono">Mesa de votación</span>
        <h1 className="font-display text-3xl sm:text-4xl font-medium leading-[1.05] mt-3 mb-6">
          Entrar al puesto
        </h1>

        {info && (
          <div className="card p-4 mb-6 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">{info.mesa}</p>
              <p className="text-ink-3 text-sm truncate">{info.eleccion}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a href="/mesa/padron" className="btn-secondary text-sm">
                Continuar
              </a>
              <BotonSalir />
            </div>
          </div>
        )}

        <LoginMesa />
      </div>
    </Marco>
  )
}
