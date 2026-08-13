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
 * Esta página no consulta la base: no sabe de qué elección se trata hasta que
 * alguien escribe un código. Por eso no puede mostrar el mail de contacto de una
 * elección puntual — el que aparece en los errores sale del canje.
 */

import type { Metadata } from 'next'
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

export default function EntradaPorCodigoPage() {
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-10 sm:py-14">
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

        <footer className="font-mono text-[11px] text-ink-3 mt-14">
          CONTASYSTEM · VOTACIÓN
        </footer>
      </div>
    </main>
  )
}
