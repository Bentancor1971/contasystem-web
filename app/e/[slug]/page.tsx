/**
 * /e/[slug] — Página PÚBLICA de un evento **o de una elección**.
 *
 * Server Component: resuelve el slug con service_role y entrega el payload
 * público. Esta ruta está fuera del grupo (app) y declarada como pública en el
 * middleware.
 *
 * ⚠️ Un solo path para dos entidades. El desktop compone los dos links como
 * `{base}/e/{slug}` y los slugs tienen la misma forma —`nombre-normalizado` más
 * los 8 primeros caracteres del id—, así que no chocan entre sí pero tampoco se
 * distinguen mirándolos. Se resuelve por orden: evento primero (es el caso con
 * mucho más tráfico), elección después, 404 si ninguno.
 *
 * No se separó en `/el/{slug}` para no invalidar los links de elecciones ya
 * repartidos ni tener dos prefijos que explicar.
 */

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEventoPublico } from '@/lib/eventos'
import { eleccionPublica } from '@/lib/elecciones'
import { sanitizeHtml } from '@/lib/sanitize-html'
import { EleccionPublicaPage, metadataEleccion } from './EleccionPublica'
import { EventoForm } from './EventoForm'

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
    const eleccion = await eleccionPublica(admin, slug)
    if (eleccion) return metadataEleccion(eleccion)
  } catch {
    /* ignora — cae al default */
  }
  return { title: 'Inscripción a evento' }
}

/**
 * Barra de cupo: banda cualitativa + color. El relleno es por banda (uno de 3
 * anchos), NO el % exacto: la barra da la señal de urgencia sin filtrar el
 * conteo real. Ver EventoPublico.ocupacion_nivel para el racional de privacidad.
 */
const BARRA_CUPO = {
  baja:  { texto: 'Cupos disponibles', fill: '34%', texto_cls: 'text-status-ok',   barra_cls: 'bg-status-ok' },
  media: { texto: 'Últimos cupos',     fill: '70%', texto_cls: 'text-status-warn', barra_cls: 'bg-status-warn' },
  alta:  { texto: 'Casi completo',     fill: '92%', texto_cls: 'text-status-no',   barra_cls: 'bg-status-no' },
} as const

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

function formatFechaLarga(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} de ${MESES[m - 1]} de ${y}`
}

/**
 * Período "del X al Y", sin repetir lo que las dos puntas comparten: dentro del
 * mismo mes queda "del 24 al 27 de agosto de 2026", y cruzando el mes o el año
 * se repite sólo la parte que cambia. Devuelve null si no hay dos fechas
 * distintas que mostrar — ahí el llamador cae a la fecha sola.
 */
function formatPeriodoLargo(desdeIso: string | null, hastaIso: string | null): string | null {
  if (!desdeIso || !hastaIso || desdeIso >= hastaIso) return null
  const [y1, m1, d1] = desdeIso.split('-').map(Number)
  const [y2, m2, d2] = hastaIso.split('-').map(Number)
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null
  if (y1 !== y2) return `del ${d1} de ${MESES[m1 - 1]} de ${y1} al ${d2} de ${MESES[m2 - 1]} de ${y2}`
  if (m1 !== m2) return `del ${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]} de ${y2}`
  return `del ${d1} al ${d2} de ${MESES[m2 - 1]} de ${y2}`
}

export default async function EventoPublicoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ pago?: string }>
}) {
  const { slug } = await params
  // ?pago=1 — link del mail de preinscripción: abre directo el registro de pago.
  const { pago } = await searchParams
  const admin = createAdminClient()
  const evento = await loadEventoPublico(admin, slug)
  if (!evento) {
    // Segunda rama: el slug puede ser de una elección publicada. Una elección en
    // borrador da el mismo 404 que un slug inventado — distinguirlas confirmaría
    // que la institución tiene una elección a medio armar.
    const eleccion = await eleccionPublica(admin, slug)
    if (eleccion) return <EleccionPublicaPage pagina={eleccion} />
    notFound()
  }

  // En un evento "solo sorteo" no hay una fecha a la que ir: lo que importa es
  // hasta cuándo se puede entrar al sorteo, y eso es el período del evento. La
  // fecha de inicio sola era el día en que se abrió el formulario.
  const periodoRegistro = evento.solo_sorteo
    ? formatPeriodoLargo(evento.fecha, evento.fecha_fin)
    : null
  const fecha = periodoRegistro ?? formatFechaLarga(evento.fecha)
  const htmlEncabezado = sanitizeHtml(evento.config.pagina_html_encabezado)
  const htmlPie = sanitizeHtml(evento.config.pagina_html_pie)
  // Leyendas propias del formulario. Se sanean acá (server) igual que el resto
  // del HTML de config: al form llegan listas para inyectar. '' = sin leyenda
  // propia, y el formulario usa su texto por defecto.
  const leyendas = {
    socio: sanitizeHtml(evento.config.leyenda_socio),
    no_socio: sanitizeHtml(evento.config.leyenda_no_socio),
    datos_ficha: sanitizeHtml(evento.config.leyenda_datos_ficha),
    sorteo: sanitizeHtml(evento.config.leyenda_sorteo),
  }

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
            {fecha && <div>📅 {periodoRegistro ? `Registros ${periodoRegistro}` : fecha}</div>}
            {evento.lugar && <div>📍 {evento.lugar}</div>}
          </div>
          {/* Barra de cupo — sólo con evento abierto y cupo definido. */}
          {evento.abierto && evento.ocupacion_nivel && (
            <div className="mt-5 max-w-[16rem]">
              <span
                className={`block mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] font-medium ${BARRA_CUPO[evento.ocupacion_nivel].texto_cls}`}
              >
                {BARRA_CUPO[evento.ocupacion_nivel].texto}
              </span>
              <div
                className="h-2 rounded-full bg-paper-3 overflow-hidden"
                role="progressbar"
                aria-label="Ocupación del cupo"
              >
                <div
                  className={`h-full rounded-full transition-all ${BARRA_CUPO[evento.ocupacion_nivel].barra_cls}`}
                  style={{ width: BARRA_CUPO[evento.ocupacion_nivel].fill }}
                />
              </div>
            </div>
          )}
          {/* Los dos textos de la institución se van juntos con las
              inscripciones cerradas, misma regla que en votación y convocatoria:
              queda el nombre, la fecha, el lugar y el cartel de estado.

              `texto_antes` es, encima, el texto de INVITACIÓN del mail ("Nos
              gustaría invitarte a participar de X. ¡Esperamos contar con tu
              presencia!"), y quedaba justo arriba del cartel que dice que ya no
              se puede entrar.

              Fecha y lugar SÍ se quedan: son los datos que busca quien abre el
              link viejo para saber si llegó tarde o se equivocó de evento. */}
          {evento.abierto && (
            <>
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
            </>
          )}
          <div className="perforated mt-8" />
        </header>

        {/* Declarar el pago de una preinscripción vive DENTRO del formulario: se
            ofrece al verificar la cédula, sólo a quien tiene una preinscripción
            impaga (ver EventoForm). En la portada era ruido para todos los demás. */}
        <EventoForm evento={evento} leyendas={leyendas} abrirRegistrarPago={pago === '1'} />

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
