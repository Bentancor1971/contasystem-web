/**
 * /v — Entrada por código de credencial.
 *
 * La otra puerta a la votación, para quien recibió la credencial impresa en vez
 * de por mail. Con el código resuelto se redirige a `/v/{token}`, donde sigue el
 * circuito de siempre: **el segundo factor se pide igual**.
 *
 * No hay puerta por cédula acá ni en ningún lado. "Poné tu documento y te digo
 * si estás habilitado" convertiría el sitio en un oráculo de quién es socio de
 * la institución, que es lo que ordena todo el diseño del módulo.
 *
 * Esta página no sabe de qué elección se trata hasta que alguien escribe un
 * código. Por eso no puede mostrar el mail de contacto de una elección puntual —
 * el que aparece en los errores sale del canje.
 *
 * Lo único que mira antes es si hay ALGUNA votación en curso (26/10/2026): con
 * todo cerrado seguía pidiendo el código como si se pudiera votar. Ver
 * `estadoEntradaPorCodigo`.
 */

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { estadoEntradaPorCodigo } from '@/lib/elecciones'
import { CodigoForm } from './CodigoForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Votar con mi código',
  // Sin indexar: no aporta nada a quien no tiene una credencial en la mano, y el
  // buscador no tiene por qué ofrecer un formulario de canje.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function EntradaPorCodigoPage() {
  const entrada = await estadoEntradaPorCodigo(createAdminClient())

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-10 sm:py-14">
        {entrada === 'vigente' ? (
          <>
            <header className="rise mb-8">
              <span className="label-mono">Votación</span>
              <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mt-3 mb-4">
                Entrá con tu código
              </h1>
              <p className="text-ink-2 text-[17px] leading-relaxed">
                Si te entregaron la credencial en papel, escribí acá el código que figura en ella.
              </p>
            </header>

            <section className="card p-6 sm:p-7">
              <CodigoForm contacto={null} />
            </section>

            <p className="text-ink-3 text-sm leading-relaxed mt-8">
              ¿Recibiste la credencial por mail? No hace falta el código: entrá directamente con el
              link personal que te llegó.
            </p>
          </>
        ) : (
          <>
            <header className="rise mb-8">
              <span className="label-mono">Votación</span>
              <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mt-3">
                {entrada === 'solo_local' ? 'El voto por internet cerró' : 'No hay una votación en curso'}
              </h1>
            </header>

            {/* Mismo criterio que `cerrada_web` en /v/{token}: si todavía se
                vota en el local, lo primero que se lee es que se puede votar. */}
            <div className={`voto-aviso ${entrada === 'solo_local' ? 'voto-aviso--medio' : ''} rise`}>
              <p className="text-ink-2 text-[17px] leading-relaxed">
                {entrada === 'solo_local'
                  ? 'La votación sigue abierta, pero ahora se vota en el local, en persona. Llevá tu documento y la credencial.'
                  : 'No hay ninguna votación abierta en este momento. Si tu credencial es de una votación que todavía no empezó, volvé a esta página cuando abra.'}
              </p>
            </div>
          </>
        )}

        <footer className="font-mono text-[11px] text-ink-3 mt-14">
          CONTASYSTEM · VOTACIÓN
        </footer>
      </div>
    </main>
  )
}
