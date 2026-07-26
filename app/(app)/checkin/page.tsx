'use client'

/**
 * /checkin — Escáner de asistencia del staff. Requiere sesión (el proxy
 * redirige a /login todo lo que no esté en PUBLIC_PATHS).
 *
 * Se usa de pie, en una puerta, con una mano, con mala luz y señal
 * intermitente. Todo el diseño de esta pantalla sale de ahí: cámara primero,
 * resultado a pantalla completa con sonido propio por caso, vuelta sola al
 * visor, y un modo lista siempre a un toque de distancia.
 *
 * Lo único que la web escribe es la asistencia, y siempre por
 * POST /api/checkin/marcar. El alta y el estado de las entradas son del desktop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  Camera,
  ChevronLeft,
  ListChecks,
  Loader2,
  MapPin,
  WifiOff,
} from 'lucide-react'
import { useApp } from '@/lib/app-context'
import { useOnlineStatus } from '@/lib/useOnlineStatus'
import { extraerToken } from '@/lib/checkin-token'
import { formatFecha, TZ_UY } from '@/lib/format'
import type {
  ConteoCheckin,
  EntradaRemota,
  EventoCheckin,
  MarcarResponse,
  ResultadoCheckin,
} from '@/lib/entradas-types'
import { Scanner } from './Scanner'
import { ErrorOverlay, ResultadoOverlay } from './ResultadoOverlay'
import { ModoLista } from './ModoLista'
import { desbloquearAudio, feedbackAviso, feedbackError, feedbackOk } from './feedback'

/** Evento elegido, para que un reload en plena puerta no obligue a volver a elegir. */
const LS_EVENTO = 'cs-checkin-evento-id'

/**
 * Anti-rebote: el visor lee varias veces por segundo y el QR se queda enfrente
 * mientras la persona guarda el teléfono. La ventana se cuenta desde que se
 * cierra el resultado, no desde la lectura, para que quedarse parado con el QR
 * en alto tampoco dispare un segundo escaneo.
 */
const REBOTE_MS = 3000

/** Cuánto queda el resultado en pantalla antes de volver solo al visor. */
const CIERRE_OK_MS = 1800
const CIERRE_ATENCION_MS = 2800

type Vista = 'camara' | 'lista'

type Overlay =
  | { tipo: 'resultado'; resultado: ResultadoCheckin; entrada: EntradaRemota | null }
  | { tipo: 'error'; mensaje: string; token: string }

/** Hoy en Montevideo (YYYY-MM-DD) — el server corre en UTC. */
function hoyUY(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_UY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return partes
}

