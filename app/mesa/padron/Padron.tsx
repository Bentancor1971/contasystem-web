'use client'

/**
 * La pantalla del día. Se usa 400 veces seguidas, así que todo acá está
 * decidido por esa frecuencia y no por prolijidad:
 *
 *  · El padrón se carga UNA vez y después sólo llegan deltas, con el `hasta`
 *    del servidor como marca de agua. Con el reloj del dispositivo, uno
 *    atrasado se perdería cambios para siempre.
 *  · La búsqueda corre sobre la lista en memoria: ningún request lleva el texto
 *    tipeado. Un endpoint que contesta por una cédula suelta sería un oráculo de
 *    quién es socio aunque tenga login delante.
 *  · **Nada se marca en pantalla sin `ok` del servidor.** Un falso positivo hace
 *    que la persona se vaya sin votar y nadie se entere hasta el escrutinio.
 *  · El padrón vive en memoria y muere con la pestaña: no va a localStorage, ni
 *    a IndexedDB, ni a un service worker. Lleva documentos adentro.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  buscarEnPadron,
  dondeVoto,
  esErrorMesa,
  estadoDe,
  horaCorta,
  indexar,
  mensajeErrorMesa,
  MINIMO_BUSQUEDA,
  type ErrorMesa,
  type MarcaOk,
  type MensajeMesa,
  type PersonaIndexada,
  type PersonaPadron,
  type RespuestaPadron,
} from '@/lib/mesa-types'
import { Aviso } from '../Marco'

/** Cada cuánto se pide el delta. El pedido dice 10–15 s. */
const REFRESCO_MS = 12_000

/** Cuántos resultados se dibujan. Más que esto no se lee: se afina la búsqueda. */
const TOPE_RESULTADOS = 40

type Mapa = Map<string, PersonaIndexada>

