/**
 * /e/[slug] — Página PÚBLICA de inscripción a un evento.
 *
 * Server Component: resuelve el evento por slug con service_role y entrega el
 * payload público al formulario cliente. Esta ruta está fuera del grupo (app)
 * y declarada como pública en el middleware.
 */

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEventoPublico } from '@/lib/eventos'
import { sanitizeHtml } from '@/lib/sanitize-html'
import { EventoForm } from './EventoForm'
import { RegistrarPago } from './RegistrarPago'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  try {
    const admin = createAdminClient()
    const evento = await loadEventoPublico(admin, slug)
    if (evento) {
      return { title: `${evento.nombre} · Inscripción`, description: evento.descripcion ?? undefined }
    }
  } catch {
    /* ignora — cae al default */
  }
  return { title: 'Inscripción a evento' }
}

function formatFechaLarga(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return `${d} de ${meses[m - 1]} de ${y}`
}

export default async function EventoPublicoPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const admin = createAdminClient()
  const evento = await loadEventoPublico(admin, slug)
  if (!evento) notFound()

  const fecha = formatFechaLarga(evento.fecha)
  const htmlEncabezado = sanitizeHtml(evento.config.pagina_html_encabezado)
  const htmlPie = sanitizeHtml(evento.config.pagina_html_pie)

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-6 py-12 sm:py-16">
        {/* HTML propio configurado en /configuracion/eventos (encabezado). Saneado. */}
        {htmlEncabezado && (
          <div
            className="rise mb-8 evento-html"
            dangerouslySetInnerHTML={{ __html: htmlEncabezado }}
          />
        )}

        <header className="rise mb-10">
          <span className="label-mono">Inscripción</span>
          <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.0] mt-3 mb-4">
            {evento.nombre}
          </h1>
          <div className="font-mono text-sm text-ink-2 space-y-1">
            {fecha && <div>📅 {fecha}</div>}
            {evento.lugar && <div>📍 {evento.lugar}</div>}
          </div>
          {evento.descripcion && (
            <p className="text-ink-2 mt-5 text-base leading-relaxed whitespace-pre-line">
              {evento.descripcion}
            </p>
          )}
          {evento.texto_antes && (
            <p className="text-ink-2 mt-3 text-sm leading-relaxed whitespace-pre-line">
              {evento.texto_antes}
            </p>
          )}
          <div className="perforated mt-8" />
        </header>

        <EventoForm evento={evento} />

        {/* Declarar el pago de una reserva ya hecha. Sólo si el evento publica
            datos de depósito y la config permite la transferencia. */}
        {evento.abierto &&
          evento.datos_deposito &&
          evento.config.permitir_pago_transferencia && (
            <RegistrarPago slug={evento.slug} />
          )}

        {/* HTML propio configurado en /configuracion/eventos (pie). Saneado. */}
        {htmlPie && (
          <div className="mt-10 evento-html" dangerouslySetInnerHTML={{ __html: htmlPie }} />
        )}

        <footer className="font-mono text-[11px] text-ink-3 mt-16 flex justify-between">
          <span>CONTASYSTEM · EVENTOS</span>
          <span>{evento.slug}</span>
        </footer>
      </div>
    </main>
  )
}
