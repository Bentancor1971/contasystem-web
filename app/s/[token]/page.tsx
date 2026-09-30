/**
 * /s/[token] — el favorecido de un sorteo confirma o rechaza su cupo.
 *
 * Es `/s/` de *sorteo*: el prefijo de una letra es la convención del repo
 * (`/e` evento, `/v` votar, `/f` ficha…). Llega desde los botones "Confirmar
 * cupo" / "Rechazar cupo" del mail; `?r=` sólo preselecciona qué se le
 * pregunta. Responder exige un clic acá (POST): un GET nunca cambia nada,
 * porque los antivirus de correo abren los links solos.
 *
 * Sin segundo factor: se ve "Nombre I.", el premio y el número, y lo único
 * que se puede hacer es aceptar o rechazar un cupo propio. Ver
 * docs/supabase/72_sorteos_confirmacion.sql del repo desktop.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarConfirmacionSorteo } from '@/lib/sorteo-confirmacion'
import { esError, fechaLarga, motivoCerrado, tokenValido } from '@/lib/sorteo-confirmacion-types'
import { ipDeHeaders, LIMITES, permitidoPorIp } from '@/lib/rate-limit'
import { ConfirmarCupo } from './ConfirmarCupo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Tu cupo',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-10 sm:py-14">
        {children}
        <footer className="font-mono text-[11px] text-ink-3 mt-14">
          CONTASYSTEM · SORTEO
        </footer>
      </div>
    </main>
  )
}

function Aviso({ titulo, detalle, tono }: { titulo: string; detalle: string; tono: 'ok' | 'medio' | 'alto' }) {
  return (
    <div className={`voto-aviso voto-aviso--${tono}`} role="status">
      <h2 className="font-display text-2xl font-medium leading-tight mb-2">{titulo}</h2>
      <p className="text-ink-2 text-[17px] leading-relaxed">{detalle}</p>
    </div>
  )
}

function Cortada({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <Marco>
      <div className="rise">
        <span className="label-mono">Sorteo</span>
        <div className="mt-6">
          <Aviso titulo={titulo} detalle={detalle} tono="alto" />
        </div>
      </div>
    </Marco>
  )
}

export default async function ConfirmacionSorteoPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ r?: string }>
}) {
  const { token } = await params
  const { r } = await searchParams

  const LINK_INVALIDO = {
    titulo: 'El link no es válido',
    detalle: 'Revisá que hayas abierto el link completo tal como llegó al mail.',
  }
  if (!tokenValido(token)) return <Cortada {...LINK_INVALIDO} />

  const admin = createAdminClient()
  const ip = ipDeHeaders(await headers())
  if (!(await permitidoPorIp(admin, ip, LIMITES.sorteoVer))) {
    return <Cortada titulo="Demasiados intentos" detalle="Esperá un momento y volvé a abrir el link de tu mail." />
  }

  const c = await buscarConfirmacionSorteo(admin, token)
  if (esError(c)) return <Cortada {...LINK_INVALIDO} />

  const cerrado = motivoCerrado(c)

  return (
    <Marco>
      <div className="rise">
        <span className="label-mono">{c.empresa_nombre || 'Sorteo'}</span>
        <h1 className="font-display text-3xl sm:text-4xl font-medium leading-tight mt-3">
          Hola, {c.nombre_publico}
        </h1>
        <p className="text-ink-2 text-[17px] leading-relaxed mt-4">
          Tu número <strong className="font-mono">{c.numero_texto}</strong> tiene cupo en{' '}
          <strong>{c.evento_nombre}</strong>
          {c.premio ? <>: {c.premio}</> : null}.
        </p>
        <div className="mt-8">
          {cerrado ? (
            <Aviso {...cerrado} />
          ) : (
            <ConfirmarCupo
              token={token}
              venceTexto={fechaLarga(c.vence_fecha)}
              preseleccion={r === 'rechazar' ? 'rechazar' : r === 'confirmar' ? 'confirmar' : null}
            />
          )}
        </div>
      </div>
    </Marco>
  )
}
