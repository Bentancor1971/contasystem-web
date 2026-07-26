'use client'

/**
 * Control manual de asistencia — la lista, sin cámara.
 *
 * Es el respaldo cuando el QR no se lee (pantalla rota, brillo al mínimo, mail
 * perdido) y también la forma de pasar lista a mano de punta a punta. Sin esto,
 * la primera vez que un QR falla la pantalla queda inutilizable y se vuelve al
 * papel.
 *
 * Marcar desde acá va por el MISMO endpoint que el escáner, así el resultado
 * (verde / ámbar / rojo) y la traza en `asistio_por` son idénticos.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Search, Undo2, UserCheck, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatHoraUY } from '@/lib/format'
import {
  nombreMostrado,
  ROL_ASISTENTE,
  ROL_TODOS,
  type ConteoCheckin,
  type DesmarcarResponse,
  type EntradaListada,
  type OrdenLista,
  type RolEvento,
} from '@/lib/entradas-types'

/** Espera entre tecla y consulta: escribir un apellido no dispara 8 requests. */
const DEBOUNCE_MS = 300

interface ModoListaProps {
  empresaId: string
  eventoId: string
  /** Roles presentes en el evento, para los filtros. Vienen con el evento. */
  roles: RolEvento[]
  /** Delega en el flujo de marcado del padre (mismo overlay que la cámara). */
  onMarcar: (token: string) => void
  /** Refresca el contador de la puerta después de desmarcar. */
  onConteo: (conteo: ConteoCheckin) => void
  /** Cambia después de cada marcado para releer la lista. */
  refrescarClave: number
}

