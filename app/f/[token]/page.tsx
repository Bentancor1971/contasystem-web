/**
 * /f/[token] — Pantalla PÚBLICA donde un socio edita su propia ficha.
 *
 * Es `/f/` de *ficha*: el prefijo de una letra es la convención del repo
 * (`/e` evento, `/v` votar, `/a` entrada, `/c` certificado, `/p` postularse).
 *
 * Mismo circuito que `/v/[token]` y `/p/[token]` —token personal como
 * identidad, segundo factor, mismos estados de error— con una diferencia
 * central: la web NUNCA escribe socios_datos. Lo que la persona edita entra
 * como PROPUESTA en ficha_cambios_remoto y el desktop la revisa y la aplica
 * (o no) campo por campo. Ver docs/supabase/66_ficha_web.sql del repo desktop.
 *
 * Lo que NO se muestra nunca antes del segundo factor: ningún dato personal.
 * Acá el factor es SIEMPRE obligatorio —a diferencia de elecciones no existe
 * el caso "sin factor"— porque el premio es la ficha completa de una persona,
 * y un mail reenviado no puede ser una filtración. Antes del factor sólo se ve
 * `nombre_visible` ("María P."), lo justo para confirmar que el link es suyo.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarCredencialFicha } from '@/lib/ficha'
import { esError, tokenValido } from '@/lib/ficha-types'
import { ipDeHeaders, LIMITES, permitidoPorIp } from '@/lib/rate-limit'
import { FichaForm } from './FichaForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Mi ficha',
  // Un link personal no se indexa. Y `no-referrer` evita que el token viaje en
  // el header Referer si algún día la página carga un recurso externo.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// ── Piezas de la pantalla ───────────────────────────────────────────────────

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-10 sm:py-14">
        {children}
        <footer className="font-mono text-[11px] text-ink-3 mt-14">
          CONTASYSTEM · FICHA DE SOCIO
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

/** Pantalla completa sin saludo: link roto o tope por IP. */
function Cortada({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <Marco>
      <div className="rise">
        <span className="label-mono">Ficha de socio</span>
        <div className="mt-6">
          <Aviso titulo={titulo} detalle={detalle} tono="alto" />
        </div>
      </div>
    </Marco>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

export default async function FichaPage({
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

  // Tope por IP. El token es inadivinable, pero los N dígitos del segundo
  // factor son pocas combinaciones: esto encarece al que prueba muchas
  // credenciales. El bloqueo de verdad (5 fallos → 15 min) lo lleva Postgres.
  const ip = ipDeHeaders(await headers())
  if (!(await permitidoPorIp(admin, ip, LIMITES.fichaVer))) {
    return (
      <Cortada
        titulo="Demasiados intentos"
        detalle="Esperá un momento y volvé a abrir el link de tu mail."
      />
    )
  }

  const estado = await buscarCredencialFicha(admin, token)
  if (esError(estado)) return <Cortada {...LINK_INVALIDO} />

  // Qué impide seguir, si algo lo impide. Se resuelve acá, en el servidor:
  // llega en el HTML de la primera respuesta, sin esperar al JavaScript.
  const impedimento = !estado.habilitado
    ? {
        titulo: 'Este link fue dado de baja',
        detalle:
          'Ya no permite editar la ficha. Si creés que es un error, comunicate con tu asociación.',
      }
    : estado.bloqueado
      ? {
          titulo: 'Demasiados intentos',
          detalle:
            'Por seguridad, este acceso quedó bloqueado unos minutos. Esperá y volvé a abrir el link.',
        }
      : null

  return (
    <Marco>
      <header className="rise mb-8">
        <span className="label-mono">Ficha de socio</span>
        <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mt-3 mb-4">
          {impedimento ? 'Tu ficha' : `Hola, ${estado.nombre_visible}`}
        </h1>
        {!impedimento && (
          <p className="text-ink-2 text-[17px] leading-relaxed">
            Desde acá podés revisar los datos de tu ficha y proponer cambios. Los cambios
            los revisa y aplica la asociación: no se aplican en el momento.
          </p>
        )}
        <div className="perforated mt-8" />
      </header>

      {impedimento ? (
        <div className="rise">
          <Aviso titulo={impedimento.titulo} detalle={impedimento.detalle} tono="alto" />
        </div>
      ) : (
        <>
          {estado.cambio_pendiente && (
            <div className="rise mb-6">
              <Aviso
                tono="medio"
                titulo="Ya enviaste cambios"
                detalle="Están esperando revisión de la asociación. Si volvés a enviar, los nuevos reemplazan a los anteriores."
              />
            </div>
          )}
          <FichaForm
            token={token}
            modoFactor={estado.modo_factor}
            verificacionDigitos={estado.verificacion_digitos}
          />
        </>
      )}
    </Marco>
  )
}
