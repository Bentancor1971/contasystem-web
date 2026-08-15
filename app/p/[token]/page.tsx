/**
 * /p/[token] — Pantalla PÚBLICA para anotarse en una convocatoria.
 *
 * Es `/p/` y no `/c/`: `/c/{token}` ya es la validación pública de certificados.
 * El prefijo de una letra es la convención del repo (`/e` evento, `/v` votar,
 * `/a` entrada, `/c` certificado), y `/p` es de *postularse*.
 *
 * Muy parecida a `/v/[token]` —mismo token-como-identidad, mismo segundo factor,
 * mismos estados de error— pero mucho más simple: no hay boleta que dibujar.
 *
 * Lo que la persona declara es UNA sola cosa: «me interesa integrar la lista».
 * No elige lista, ni cargo, ni compañeros; eso se acuerda después, en una
 * reunión. Por eso el tono de la pantalla dice con todas las letras que anotarse
 * no compromete a nada: es lo que hace que la gente se anote.
 *
 * Lo que NO se muestra nunca:
 *   · el nombre de la persona ni su deuda antes del segundo factor — acá pesa
 *     más que en votación, porque el payload incluye cuánto debe alguien y un
 *     link reenviado no puede ser la vía para que se entere el vecino;
 *   · cuántos se anotaron. Saber que ya hay diez desalienta justo al que dudaba,
 *     que es el que hace falta.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarConvocatoria, validarInvitado } from '@/lib/convocatorias'
import {
  esError,
  fechaHoraCorta,
  horaAperturaPasada,
  mensajeDeErrorPostulacion,
  tokenValido,
  type ConvocatoriaPublica,
  type InvitadoValidado,
  type VentanaConvocatoria,
} from '@/lib/convocatorias-types'
import { ipDeHeaders, LIMITES, permitidoPorIp } from '@/lib/rate-limit'
import { Postulacion } from './Postulacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Convocatoria',
  // Un link personal no se indexa. Y `no-referrer` evita que el token se filtre
  // por el header Referer al pedir la imagen de la convocatoria, que puede estar
  // alojada en otro dominio.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// ── Piezas de la pantalla ───────────────────────────────────────────────────

/** Motivo por el que la pantalla no ofrece anotarse. */
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
          CONTASYSTEM · CONVOCATORIA
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

/** Pantalla completa sin datos de la convocatoria: link roto o tope por IP. */
function Cortada({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <Marco>
      <div className="rise">
        <span className="label-mono">Convocatoria</span>
        <div className="mt-6">
          <Aviso titulo={titulo} detalle={detalle} tono="alto" />
        </div>
      </div>
    </Marco>
  )
}

/**
 * `ventana` es el único campo que decide, y lo resuelve Postgres contra su
 * propio reloj: el del dispositivo de la persona no participa nunca.
 *
 * `horaAperturaPasada` sólo elige PALABRAS: anunciar en futuro una apertura que
 * ya quedó en el pasado es la frase que termina en un llamado por teléfono.
 */