export function ModoLista({
  empresaId,
  eventoId,
  roles,
  onMarcar,
  onConteo,
  refrescarClave,
}: ModoListaProps) {
  /**
   * Por defecto, los asistentes: es el rol de casi todo el mundo y el que se
   * controla en la puerta. Si el evento no tiene ninguno (uno sólo de
   * expositores, por ejemplo), el default no puede ser un filtro vacío.
   */
  const rolInicial = useMemo(
    () => (roles.some((r) => r.nombre === ROL_ASISTENTE) ? ROL_ASISTENTE : ROL_TODOS),
    [roles],
  )

  const [q, setQ] = useState('')
  const [rol, setRol] = useState(rolInicial)
  const [orden, setOrden] = useState<OrdenLista>('apellido')
  const [entradas, setEntradas] = useState<EntradaListada[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  /** Token con la confirmación de desmarcado abierta. Sólo uno a la vez. */
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [desmarcando, setDesmarcando] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cargar = useCallback(
    async (termino: string, rolFiltro: string, ordenActual: OrdenLista) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      setCargando(true)
      setError('')
      try {
        const params = new URLSearchParams({
          empresa_id: empresaId,
          evento_id: eventoId,
          q: termino,
          rol: rolFiltro,
          orden: ordenActual,
        })
        const res = await fetch(`/api/checkin/entradas?${params}`, { signal: ac.signal })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? 'No se pudo cargar la lista')
        setEntradas(json.entradas ?? [])
        setTotal(json.total ?? 0)
        setLimit(json.limit ?? 0)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'No se pudo cargar la lista')
        setEntradas([])
      } finally {
        if (!ac.signal.aborted) setCargando(false)
      }
    },
    [empresaId, eventoId],
  )

  useEffect(() => {
    const t = setTimeout(() => void cargar(q.trim(), rol, orden), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, rol, orden, cargar, refrescarClave])

  /**
   * Da de baja una asistencia marcada por error.
   *
   * No usa el overlay a pantalla completa del escáner: no es un ingreso, es una
   * corrección hecha mirando la lista, y tapar la pantalla haría perder el lugar
   * donde se estaba. Alcanza con el toast y la fila actualizándose.
   */
  const desmarcar = useCallback(
    async (e: EntradaListada) => {
      setDesmarcando(e.token)
      try {
        const res = await fetch('/api/checkin/desmarcar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            empresa_id: empresaId,
            evento_id: eventoId,
            token: e.token,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`)

        const r = json as DesmarcarResponse
        if (r.conteo) onConteo(r.conteo)

        if (r.resultado === 'ok') {
          toast.success(`${nombreMostrado(e, orden)} quedó como ausente`)
        } else if (r.resultado === 'no_estaba') {
          toast(`${nombreMostrado(e, orden)} ya figuraba ausente`)
        } else {
          toast.error('No se pudo desmarcar: la entrada ya no es de este evento')
        }

        setConfirmando(null)
        await cargar(q.trim(), rol, orden)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se pudo desmarcar')
      } finally {
        setDesmarcando(null)
      }
    },
    [cargar, empresaId, eventoId, onConteo, orden, q, rol],
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  const truncada = limit > 0 && total > entradas.length
  // Con un solo rol los chips no aportan nada: es toda la gente del evento.
  const mostrarRoles = roles.length > 1

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b-2 border-ink pb-1">
        <Search size={18} className="text-ink-3 shrink-0" />
        <input
          className="flex-1 bg-transparent border-none outline-none py-2 text-[17px]"
          placeholder="Buscar por nombre o documento"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          // inputMode text: el documento es numérico pero el nombre no, y el
          // teclado numérico impediría buscar por apellido.
        />
        {cargando && <Loader2 size={18} className="animate-spin text-amber shrink-0" />}
      </div>

      {/* Orden. Por defecto apellido: es el orden en que se pasa lista. */}
      <div className="flex items-center justify-between gap-3">
        <span className="label-mono">Ordenar por</span>
        <div className="pill-group" role="group" aria-label="Orden de la lista">
          <button
            type="button"
            className="pill"
            aria-pressed={orden === 'apellido'}
            onClick={() => setOrden('apellido')}
          >
            Apellido
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={orden === 'nombre'}
            onClick={() => setOrden('nombre')}
          >
            Nombre
          </button>
        </div>
      </div>

      {mostrarRoles && (
        <div className="pill-group pill-group-wrap" role="group" aria-label="Filtrar por rol">
          {roles.map((r) => (
            <button
              key={r.nombre}
              type="button"
              className="pill"
              aria-pressed={rol === r.nombre}
              onClick={() => setRol(r.nombre)}
            >
              {r.nombre} · {r.total}
            </button>
          ))}
          <button
            type="button"
            className="pill"
            aria-pressed={rol === ROL_TODOS}
            onClick={() => setRol(ROL_TODOS)}
          >
            Todos
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-status-no bg-status-no-bg rounded-md px-3 py-2">{error}</p>
      )}

      {!cargando && entradas.length === 0 && !error && (
        <p className="text-center text-ink-3 py-10 text-sm">
          {q.trim()
            ? 'Nadie coincide con esa búsqueda.'
            : rol === ROL_TODOS
              ? 'Este evento no tiene entradas emitidas.'
              : `No hay entradas con el rol ${rol}.`}
        </p>
      )}

      <ul className="divide-y divide-line">
        {entradas.map((e) => {
          const presente = Boolean(e.asistio_at)
          const anulada = e.estado === 'anulada'
          const enConfirmacion = confirmando === e.token
          const enVuelo = desmarcando === e.token
          return (
            <li key={e.token} className="py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-medium leading-tight truncate ${
                      anulada ? 'line-through text-ink-3' : ''
                    }`}
                  >
                    {nombreMostrado(e, orden)}
                  </p>
                  <p className="font-mono text-[11px] text-ink-3 truncate mt-0.5">
                    {[
                      e.documento,
                      e.categoria_nombre,
                      // El rol sólo se repite en cada fila cuando la lista mezcla
                      // varios: con el filtro puesto ya está arriba.
                      rol === ROL_TODOS ? (e.rol_nombre ?? ROL_ASISTENTE) : null,
                      e.numero && `N° ${e.numero}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>

                {anulada ? (
                  <span className="badge badge-rejected shrink-0">Anulada</span>
                ) : presente ? (
                  // El badge de presente ES el botón de deshacer: si está mal
                  // marcado, se toca justo donde se ve el error.
                  <button
                    type="button"
                    onClick={() => setConfirmando(enConfirmacion ? null : e.token)}
                    aria-expanded={enConfirmacion}
                    className="badge badge-imported shrink-0 cursor-pointer"
                  >
                    Presente {formatHoraUY(e.asistio_at)}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onMarcar(e.token)}
                    className="btn-primary shrink-0 !px-4 !py-2 !min-h-0 !text-sm"
                  >
                    <Check size={16} />
                    Marcar
                  </button>
                )}
              </div>

              {/* Confirmación en dos toques: desmarcar borra un ingreso real,
                  no puede pasar por un roce con el pulgar. */}
              {presente && enConfirmacion && (
                <div className="mt-3 rounded-md bg-paper-2 border border-line p-3">
                  <p className="text-[12px] text-ink-2 leading-snug mb-3">
                    Se registra el ingreso como no ocurrido.
                    {e.asistio_por && (
                      <>
                        {' '}
                        Lo marcó <span className="font-mono">{e.asistio_por}</span>.
                      </>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void desmarcar(e)}
                      disabled={enVuelo}
                      className="btn-secondary !px-4 !py-2 !min-h-0 !text-sm"
                    >
                      {enVuelo ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Undo2 size={16} />
                      )}
                      Desmarcar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmando(null)}
                      disabled={enVuelo}
                      className="btn-ghost px-2"
                    >
                      <X size={16} />
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {truncada && (
        <p className="text-center text-[12px] text-ink-3 flex items-center justify-center gap-2">
          <UserCheck size={14} />
          Mostrando {entradas.length} de {total}. Afiná la búsqueda para ver el resto.
        </p>
      )}
    </div>
  )
}