export default function CheckinPage() {
  const { empresa } = useApp()
  const online = useOnlineStatus()
  const empresaId = empresa.empresa_id

  const [eventos, setEventos] = useState<EventoCheckin[] | null>(null)
  const [errorEventos, setErrorEventos] = useState('')
  const [eventoId, setEventoId] = useState<string | null>(null)
  const [conteo, setConteo] = useState<ConteoCheckin | null>(null)
  const [vista, setVista] = useState<Vista>('camara')
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [camaraUsada, setCamaraUsada] = useState(false)
  const [refrescarClave, setRefrescarClave] = useState(0)

  /** Última lectura atendida, para el anti-rebote. */
  const ultimaRef = useRef<{ clave: string; at: number } | null>(null)

  const evento = useMemo(
    () => eventos?.find((e) => e.evento_id === eventoId) ?? null,
    [eventos, eventoId],
  )

  // ── Eventos con QRs emitidos ────────────────────────────────────────────
  const cargarEventos = useCallback(async () => {
    setErrorEventos('')
    try {
      const res = await fetch(
        `/api/checkin/eventos?empresa_id=${encodeURIComponent(empresaId)}`,
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'No se pudieron cargar los eventos')
      const lista = (json.eventos ?? []) as EventoCheckin[]
      setEventos(lista)
      return lista
    } catch (err) {
      setErrorEventos(err instanceof Error ? err.message : 'No se pudieron cargar los eventos')
      setEventos([])
      return [] as EventoCheckin[]
    }
  }, [empresaId])

  useEffect(() => {
    let cancelado = false
    void cargarEventos().then((lista) => {
      if (cancelado || lista.length === 0) return

      // Preselección, de la más específica a la más general: el evento que se
      // estaba controlando antes del reload, el único de hoy, o el único que hay.
      const guardado = localStorage.getItem(LS_EVENTO)
      const deHoy = lista.filter((e) => e.evento_fecha === hoyUY())
      const elegido =
        lista.find((e) => e.evento_id === guardado) ??
        (deHoy.length === 1 ? deHoy[0] : null) ??
        (lista.length === 1 ? lista[0] : null)

      if (elegido) {
        setEventoId(elegido.evento_id)
        setConteo({ total: elegido.total, presentes: elegido.presentes })
      }
    })
    return () => {
      cancelado = true
    }
  }, [cargarEventos])

  const elegirEvento = useCallback((e: EventoCheckin) => {
    setEventoId(e.evento_id)
    setConteo({ total: e.total, presentes: e.presentes })
    localStorage.setItem(LS_EVENTO, e.evento_id)
    setVista('camara')
  }, [])

  const volverASeleccion = useCallback(() => {
    setEventoId(null)
    setConteo(null)
    localStorage.removeItem(LS_EVENTO)
    void cargarEventos()
  }, [cargarEventos])

  // ── Marcado ─────────────────────────────────────────────────────────────
  const marcar = useCallback(
    async (token: string) => {
      if (!eventoId) return
      setProcesando(true)
      try {
        const res = await fetch('/api/checkin/marcar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empresa_id: empresaId, evento_id: eventoId, token }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`)

        const r = json as MarcarResponse
        if (r.conteo) setConteo(r.conteo)

        if (r.resultado === 'ok') feedbackOk()
        else if (r.resultado === 'ya_presente') feedbackAviso()
        else feedbackError()

        setOverlay({ tipo: 'resultado', resultado: r.resultado, entrada: r.entrada })
        setRefrescarClave((k) => k + 1)
      } catch (err) {
        // Nunca verde sin confirmación del servidor: acá no se sabe si la
        // asistencia quedó o no, así que se dice y se ofrece reintentar.
        feedbackError()
        setOverlay({
          tipo: 'error',
          mensaje: err instanceof Error ? err.message : 'Falló la conexión con el servidor.',
          token,
        })
      } finally {
        setProcesando(false)
      }
    },
    [empresaId, eventoId],
  )

  /** Lectura del visor: saneo + anti-rebote antes de gastar un viaje al server. */
  const onDetectar = useCallback(
    (raw: string) => {
      const token = extraerToken(raw)
      const clave = token ?? raw
      const ahora = Date.now()
      const ultima = ultimaRef.current
      if (ultima && ultima.clave === clave && ahora - ultima.at < REBOTE_MS) return
      ultimaRef.current = { clave, at: ahora }

      if (!token) {
        // Un QR de WiFi, una vCard o un texto cualquiera: se rechaza en el
        // teléfono, sin llamar al servidor y sin romper el visor.
        feedbackError()
        setOverlay({ tipo: 'resultado', resultado: 'no_encontrada', entrada: null })
        return
      }
      void marcar(token)
    },
    [marcar],
  )

  /** Desde el modo lista: sin anti-rebote, es un toque deliberado. */
  const marcarDesdeLista = useCallback(
    (token: string) => {
      ultimaRef.current = { clave: token, at: Date.now() }
      void marcar(token)
    },
    [marcar],
  )

  const cerrarOverlay = useCallback(() => {
    // Reinicia la ventana de rebote: si el QR sigue enfrente al volver al
    // visor, no se vuelve a leer enseguida.
    if (ultimaRef.current) ultimaRef.current.at = Date.now()
    setOverlay(null)
  }, [])

  // Cierre automático del resultado. El overlay de error NO se auto-cierra.
  useEffect(() => {
    if (overlay?.tipo !== 'resultado') return
    const ms = overlay.resultado === 'ok' ? CIERRE_OK_MS : CIERRE_ATENCION_MS
    const t = setTimeout(cerrarOverlay, ms)
    return () => clearTimeout(t)
  }, [overlay, cerrarOverlay])

  // ── Render ──────────────────────────────────────────────────────────────

  if (eventos === null) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-amber" size={28} />
      </div>
    )
  }

  if (!evento) {
    return (
      <SeleccionEvento
        eventos={eventos}
        error={errorEventos}
        onElegir={elegirEvento}
        onReintentar={() => void cargarEventos()}
      />
    )
  }

  const pct = conteo && conteo.total > 0 ? (conteo.presentes / conteo.total) * 100 : 0

  return (
    <div className="flex-1 px-5 py-5 max-w-xl w-full mx-auto flex flex-col gap-4">
      {/* Evento + contador */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-medium leading-tight truncate">
              {evento.evento_nombre}
            </h1>
            <p className="font-mono text-[11px] text-ink-3 mt-1 truncate">
              {[
                evento.evento_fecha ? formatFecha(evento.evento_fecha) : null,
                evento.evento_lugar,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
          </div>
          <button type="button" className="btn-ghost shrink-0 mt-1" onClick={volverASeleccion}>
            Cambiar
          </button>
        </div>

        <div className="perforated my-3" />

        <div className="flex items-baseline justify-between">
          <span className="label-mono">Presentes</span>
          <span className="font-mono text-2xl font-medium tabular-nums">
            {conteo?.presentes ?? 0}
            <span className="text-ink-3 text-base"> / {conteo?.total ?? 0}</span>
          </span>
        </div>
        <div className="h-1.5 bg-paper-3 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-amber rounded-full transition-[width] duration-300"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>

      {!online && (
        <p className="flex items-center gap-2 text-sm text-status-warn bg-status-warn-bg rounded-md px-3 py-2">
          <WifiOff size={16} className="shrink-0" />
          Sin conexión. Los escaneos van a fallar hasta que vuelva la señal.
        </p>
      )}

      {/* Cámara / Lista */}
      <div className="flex border-b border-line">
        <button
          type="button"
          className="tab flex items-center gap-2"
          aria-selected={vista === 'camara'}
          onClick={() => setVista('camara')}
        >
          <Camera size={14} />
          Cámara
        </button>
        <button
          type="button"
          className="tab flex items-center gap-2"
          aria-selected={vista === 'lista'}
          onClick={() => setVista('lista')}
        >
          <ListChecks size={14} />
          Manual
        </button>
      </div>

      {vista === 'camara' ? (
        <>
          <Scanner
            activo={!overlay && !procesando}
            autoIniciar={camaraUsada}
            onDetectar={onDetectar}
            onEncender={() => {
              desbloquearAudio()
              setCamaraUsada(true)
            }}
          />
          <p className="text-center text-[12px] text-ink-3 leading-snug">
            Apuntá al QR del recibo. Si no lee, pasá a <strong>Manual</strong> y buscá por
            nombre o documento.
          </p>
        </>
      ) : (
        <ModoLista
          // `key` por evento: cambiar de evento resetea filtro y orden en vez
          // de arrastrar los del anterior.
          key={evento.evento_id}
          empresaId={empresaId}
          eventoId={evento.evento_id}
          roles={evento.roles}
          onMarcar={marcarDesdeLista}
          onConteo={setConteo}
          refrescarClave={refrescarClave}
        />
      )}

      {overlay?.tipo === 'resultado' && (
        <ResultadoOverlay
          resultado={overlay.resultado}
          entrada={overlay.entrada}
          onCerrar={cerrarOverlay}
        />
      )}
      {overlay?.tipo === 'error' && (
        <ErrorOverlay
          mensaje={overlay.mensaje}
          reintentando={procesando}
          onReintentar={() => void marcar(overlay.token)}
          onCerrar={cerrarOverlay}
        />
      )}
    </div>
  )
}

// ── Selección de evento ───────────────────────────────────────────────────

function SeleccionEvento({
  eventos,
  error,
  onElegir,
  onReintentar,
}: {
  eventos: EventoCheckin[]
  error: string
  onElegir: (e: EventoCheckin) => void
  onReintentar: () => void
}) {
  return (
    <div className="flex-1 px-5 py-6 max-w-xl w-full mx-auto rise">
      <p className="label-mono mb-1">Check-in</p>
      <h1 className="font-display text-2xl font-medium mb-1">¿Qué evento controlás?</h1>
      <p className="text-sm text-ink-2 mb-6">
        Sólo aparecen los eventos que ya tienen entradas con QR emitidas.
      </p>

      {error && (
        <div className="mb-5">
          <p className="text-sm text-status-no bg-status-no-bg rounded-md px-3 py-2 mb-3">
            {error}
          </p>
          <button type="button" className="btn-secondary" onClick={onReintentar}>
            Reintentar
          </button>
        </div>
      )}

      {!error && eventos.length === 0 && (
        <div className="card p-6 text-center">
          <CalendarDays className="mx-auto text-ink-3 mb-3" size={32} />
          <p className="text-sm text-ink-2 leading-relaxed">
            Todavía no hay entradas con QR emitidas. Las emite ContaSystem desktop al mandar
            el recibo de cobro o la confirmación de inscripción.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {eventos.map((e) => (
          <button
            key={e.evento_id}
            type="button"
            className="emp-card"
            onClick={() => onElegir(e)}
          >
            <span className="min-w-0">
              <span className="block font-medium leading-tight truncate">{e.evento_nombre}</span>
              <span className="block font-mono text-[11px] text-ink-3 mt-1 truncate">
                {e.evento_fecha ? formatFecha(e.evento_fecha) : 'Sin fecha'}
                {e.evento_lugar && (
                  <>
                    {' · '}
                    <MapPin size={10} className="inline -mt-0.5" /> {e.evento_lugar}
                  </>
                )}
              </span>
            </span>
            <span className="font-mono text-sm shrink-0 tabular-nums">
              {e.presentes}
              <span className="text-ink-3"> / {e.total}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="text-[12px] text-ink-3 mt-6 flex items-start gap-2 leading-snug">
        <ChevronLeft size={14} className="rotate-180 shrink-0 mt-0.5" />
        La cámara necesita HTTPS. En una conexión http:// no hay visor, pero el modo lista
        sigue funcionando.
      </p>
    </div>
  )
}
