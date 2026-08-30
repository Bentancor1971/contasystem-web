'use client'

/**
 * Montar la tablet. La pantalla que ve el OPERADOR, una sola vez, antes de
 * largar la fila. El votante no la ve nunca.
 *
 * Dos pasos a propósito: primero la llave, después la confirmación con el
 * nombre y las fechas de la elección a la vista. Montar la terminal en la
 * elección equivocada se descubre tarde y con votos adentro.
 *
 * La llave no se guarda en ningún lado del dispositivo: viaja al servidor, que
 * la canjea y escribe una cookie httpOnly firmada. Este componente la tiene en
 * memoria mientras dura el montaje y nada más.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, KeyRound, Loader2, Monitor } from 'lucide-react'
import { fechaHoraCorta } from '@/lib/elecciones-types'
import {
  llaveNormalizada,
  mensajeKiosco,
  MAX_NOMBRE_TERMINAL,
  type DatosTerminal,
  type MensajeKiosco,
} from '@/lib/kiosco-types'

const SIN_RESPUESTA: MensajeKiosco = {
  titulo: 'No pudimos conectarnos',
  detalle: 'Puede ser la conexión del local. Volvé a probar en un momento.',
}

export function MontarTerminal({
  caida,
  errorServidor = false,
}: {
  caida: boolean
  /** `createAdminClient()` falló al revalidar: es del despliegue, no de la llave. */
  errorServidor?: boolean
}) {
  const router = useRouter()
  const [llave, setLlave] = useState('')
  const [datos, setDatos] = useState<DatosTerminal | null>(null)
  const [terminal, setTerminal] = useState('Mesa 1')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<MensajeKiosco | null>(null)

  async function pedir(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      if (res.status === 429) {
        return { error: 'demasiados' }
      }
      const d = (await res.json()) as Record<string, unknown>
      return d && typeof d === 'object' ? d : null
    } catch {
      return null
    }
  }

  function mostrar(d: Record<string, unknown> | null) {
    if (!d) return setError(SIN_RESPUESTA)
    if (d.error === 'demasiados') {
      return setError({
        titulo: 'Demasiados intentos',
        detalle: 'Esperá unos minutos y volvé a probar.',
      })
    }
    setError(mensajeKiosco(String(d.error ?? '')))
  }

  async function onAbrir(e: React.FormEvent) {
    e.preventDefault()
    if (ocupado) return
    const limpia = llaveNormalizada(llave)
    if (!limpia) return setError(mensajeKiosco('codigo_invalido'))

    setOcupado(true)
    setError(null)
    const d = await pedir('/api/votacion/mesa/abrir', { llave: limpia })
    setOcupado(false)

    if (d && d.eleccion_id) {
      setDatos(d as unknown as DatosTerminal)
      setError(null)
      return
    }
    mostrar(d)
  }

  async function onMontar(e: React.FormEvent) {
    e.preventDefault()
    if (ocupado || !datos) return
    if (terminal.trim() === '') return setError(mensajeKiosco('terminal_invalida'))

    setOcupado(true)
    setError(null)
    const d = await pedir('/api/votacion/mesa/montar', {
      llave: llaveNormalizada(llave),
      terminal,
    })

    if (d && d.ok === true) {
      // La llave se borra de la memoria del componente apenas deja de hacer
      // falta. `refresh()` y no `push`: la pantalla siguiente la dibuja el
      // servidor leyendo la cookie, y así no queda una entrada en el historial
      // que devuelva a este formulario.
      setLlave('')
      router.refresh()
      return
    }
    setOcupado(false)
    mostrar(d)
  }

  const avisoError = error && (
    <div className="voto-aviso voto-aviso--alto mt-5" role="alert">
      <h2 className="font-display text-xl font-medium leading-tight mb-1">{error.titulo}</h2>
      <p className="text-ink-2 text-[16px] leading-relaxed">{error.detalle}</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-md px-4 sm:px-6 py-8 sm:py-12">
        <header className="rise mb-6">
          <span className="label-mono">Votación</span>
          <h1 className="font-display text-3xl sm:text-4xl font-medium leading-[1.05] mt-3">
            Terminal de mesa
          </h1>
          <p className="text-ink-2 text-[16px] leading-relaxed mt-3">
            Esta pantalla es del operador. La llave la genera el sistema en Elecciones →
            Credenciales, se escribe una sola vez y no se le muestra a quien va a votar.
          </p>
        </header>

        {errorServidor && !datos && (
          <div className="voto-aviso voto-aviso--alto mb-5" role="status">
            <div className="flex gap-3">
              <AlertTriangle className="text-ink-2 shrink-0 mt-0.5" size={20} aria-hidden />
              <div>
                <h2 className="font-display text-xl font-medium leading-tight mb-1">
                  No se pudo confirmar la terminal
                </h2>
                <p className="text-ink-2 text-[16px] leading-relaxed">
                  Hay un problema de configuración del servidor, no de la llave. No llamés a la
                  comisión por esto: avisale a quien administra el sistema.
                </p>
              </div>
            </div>
          </div>
        )}

        {caida && !errorServidor && !datos && (
          <div className="voto-aviso voto-aviso--medio mb-5" role="status">
            <div className="flex gap-3">
              <AlertTriangle className="text-ink-2 shrink-0 mt-0.5" size={20} aria-hidden />
              <div>
                <h2 className="font-display text-xl font-medium leading-tight mb-1">
                  Esta terminal se cerró
                </h2>
                <p className="text-ink-2 text-[16px] leading-relaxed">
                  La cerraron desde el sistema o regeneraron la llave. Para volver a atender,
                  montala de nuevo con la llave actual.
                </p>
              </div>
            </div>
          </div>
        )}

        {!datos ? (
          <form onSubmit={onAbrir} className="card p-6">
            <label htmlFor="llave" className="label-mono block mb-2">
              Llave de la terminal
            </label>
            <input
              id="llave"
              name="llave"
              value={llave}
              onChange={(e) => setLlave(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={40}
              placeholder="4K4EZW8BAU"
              enterKeyHint="go"
              className="field text-center font-mono text-xl tracking-[0.25em]"
            />
            <p className="text-ink-3 text-sm leading-relaxed mt-3">
              Sin 0 ni 1: el alfabeto no los usa, así que lo que parece un cero es una O.
            </p>

            {avisoError}

            <button type="submit" disabled={ocupado} className="btn-primary w-full mt-6">
              {ocupado ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}
              Continuar
            </button>
          </form>
        ) : (
          <form onSubmit={onMontar} className="card p-6">
            <span className="label-mono">Vas a montar la terminal en</span>
            <h2 className="font-display text-2xl font-medium leading-tight mt-2 mb-3">
              {datos.nombre}
            </h2>
            <div className="perforated mb-4" />
            <dl className="font-mono text-[15px] space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Abre</dt>
                <dd className="text-right">{fechaHoraCorta(datos.fecha_apertura)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Cierra</dt>
                <dd className="text-right">{fechaHoraCorta(datos.fecha_cierre)}</dd>
              </div>
            </dl>

            {datos.estado === 'padron' && (
              <p className="text-ink-2 text-[15px] leading-relaxed mt-4">
                La votación todavía no está abierta. La terminal queda montada y esperando: no
                va a poder emitir votos hasta que la comisión abra el acto.
              </p>
            )}

            <label htmlFor="terminal" className="label-mono block mb-2 mt-6">
              Nombre de esta terminal
            </label>
            <input
              id="terminal"
              name="terminal"
              value={terminal}
              onChange={(e) => setTerminal(e.target.value)}
              autoComplete="off"
              maxLength={MAX_NOMBRE_TERMINAL}
              placeholder="Mesa 1"
              enterKeyHint="go"
              className="field"
            />
            <p className="text-ink-3 text-sm leading-relaxed mt-3">
              Es lo que después figura en el acta al lado de cada voto emitido acá.
            </p>

            {avisoError}

            <button type="submit" disabled={ocupado} className="btn-primary w-full mt-6">
              {ocupado ? <Loader2 className="animate-spin" size={18} /> : <Monitor size={18} />}
              Montar la terminal
            </button>
            <button
              type="button"
              className="btn-ghost mt-4 mx-auto"
              disabled={ocupado}
              onClick={() => {
                setDatos(null)
                setError(null)
              }}
            >
              No es esta elección
            </button>
          </form>
        )}

        <footer className="font-mono text-[11px] text-ink-3 mt-12">
          CONTASYSTEM · TERMINAL DE MESA
        </footer>
      </div>
    </main>
  )
}