export function Padron({
  mesaId,
  esPresidente,
}: {
  mesaId: string
  esPresidente: boolean
}) {
  const router = useRouter()

  const [padron, setPadron] = useState<Mapa>(() => new Map())
  const [fase, setFase] = useState<'cargando' | 'listo'>('cargando')
  const [caido, setCaido] = useState(false)
  const [vencida, setVencida] = useState(false)

  const [q, setQ] = useState('')
  const [aviso, setAviso] = useState<(MensajeMesa & { tono: 'ok' | 'medio' | 'alto' }) | null>(null)
  const [porMarcar, setPorMarcar] = useState<PersonaIndexada | null>(null)
  const [porDesmarcar, setPorDesmarcar] = useState<PersonaIndexada | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  /** Marca de agua del servidor. En ref y no en estado: no dibuja nada. */
  const hasta = useRef<string | null>(null)
  const buscador = useRef<HTMLInputElement>(null)

  // ── Carga y refresco ──────────────────────────────────────────────────────

  const cargar = useCallback(async (inicial: boolean) => {
    const desde = inicial ? null : hasta.current
    try {
      const r = await fetch(
        desde ? `/api/mesa/padron?desde=${encodeURIComponent(desde)}` : '/api/mesa/padron',
        { cache: 'no-store' },
      )
      const d = (await r.json()) as RespuestaPadron | ErrorMesa

      if (!esErrorMesa(d)) {
        hasta.current = d.hasta
        setPadron((prev) => {
          // `completo` reemplaza; un delta se aplica encima de lo que ya está.
          const m: Mapa = d.completo ? new Map() : new Map(prev)
          for (const p of d.padron) m.set(p.habilitado_id, indexar(p))
          return m
        })
        setCaido(false)
        setFase('listo')
        return
      }

      if (d.error === 'sesion_invalida') {
        setVencida(true)
        return
      }
      setCaido(true)
    } catch {
      // Sin conexión el padrón que ya está en memoria sigue sirviendo: se avisa
      // que quedó viejo, pero no se borra nada de la pantalla.
      setCaido(true)
    }
  }, [])

  useEffect(() => {
    void cargar(true)
  }, [cargar])

  useEffect(() => {
    if (vencida) return
    const t = setInterval(() => void cargar(false), REFRESCO_MS)
    // Volver a la pestaña después de un rato tiene que traer lo de las otras
    // mesas al instante, sin esperar el próximo tic.
    const visible = () => {
      if (document.visibilityState === 'visible') void cargar(false)
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [cargar, vencida])

  // ── Derivados ─────────────────────────────────────────────────────────────

  const lista = useMemo(() => Array.from(padron.values()), [padron])
  const encontradas = useMemo(() => buscarEnPadron(lista, q), [lista, q])
  const votaronAca = useMemo(
    () => lista.filter((p) => p.voto_origen === 'urna' && p.mesa_id === mesaId).length,
    [lista, mesaId],
  )

  /** Aplica un cambio sobre una fila. Sólo se llama con `ok` del servidor. */
  const aplicar = (id: string, cambio: Partial<PersonaPadron>) => {
    setPadron((prev) => {
      const actual = prev.get(id)
      if (!actual) return prev
      const m: Mapa = new Map(prev)
      m.set(id, indexar({ ...actual, ...cambio }))
      return m
    })
  }

  const salir = async () => {
    try {
      await fetch('/api/mesa/salir', { method: 'POST', cache: 'no-store' })
    } catch {
      // La cookie queda; /mesa lo va a mostrar igual.
    }
    router.replace('/mesa')
    router.refresh()
  }

  // ── Marcar ────────────────────────────────────────────────────────────────

  const marcar = async (p: PersonaIndexada) => {
    if (ocupado) return
    setOcupado(true)
    setAviso(null)
    try {
      const r = await fetch('/api/mesa/marcar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habilitado_id: p.habilitado_id }),
        cache: 'no-store',
      })
      const d = (await r.json()) as MarcaOk | ErrorMesa

      if (!esErrorMesa(d)) {
        aplicar(p.habilitado_id, {
          voto_emitido_at: d.emitido_at,
          voto_origen: 'urna',
          mesa_id: mesaId,
        })
        setAviso({
          titulo: `Votó ${p.nombre_completo}`,
          detalle: `Registrado a las ${horaCorta(d.emitido_at)}.`,
          tono: 'ok',
        })
        setPorMarcar(null)
        // Limpio y con el foco puesto: la próxima persona ya está en la fila.
        setQ('')
        buscador.current?.focus()
      } else if (d.error === 'ya_voto') {
        // La fila se actualiza igual: lo que ve el operador tiene que coincidir
        // con lo que acaba de leer el servidor.
        aplicar(p.habilitado_id, {
          voto_emitido_at: d.emitido_at ?? p.voto_emitido_at,
          voto_origen: d.voto_origen ?? p.voto_origen,
        })
        const cuando = horaCorta(d.emitido_at)
        const donde =
          d.voto_origen === 'web' ? 'por internet' : d.mesa ? `en ${d.mesa}` : 'en otra mesa'
        setAviso({
          titulo: 'Esa persona ya votó',
          detalle: `${p.nombre_completo} votó ${donde}${cuando ? ` a las ${cuando}` : ''}. No puede volver a votar.`,
          tono: 'alto',
        })
        setPorMarcar(null)
      } else if (d.error === 'sesion_invalida') {
        setVencida(true)
      } else {
        const m = mensajeErrorMesa(d)
        setAviso({ ...m, tono: 'alto' })
        setPorMarcar(null)
      }
    } catch {
      // La marca pudo haber llegado igual: NO se dice que no se registró, y se
      // pide el delta para que la lista muestre lo que de verdad quedó.
      const m = mensajeErrorMesa({ error: 'sin_respuesta' })
      setAviso({ ...m, tono: 'alto' })
      setPorMarcar(null)
      void cargar(false)
    }
    setOcupado(false)
  }

  // ── Desmarcar ─────────────────────────────────────────────────────────────

  const desmarcar = async (p: PersonaIndexada) => {
    if (ocupado || motivo.trim() === '') return
    setOcupado(true)
    setAviso(null)
    try {
      const r = await fetch('/api/mesa/desmarcar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habilitado_id: p.habilitado_id, motivo }),
        cache: 'no-store',
      })
      const d = (await r.json()) as { ok: true } | ErrorMesa

      if (!esErrorMesa(d)) {
        aplicar(p.habilitado_id, { voto_emitido_at: null, voto_origen: null, mesa_id: null })
        setAviso({
          titulo: `Se deshizo la marca de ${p.nombre_completo}`,
          detalle: 'Puede votar.',
          tono: 'medio',
        })
        setPorDesmarcar(null)
        setMotivo('')
      } else if (d.error === 'sesion_invalida') {
        setVencida(true)
      } else {
        setAviso({ ...mensajeErrorMesa(d), tono: 'alto' })
      }
    } catch {
      setAviso({ ...mensajeErrorMesa({ error: 'sin_respuesta' }), tono: 'alto' })
      void cargar(false)
    }
    setOcupado(false)
  }

  // ── Pantallas terminales ──────────────────────────────────────────────────

  if (vencida) {
    return (
      <Aviso
        titulo="La sesión de la mesa venció"
        detalle="Volvé a entrar con el código y el PIN. Lo que ya se marcó está guardado."
        tono="alto"
      >
        <button type="button" className="btn-primary w-full mt-4" onClick={salir}>
          Volver a entrar
        </button>
      </Aviso>
    )
  }

  // ── Pantalla ──────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-mono text-sm text-ink-2">
          {votaronAca} {votaronAca === 1 ? 'persona votó' : 'personas votaron'} en esta mesa
        </p>
        {esPresidente && (
          <a href="/mesa/recuento" className="btn-secondary text-sm shrink-0">
            Cerrar urna
          </a>
        )}
      </div>

      <label htmlFor="buscar" className="label-mono block mb-2">
        Buscar por nombre o cédula
      </label>
      <input
        id="buscar"
        ref={buscador}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        // Sin autocompletado ni corrector: acá se tipean apellidos y cédulas, y
        // el teclado que "ayuda" es el que hace perder el turno.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Pérez  ·  1.234.567-8"
        className="field text-lg"
      />

      {fase === 'cargando' && (
        <p className="text-ink-3 text-sm mt-4">Cargando el padrón…</p>
      )}

      {caido && fase === 'listo' && (
        <p className="text-[13px] text-ink-3 mt-3">
          Sin conexión con el servidor: la lista puede estar desactualizada. Se sigue intentando.
        </p>
      )}

      {aviso && (
        <div className="mt-4">
          <Aviso titulo={aviso.titulo} detalle={aviso.detalle} tono={aviso.tono} />
        </div>
      )}

      {fase === 'listo' && (
        <div className="mt-5">
          {q.trim().length < MINIMO_BUSQUEDA ? (
            <p className="text-ink-3 text-sm">
              Escribí al menos {MINIMO_BUSQUEDA} letras del nombre o {MINIMO_BUSQUEDA} dígitos de la
              cédula. El padrón tiene {lista.length}{' '}
              {lista.length === 1 ? 'persona' : 'personas'}.
            </p>
          ) : encontradas.length === 0 ? (
            <p className="text-ink-3 text-sm">
              No aparece nadie con eso. Probá con el apellido, o con los últimos dígitos de la
              cédula.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {encontradas.slice(0, TOPE_RESULTADOS).map((p) => (
                  <Fila
                    key={p.habilitado_id}
                    p={p}
                    mesaId={mesaId}
                    onMarcar={() => {
                      setAviso(null)
                      setPorMarcar(p)
                    }}
                    onDesmarcar={() => {
                      setAviso(null)
                      setMotivo('')
                      setPorDesmarcar(p)
                    }}
                  />
                ))}
              </ul>
              {encontradas.length > TOPE_RESULTADOS && (
                <p className="text-ink-3 text-sm mt-3">
                  Hay {encontradas.length - TOPE_RESULTADOS} más. Agregá el nombre o más dígitos.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {porMarcar && (
        <Dialogo
          titulo="¿Registrar el voto?"
          onCerrar={() => setPorMarcar(null)}
        >
          {/* La confirmación repite nombre Y documento: una confirmación que no
              muestra a quién se está por marcar no sirve de nada. */}
          <p className="font-display text-2xl font-medium leading-tight">
            {porMarcar.nombre_completo}
          </p>
          <p className="font-mono text-ink-2 mt-1">{porMarcar.documento ?? 'sin documento'}</p>
          {porMarcar.categoria && (
            <p className="text-ink-3 text-sm mt-1">{porMarcar.categoria}</p>
          )}
          <p className="text-ink-2 text-[15px] mt-4">
            Queda registrado que esta persona votó. Se puede deshacer desde esta mesa mientras la
            urna siga abierta.
          </p>
          <div className="flex gap-2 mt-5">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={ocupado}
              onClick={() => void marcar(porMarcar)}
            >
              {ocupado ? 'Registrando…' : 'Sí, votó'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={ocupado}
              onClick={() => setPorMarcar(null)}
            >
              Cancelar
            </button>
          </div>
        </Dialogo>
      )}

      {porDesmarcar && (
        <Dialogo titulo="Deshacer la marca" onCerrar={() => setPorDesmarcar(null)}>
          <p className="font-display text-2xl font-medium leading-tight">
            {porDesmarcar.nombre_completo}
          </p>
          <p className="font-mono text-ink-2 mt-1">{porDesmarcar.documento ?? 'sin documento'}</p>
          <label htmlFor="motivo" className="label-mono block mt-4 mb-2">
            Motivo
          </label>
          <textarea
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Se marcó a la persona equivocada"
            className="field"
          />
          <p className="text-ink-3 text-[13px] mt-2">
            Queda escrito. Es para el error de tipeo: si el voto ya entró a la urna, lo anula la
            comisión.
          </p>
          <div className="flex gap-2 mt-5">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={ocupado || motivo.trim() === ''}
              onClick={() => void desmarcar(porDesmarcar)}
            >
              {ocupado ? 'Deshaciendo…' : 'Deshacer'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={ocupado}
              onClick={() => setPorDesmarcar(null)}
            >
              Cancelar
            </button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function Fila({
  p,
  mesaId,
  onMarcar,
  onDesmarcar,
}: {
  p: PersonaIndexada
  mesaId: string
  onMarcar: () => void
  onDesmarcar: () => void
}) {
  const estado = estadoDe(p)
  const propia = p.voto_origen === 'urna' && p.mesa_id === mesaId

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[17px] leading-tight">{p.nombre_completo}</p>
          <p className="font-mono text-sm text-ink-2 mt-0.5">{p.documento ?? 'sin documento'}</p>
          {p.categoria && <p className="text-ink-3 text-[13px] mt-0.5">{p.categoria}</p>}
        </div>
        {estado === 'voto' ? (
          <span className="badge badge-imported shrink-0">votó</span>
        ) : estado === 'inhabilitada' ? (
          <span className="badge badge-rejected shrink-0">no habilitada</span>
        ) : null}
      </div>

      {estado === 'voto' && (
        <p className="text-ink-2 text-sm mt-2">
          Votó {dondeVoto(p, mesaId)}
          {horaCorta(p.voto_emitido_at) ? ` a las ${horaCorta(p.voto_emitido_at)}` : ''}.
        </p>
      )}
      {estado === 'inhabilitada' && (
        <p className="text-ink-2 text-sm mt-2">
          {p.motivo_inhabilitacion ?? 'Figura inhabilitada en el padrón.'}
        </p>
      )}

      {estado === 'habilitada' && (
        <button type="button" className="btn-primary w-full mt-3" onClick={onMarcar}>
          Registrar que votó
        </button>
      )}
      {/* Desmarcar sólo aparece sobre lo que marcó ESTA mesa. */}
      {propia && (
        <button type="button" className="btn-ghost text-sm mt-2" onClick={onDesmarcar}>
          Deshacer
        </button>
      )}
    </li>
  )
}

function Dialogo({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string
  onCerrar: () => void
  children: React.ReactNode
}) {
  // Cerrar con Escape: el operador tiene el teclado en la mano si trabaja con
  // notebook, y en el celular el botón Cancelar está igual de a mano.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCerrar])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="w-full sm:max-w-md bg-paper rounded-t-2xl sm:rounded-2xl border border-line p-5 max-h-[90vh] overflow-y-auto">
        <span className="label-mono">{titulo}</span>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}
