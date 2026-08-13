/**
 * /v/[token] — Pantalla PÚBLICA de votación.
 *
 * Es `/v/` y no `/e/` porque `/e/{slug}` ya es la inscripción a eventos y
 * `/a/{token}` el escáner de asistencia.
 *
 * El token de la URL ES la identidad: no hay login ni contraseña. Por eso esta
 * pantalla, que se resuelve entera en el servidor con la service key:
 *
 *   · muestra el instructivo COMPLETO —es donde la institución avisa que el
 *     voto es nominal, y quien vota tiene derecho a saberlo antes de votar—;
 *   · NO muestra el nombre del votante ni la boleta hasta que el segundo factor
 *     validó: un mail reenviado no puede filtrar datos de quien ni votó;
 *   · no ofrece seguir si la credencial ya votó, fue dada de baja, está
 *     bloqueada, o la ventana horaria no está abierta.
 *
 * No hay pantalla de resultados en ninguna parte de la web: el conteo sale del
 * desktop, del acta.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarCredencial, validarCredencial } from '@/lib/elecciones'
import {
  esError,
  fechaHoraCorta,
  mensajeDeError,
  tokenValido,
  type BoletaValidada,
  type EleccionPublica,
  type VentanaEleccion,
} from '@/lib/elecciones-types'
import { ipDeHeaders, LIMITES, permitidoPorIp } from '@/lib/rate-limit'
import { Votacion } from './Votacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Votación',
  // Un link personal de votación no se indexa. Y `no-referrer` evita que el
  // token se filtre por el header Referer al pedir la imagen de la elección,
  // que puede estar alojada en otro dominio.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// ── Piezas de la pantalla ───────────────────────────────────────────────────

/** Motivo por el que la pantalla no ofrece votar. */
interface Impedimento {
  titulo: string
  detalle: string
  tono: 'ok' | 'medio' | 'alto'
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-10 sm:py-14">
        {children}
        <footer className="font-mono text-[11px] text-ink-3 mt-14">
          CONTASYSTEM · VOTACIÓN
        </footer>
      </div>
    </main>
  )
}

function Aviso({
  titulo,
  detalle,
  tono = 'medio',
}: {
  titulo: string
  detalle: string
  tono?: 'ok' | 'medio' | 'alto'
}) {
  return (
    <div className={`voto-aviso voto-aviso--${tono}`} role="status">
      <h2 className="font-display text-2xl font-medium leading-tight mb-2">{titulo}</h2>
      <p className="text-ink-2 text-[17px] leading-relaxed">{detalle}</p>
    </div>
  )
}

/** Pantalla completa sin datos de elección: link roto o tope por IP. */
function Cortada({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <Marco>
      <div className="rise">
        <span className="label-mono">Votación</span>
        <div className="mt-6">
          <Aviso titulo={titulo} detalle={detalle} tono="alto" />
        </div>
      </div>
    </Marco>
  )
}

/**
 * `ventana` y no `estado`: desde 43_publicacion_eleccion.sql la elección se
 * publica al congelar el padrón, así que una credencial abierta antes de la
 * apertura llega con `estado: 'padron'`. Mirando el estado, esa persona leía
 * "Votación cerrada" el día antes de votar.
 *
 * La regla del módulo es que `ventana` es el único campo que decide: lo resuelve
 * Postgres contra su propio reloj, no el del visitante.
 */
function Encabezado({ eleccion, ventana }: { eleccion: EleccionPublica; ventana: VentanaEleccion }) {
  return (
    <header className="rise mb-8">
      <span className="label-mono">Votación</span>
      <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mt-3 mb-4">
        {eleccion.nombre}
      </h1>
      {eleccion.imagen_url && (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa cargada por el desktop
        <img
          src={eleccion.imagen_url}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-auto rounded-xl border border-line mb-5"
        />
      )}
      <p className="font-mono text-sm text-ink-2">
        {ventana === 'abierta'
          ? `Se puede votar hasta el ${fechaHoraCorta(eleccion.fecha_cierre)}`
          : ventana === 'no_abierta'
            ? `La votación abre el ${fechaHoraCorta(eleccion.fecha_apertura)}`
            : 'Votación cerrada'}
      </p>
      {eleccion.descripcion && (
        <p className="text-ink-2 mt-5 text-[17px] leading-relaxed whitespace-pre-line">
          {eleccion.descripcion}
        </p>
      )}
      {eleccion.texto_antes && (
        <p className="text-ink-2 mt-3 text-[17px] leading-relaxed whitespace-pre-line">
          {eleccion.texto_antes}
        </p>
      )}
      <div className="perforated mt-8" />
    </header>
  )
}

