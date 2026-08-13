/**
 * Página PÚBLICA de una elección — la mitad de `/e/[slug]` que no es un evento.
 *
 * Es lo que la comisión reparte por WhatsApp, cartelera o Instagram. No pide
 * credencial ni identifica a nadie, así que es indexable: no hay nada acá que no
 * esté ya en la cartelera del club.
 *
 * Tres cosas que esta página NO muestra, y no por olvido (ver
 * docs/web/elecciones-publicacion.md):
 *
 *  1. **La boleta.** Ni listas, ni candidatos, ni integrantes. Eso sale recién
 *     con la credencial validada, del otro lado del segundo factor.
 *  2. **Resultados.** Ni conteo, ni participación, ni "van N votos". No existe
 *     el endpoint.
 *  3. **Una puerta por cédula.** Nada de "poné tu documento y te digo si estás
 *     habilitado": eso convierte al sitio en un oráculo de quién es socio.
 *
 * Se entra con el link personal del mail, o con el código impreso vía `/v`.
 */

import type { Metadata } from 'next'
import type { EleccionPublicaPagina } from '@/lib/elecciones-types'

/** ISO → "13/08 a las 09:00". Mismo formato que usa la pantalla de votación. */
function fechaHoraLarga(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const fmt = new Intl.DateTimeFormat('es-UY', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Montevideo',
  })
  return fmt.format(d).replace(',', ' a las')
}

export function metadataEleccion(p: EleccionPublicaPagina): Metadata {
  return {
    title: `${p.eleccion.nombre} · Votación`,
    description: p.eleccion.descripcion ?? undefined,
  }
}

/**
 * Encabezado según la ventana. Es lo primero que lee quien abre el link, así que
 * dice el estado antes que cualquier otra cosa.
 *
 * Sale de `ventana` y no de `estado`: una elección publicada al congelar el
 * padrón está en la nube pero todavía no se vota. La ventana la resuelve
 * Postgres contra su propio reloj, no el del visitante.
 */
function titularDe(p: EleccionPublicaPagina): { titulo: string; tono: string } {
  switch (p.ventana) {
    case 'no_abierta':
      return {
        titulo: `La votación abre el ${fechaHoraLarga(p.eleccion.fecha_apertura)}.`,
        tono: 'voto-aviso--medio',
      }
    case 'abierta':
      return {
        titulo: `La votación está abierta hasta el ${fechaHoraLarga(p.eleccion.fecha_cierre)}.`,
        tono: 'voto-aviso--ok',
      }
    default:
      return {
        titulo: 'La votación cerró. Los resultados los comunica la institución.',
        tono: 'voto-aviso--alto',
      }
  }
}

export function EleccionPublicaPage({ pagina }: { pagina: EleccionPublicaPagina }) {
  const e = pagina.eleccion
  const titular = titularDe(pagina)
  const cerrada = pagina.ventana === 'cerrada'

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-10 sm:py-14">
        <header className="rise mb-8">
          <span className="label-mono">Elección</span>
          <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mt-3 mb-4">
            {e.nombre}
          </h1>
          {e.imagen_url && (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa cargada por el desktop
            <img
              src={e.imagen_url}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-auto rounded-xl border border-line mb-5"
            />
          )}
          {e.descripcion && (
            <p className="text-ink-2 text-[17px] leading-relaxed whitespace-pre-line">
              {e.descripcion}
            </p>
          )}
        </header>

        <div className={`voto-aviso ${titular.tono} rise`} role="status">
          <h2 className="font-display text-2xl font-medium leading-tight">{titular.titulo}</h2>
        </div>

        {e.texto_antes && (
          <p className="rise text-ink-2 text-[17px] leading-relaxed whitespace-pre-line mt-8">
            {e.texto_antes}
          </p>
        )}

        {/* El instructivo va COMPLETO y sin plegar: es donde la persona se entera
            de que el voto es nominal, y tiene derecho a saberlo antes de votar. */}
        {e.instructivo && (
          <section className="card rise p-6 sm:p-7 mt-8">
            <span className="label-mono">Instructivo</span>
            <p className="text-ink-2 text-[17px] leading-relaxed whitespace-pre-line mt-3">
              {e.instructivo}
            </p>
          </section>
        )}

        {/* Cómo se vota: es lo que viene a buscar quien abre el link repartido.
            Se omite con la votación cerrada — ahí ya no hay nada que hacer. */}
        {!cerrada && (
          <section className="card rise p-6 sm:p-7 mt-6">
            <span className="label-mono">Cómo se vota</span>
            <p className="text-ink-2 text-[17px] leading-relaxed mt-3">
              Si figurás en el padrón vas a recibir un mail con tu <strong>link personal</strong>.
              Es la manera de entrar: ese link es tu credencial.
            </p>
            <p className="text-ink-2 text-[17px] leading-relaxed mt-3">
              Si te entregaron la credencial en mano, tenés un código de 10 caracteres.
            </p>
            <a href="/v" className="btn-primary mt-5 inline-block">
              Entrar con mi código
            </a>
            {pagina.verificacion_digitos > 0 && (
              <p className="text-ink-3 text-sm leading-relaxed mt-4">
                En los dos casos se te van a pedir los últimos {pagina.verificacion_digitos} dígitos
                de tu cédula, para confirmar que sos vos.
              </p>
            )}
          </section>
        )}

        {e.email_contacto && (
          <p className="text-ink-3 text-sm leading-relaxed mt-8">
            ¿No te llegó el mail, o creés que tu situación en el padrón no es correcta? Escribinos
            a <a className="underline" href={`mailto:${e.email_contacto}`}>{e.email_contacto}</a>.
          </p>
        )}

        <footer className="font-mono text-[11px] text-ink-3 mt-14">
          CONTASYSTEM · VOTACIÓN
        </footer>
      </div>
    </main>
  )
}