function Encabezado({
  convocatoria,
  ventana,
}: {
  convocatoria: ConvocatoriaPublica
  ventana: VentanaConvocatoria
}) {
  return (
    <header className="rise mb-8">
      <span className="label-mono">Convocatoria</span>
      <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mt-3 mb-4">
        {convocatoria.nombre}
      </h1>
      {convocatoria.imagen_url && (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa cargada por el desktop
        <img
          src={convocatoria.imagen_url}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-auto rounded-xl border border-line mb-5"
        />
      )}
      <p className="font-mono text-sm text-ink-2">
        {ventana === 'abierta'
          ? `Podés anotarte hasta el ${fechaHoraCorta(convocatoria.fecha_cierre)}`
          : ventana === 'no_abierta'
            ? horaAperturaPasada(convocatoria.fecha_apertura)
              ? `Apertura prevista: ${fechaHoraCorta(convocatoria.fecha_apertura)}`
              : `Se abre el ${fechaHoraCorta(convocatoria.fecha_apertura)}`
            : `El plazo cerró el ${fechaHoraCorta(convocatoria.fecha_cierre)}`}
      </p>
      {convocatoria.descripcion && (
        <p className="text-ink-2 mt-5 text-[17px] leading-relaxed whitespace-pre-line">
          {convocatoria.descripcion}
        </p>
      )}
      {convocatoria.cargos_descripcion && (
        <p className="text-ink-2 mt-3 text-[17px] leading-relaxed whitespace-pre-line">
          {convocatoria.cargos_descripcion}
        </p>
      )}
      {convocatoria.texto_antes && (
        <p className="text-ink-2 mt-3 text-[17px] leading-relaxed whitespace-pre-line">
          {convocatoria.texto_antes}
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
        Antes de anotarte
      </h2>
      <p className="text-[17px] leading-relaxed whitespace-pre-line">{texto}</p>
    </section>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

export default async function PostulacionPage({
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
  if (!(await permitidoPorIp(admin, ip, LIMITES.postulacionVer))) {
    return (
      <Cortada
        titulo="Demasiados intentos"
        detalle="Esperá un momento y volvé a abrir el link de tu mail."
      />
    )
  }

  const estado = await buscarConvocatoria(admin, token)
  // `credencial_inexistente` y `convocatoria_inexistente` se responden igual:
  // sin decir cuál de las dos cosas pasó.
  if (esError(estado)) return <Cortada {...LINK_INVALIDO} />

  const { convocatoria } = estado
  const contacto = convocatoria.email_contacto
  const escribinos = contacto ? ` Si creés que es un error, escribinos a ${contacto}.` : ''

  // Quien ya se anotó y vuelve a entrar con la ventana abierta ve la pantalla de
  // baja, no un cartel. Es la diferencia con el voto: una postulación se puede
  // deshacer, porque no altera ningún resultado.
  const puedeRetirarse = estado.ya_postulado && estado.ventana === 'abierta' && !estado.bloqueado

  // Qué impide anotarse, si algo lo impide. El orden importa: "ya estás anotado"
  // es más informativo que "el plazo cerró" para quien se anotó y vuelve.
  const impedimento: Impedimento | null =
    estado.ya_postulado && !puedeRetirarse
      ? {
          titulo: 'Ya estás anotado',
          detalle:
            estado.ventana === 'abierta'
              ? `Tu interés está registrado.${escribinos}`
              : `Tu interés está registrado y el plazo ya cerró. La comisión se comunica con los interesados.${escribinos}`,
          tono: 'ok',
        }
      : estado.ventana === 'no_abierta'
        ? horaAperturaPasada(convocatoria.fecha_apertura)
          ? {
              titulo: 'El llamado todavía no está abierto',
              detalle:
                `Estaba previsto para el ${fechaHoraCorta(convocatoria.fecha_apertura)} y todavía no lo ` +
                `abrieron. Volvé a entrar con este mismo link en un rato.${escribinos}`,
              tono: 'medio',
            }
          : {
              titulo: 'El llamado todavía no está abierto',
              detalle: `Se abre el ${fechaHoraCorta(convocatoria.fecha_apertura)}. Volvé a entrar con este mismo link.`,
              tono: 'medio',
            }
        : estado.ventana === 'cerrada'
          ? {
              titulo: 'El plazo para anotarse cerró',
              detalle: `Cerró el ${fechaHoraCorta(convocatoria.fecha_cierre)} y ya no se reciben postulaciones.${escribinos}`,
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

  // Sin segundo factor la situación se resuelve acá, en el servidor: llega en el
  // HTML de la primera respuesta y se lee aunque el JavaScript no corra.
  let invitadoInicial: InvitadoValidado | null = null
  let errorInvitado: Impedimento | null = null
  if (!impedimento && !puedeRetirarse && estado.verificacion_digitos === 0) {
    const r = await validarInvitado(admin, token, '')
    if (esError(r)) {
      const m = mensajeDeErrorPostulacion(r, contacto)
      errorInvitado = { titulo: m.titulo, detalle: m.detalle, tono: 'alto' }
    } else {
      invitadoInicial = r
    }
  }

  const bloqueada = impedimento ?? errorInvitado

  return (
    <Marco>
      <Encabezado convocatoria={convocatoria} ventana={estado.ventana} />

      {bloqueada ? (
        <>
          <div className="mb-8">
            <Aviso titulo={bloqueada.titulo} detalle={bloqueada.detalle} tono={bloqueada.tono} />
          </div>
          {convocatoria.instructivo && <Instructivo texto={convocatoria.instructivo} />}
        </>
      ) : (
        <>
          {convocatoria.instructivo && <Instructivo texto={convocatoria.instructivo} />}
          <Postulacion
            token={token}
            modo={puedeRetirarse ? 'retirar' : 'postular'}
            verificacionDigitos={estado.verificacion_digitos}
            emailContacto={contacto}
            textoDespues={convocatoria.texto_despues}
            invitadoInicial={invitadoInicial}
          />
        </>
      )}
    </Marco>
  )
}