/** El instructivo va entero, sin recortar ni plegar. */
function Instructivo({ texto }: { texto: string }) {
  return (
    <section className="card p-6 mb-8" aria-labelledby="instructivo-titulo">
      <h2 id="instructivo-titulo" className="label-mono mb-3">
        Antes de votar
      </h2>
      <p className="text-[17px] leading-relaxed whitespace-pre-line">{texto}</p>
    </section>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

export default async function VotacionPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const LINK_INVALIDO = {
    titulo: 'El link no es válido',
    detalle: 'Revisá que hayas abierto el link completo tal como llegó al mail.',
  }

  if (!tokenValido(token)) return <Cortada {...LINK_INVALIDO} />

  const admin = createAdminClient()

  // Tope por IP. El token es inadivinable, pero los N dígitos del segundo factor
  // son pocas combinaciones: esto encarece al que prueba muchas credenciales.
  const ip = ipDeHeaders(await headers())
  if (!(await permitidoPorIp(admin, ip, LIMITES.votoVer))) {
    return (
      <Cortada
        titulo="Demasiados intentos"
        detalle="Esperá un momento y volvé a abrir el link de tu mail."
      />
    )
  }

  const estado = await buscarCredencial(admin, token)
  // `credencial_inexistente` y `eleccion_inexistente` se responden igual: sin
  // decir cuál de las dos cosas pasó.
  if (esError(estado)) return <Cortada {...LINK_INVALIDO} />

  const { eleccion } = estado
  const contacto = eleccion.email_contacto
  const escribinos = contacto ? ` Si creés que es un error, escribinos a ${contacto}.` : ''

  // Qué impide votar, si algo lo impide. El orden importa: "ya votaste" es más
  // informativo que "la votación cerró" para quien votó y vuelve a entrar.
  const impedimento: Impedimento | null =
    estado.ya_voto
      ? {
          titulo: 'Ya votaste',
          detalle:
            'Tu voto está registrado y no se puede votar dos veces. La constancia te llega por mail.',
          tono: 'ok',
        }
      : !estado.habilitado
        ? {
            titulo: 'Esta credencial fue dada de baja',
            detalle: `Ya no habilita a votar.${escribinos}`,
            tono: 'alto',
          }
        : estado.ventana === 'no_abierta'
          ? {
              titulo: 'La votación todavía no está abierta',
              detalle: `Abre el ${fechaHoraCorta(eleccion.fecha_apertura)}. Volvé a entrar con este mismo link.`,
              tono: 'medio',
            }
          : estado.ventana === 'cerrada'
            ? {
                titulo: 'La votación está cerrada',
                detalle: `Cerró el ${fechaHoraCorta(eleccion.fecha_cierre)} y ya no se pueden emitir votos.${escribinos}`,
                tono: 'alto',
              }
            : estado.bloqueado
              ? {
                  titulo: 'Demasiados intentos',
                  detalle:
                    'Por seguridad, esta credencial quedó bloqueada unos minutos. Esperá y volvé a abrir el link.',
                  tono: 'alto',
                }
              : null

  // Sin segundo factor la boleta se resuelve acá, en el servidor: llega en el
  // HTML de la primera respuesta y se lee aunque el JavaScript no corra.
  let boletaInicial: BoletaValidada | null = null
  let errorBoleta: Impedimento | null = null
  if (!impedimento && estado.verificacion_digitos === 0) {
    const r = await validarCredencial(admin, token, '')
    if (esError(r)) {
      const m = mensajeDeError(r, contacto)
      errorBoleta = { titulo: m.titulo, detalle: m.detalle, tono: 'alto' }
    } else {
      boletaInicial = r
    }
  }

  const bloqueada = impedimento ?? errorBoleta

  return (
    <Marco>
      <Encabezado eleccion={eleccion} ventana={estado.ventana} />

      {bloqueada ? (
        <>
          <div className="mb-8">
            <Aviso titulo={bloqueada.titulo} detalle={bloqueada.detalle} tono={bloqueada.tono} />
          </div>
          {eleccion.instructivo && <Instructivo texto={eleccion.instructivo} />}
        </>
      ) : (
        <>
          {eleccion.instructivo && <Instructivo texto={eleccion.instructivo} />}
          <Votacion
            token={token}
            verificacionDigitos={estado.verificacion_digitos}
            emailContacto={contacto}
            textoDespues={eleccion.texto_despues}
            boletaInicial={boletaInicial}
          />
        </>
      )}
    </Marco>
  )
}
