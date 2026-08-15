'use client'

/**
 * Cerrar la urna: contar, controlar y cerrar.
 *
 * El punto de la pantalla es la DIFERENCIA, y por eso está siempre a la vista y
 * no detrás de un botón: si la mesa marcó 143 personas y se contaron 141
 * sobres, eso tiene que verse mientras todavía hay gente ahí para revisarlo.
 *
 * Y el cierre no se bloquea nunca por esa diferencia: se exige una observación
 * y se sigue. Una mesa que no se puede cerrar a las once de la noche se termina
 * esquivando en papel, y ahí sí se pierde el dato.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  esErrorMesa,
  mensajeErrorMesa,
  type ControlMesa,
  type ErrorMesa,
  type FilaRecuento,
  type MensajeMesa,
  type PapeletaMesa,
} from '@/lib/mesa-types'
import { Aviso } from '../Marco'

/** Clave de una casilla de la grilla. `opcion_id` null para blanco y anulado. */
function clave(papeleta: string, opcion: string | null, tipo: 'opcion' | 'blanco' | 'anulado') {
  return `${papeleta}|${tipo}|${opcion ?? ''}`
}

type Cantidades = Record<string, number>

function desdeFilas(filas: FilaRecuento[]): Cantidades {
  const out: Cantidades = {}
  for (const f of filas) {
    const tipo = f.es_anulado ? 'anulado' : f.es_blanco ? 'blanco' : 'opcion'
    out[clave(f.papeleta_id, f.opcion_id, tipo)] = f.cantidad
  }
  return out
}

export function Recuento({
  papeletas,
  controlInicial,
  filasIniciales,
}: {
  papeletas: PapeletaMesa[]
  controlInicial: ControlMesa
  filasIniciales: FilaRecuento[]
}) {
  const router = useRouter()

  const [cant, setCant] = useState<Cantidades>(() => desdeFilas(filasIniciales))
  const [control, setControl] = useState<ControlMesa>(controlInicial)
  const [sobres, setSobres] = useState<string>(
    controlInicial.sobres_en_urna === null ? '' : String(controlInicial.sobres_en_urna),
  )
  const [observacion, setObservacion] = useState('')
  const [aviso, setAviso] = useState<(MensajeMesa & { tono: 'ok' | 'medio' | 'alto' }) | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [cerrada, setCerrada] = useState<{ marcas: number; sobres: number } | null>(null)

  const set = (k: string, v: string) => {
    const n = Number(v.replace(/\D/g, ''))
    setCant((prev) => ({ ...prev, [k]: Number.isFinite(n) ? n : 0 }))
  }

  const totalDe = (p: PapeletaMesa) => {
    let t = 0
    for (const o of p.opciones) t += cant[clave(p.id, o.id, 'opcion')] ?? 0
    t += cant[clave(p.id, null, 'blanco')] ?? 0
    t += cant[clave(p.id, null, 'anulado')] ?? 0
    return t
  }

  /** Mismo criterio que `mesa_control`: el máximo entre papeletas. */
  const totalRecuento = useMemo(
    () => papeletas.reduce((max, p) => Math.max(max, totalDe(p)), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cant, papeletas],
  )

  const sobresNum = sobres.trim() === '' ? null : Number(sobres.replace(/\D/g, ''))
  const difiere =
    sobresNum !== null && (sobresNum !== control.marcas || totalRecuento !== control.marcas)

  const filas = (): FilaRecuento[] => {
    const out: FilaRecuento[] = []
    for (const p of papeletas) {
      for (const o of p.opciones) {
        const n = cant[clave(p.id, o.id, 'opcion')] ?? 0
        if (n > 0) out.push({ papeleta_id: p.id, opcion_id: o.id, es_blanco: false, es_anulado: false, cantidad: n })
      }
      const b = cant[clave(p.id, null, 'blanco')] ?? 0
      if (b > 0) out.push({ papeleta_id: p.id, opcion_id: null, es_blanco: true, es_anulado: false, cantidad: b })
      const a = cant[clave(p.id, null, 'anulado')] ?? 0
      if (a > 0) out.push({ papeleta_id: p.id, opcion_id: null, es_blanco: false, es_anulado: true, cantidad: a })
    }
    return out
  }

  const volverAEntrar = async () => {
    try {
      await fetch('/api/mesa/salir', { method: 'POST', cache: 'no-store' })
    } catch {
      /* la cookie queda; /mesa lo muestra igual */
    }
    router.replace('/mesa')
    router.refresh()
  }

  const refrescarControl = async () => {
    try {
      const r = await fetch('/api/mesa/control', { cache: 'no-store' })
      const d = (await r.json()) as ControlMesa | ErrorMesa
      if ('ok' in d && d.ok === true) setControl(d)
    } catch {
      /* el control de la pantalla sigue siendo el último que llegó */
    }
  }

  const guardar = async () => {
    if (ocupado) return
    setOcupado(true)
    setAviso(null)
    try {
      const r = await fetch('/api/mesa/recuento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas: filas() }),
        cache: 'no-store',
      })
      const d = (await r.json()) as { ok: true; filas: number } | ErrorMesa
      if (!esErrorMesa(d)) {
        await refrescarControl()
        setAviso({
          titulo: 'Recuento guardado',
          detalle: 'Se puede corregir y volver a guardar mientras la urna siga abierta.',
          tono: 'ok',
        })
      } else {
        setAviso({ ...mensajeErrorMesa(d), tono: 'alto' })
      }
    } catch {
      setAviso({ ...mensajeErrorMesa({ error: 'sin_respuesta' }), tono: 'alto' })
      await refrescarControl()
    }
    setOcupado(false)
  }

  const cerrar = async () => {
    if (ocupado || sobresNum === null) return
    setOcupado(true)
    setAviso(null)
    try {
      const r = await fetch('/api/mesa/cerrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sobres_en_urna: sobresNum, observacion }),
        cache: 'no-store',
      })
      const d = (await r.json()) as { ok: true; marcas: number; sobres: number } | ErrorMesa
      if (!esErrorMesa(d)) {
        setCerrada({ marcas: d.marcas, sobres: d.sobres })
        setConfirmando(false)
      } else {
        // `requiere_observacion` no es un rechazo: es "escribí por qué y dale".
        setAviso({ ...mensajeErrorMesa(d), tono: 'alto' })
        setConfirmando(false)
      }
    } catch {
      setAviso({ ...mensajeErrorMesa({ error: 'sin_respuesta' }), tono: 'alto' })
      setConfirmando(false)
    }
    setOcupado(false)
  }

  // ── Pantallas terminales ──────────────────────────────────────────────────

  if (cerrada) {
    return (
      <Aviso
        titulo="Urna cerrada"
        detalle={`Quedaron ${cerrada.marcas} ${cerrada.marcas === 1 ? 'marca' : 'marcas'} y ${cerrada.sobres} ${
          cerrada.sobres === 1 ? 'sobre' : 'sobres'
        }. La sesión de esta mesa terminó.`}
        tono="ok"
      >
        <p className="text-ink-2 text-[15px] leading-relaxed mt-3">
          Lo que sigue —el escrutinio y el acta— se hace desde el sistema, con lo que cargaron todas
          las mesas.
        </p>
        <button type="button" className="btn-secondary w-full mt-4" onClick={volverAEntrar}>
          Salir
        </button>
      </Aviso>
    )
  }

  if (control.cerrada_at) {
    return (
      <Aviso
        titulo="Esta urna ya está cerrada"
        detalle="No se puede reabrir desde la web. Las correcciones las hace la comisión desde el sistema."
        tono="medio"
      >
        <button type="button" className="btn-secondary w-full mt-4" onClick={volverAEntrar}>
          Salir
        </button>
      </Aviso>
    )
  }

  // ── Pantalla ──────────────────────────────────────────────────────────────

  return (
    <div>
      <Control marcas={control.marcas} recuento={totalRecuento} sobres={sobresNum} />

      {aviso && (
        <div className="mt-4">
          <Aviso titulo={aviso.titulo} detalle={aviso.detalle} tono={aviso.tono} />
        </div>
      )}

      <section className="mt-6">
        <label htmlFor="sobres" className="label-mono block mb-2">
          Sobres contados en la urna
        </label>
        <input
          id="sobres"
          value={sobres}
          onChange={(e) => setSobres(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          placeholder="0"
          className="field font-mono text-2xl text-center"
        />
      </section>

      {papeletas.map((p) => (
        <section key={p.id} className="card p-4 sm:p-5 mt-5">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="font-display text-xl font-medium leading-tight">{p.titulo}</h2>
            <span className="font-mono text-sm text-ink-2 shrink-0">{totalDe(p)}</span>
          </div>

          <ul className="flex flex-col gap-2">
            {p.opciones.map((o) => (
              <Casilla
                key={o.id}
                etiqueta={o.numero ? `${o.numero} · ${o.titulo}` : o.titulo}
                nota={o.lema}
                valor={cant[clave(p.id, o.id, 'opcion')] ?? 0}
                onChange={(v) => set(clave(p.id, o.id, 'opcion'), v)}
              />
            ))}
            {p.permite_blanco && (
              <Casilla
                etiqueta="En blanco"
                valor={cant[clave(p.id, null, 'blanco')] ?? 0}
                onChange={(v) => set(clave(p.id, null, 'blanco'), v)}
              />
            )}
            {/* Los anulados van siempre: el acta los pide por separado aunque la
                papeleta no admita voto en blanco. */}
            <Casilla
              etiqueta="Anulados"
              valor={cant[clave(p.id, null, 'anulado')] ?? 0}
              onChange={(v) => set(clave(p.id, null, 'anulado'), v)}
            />
          </ul>
        </section>
      ))}

      <section className="mt-6">
        <label htmlFor="observacion" className="label-mono block mb-2">
          Observación {difiere ? '(obligatoria: la cuenta no cierra)' : '(opcional)'}
        </label>
        <textarea
          id="observacion"
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Ej.: apareció un sobre vacío dentro de otro."
          className="field"
        />
      </section>

      <div className="flex flex-col gap-2 mt-6 mb-10">
        <button type="button" className="btn-secondary" disabled={ocupado} onClick={guardar}>
          {ocupado ? 'Guardando…' : 'Guardar recuento'}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={ocupado || sobresNum === null}
          onClick={() => setConfirmando(true)}
        >
          Cerrar la urna
        </button>
        <p className="text-ink-3 text-[13px] leading-relaxed">
          Cerrar la urna no se deshace desde la web y termina la sesión de esta mesa, incluida la
          tuya. Antes hay que guardar el recuento.
        </p>
      </div>

      {confirmando && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Cerrar la urna"
        >
          <div className="w-full sm:max-w-md bg-paper rounded-t-2xl sm:rounded-2xl border border-line p-5">
            <span className="label-mono">Cerrar la urna</span>
            <p className="font-display text-2xl font-medium leading-tight mt-3">
              {control.marcas} {control.marcas === 1 ? 'marca' : 'marcas'} · {sobresNum}{' '}
              {sobresNum === 1 ? 'sobre' : 'sobres'} · {totalRecuento} contados
            </p>
            {difiere && (
              <p className="text-ink-2 text-[15px] leading-relaxed mt-3">
                Los tres números no coinciden. Se puede cerrar igual, con la observación escrita.
              </p>
            )}
            <p className="text-ink-2 text-[15px] leading-relaxed mt-3">
              Es irreversible desde la web y cierra la sesión de esta mesa.
            </p>
            <div className="flex gap-2 mt-5">
              <button type="button" className="btn-primary flex-1" disabled={ocupado} onClick={cerrar}>
                {ocupado ? 'Cerrando…' : 'Cerrar la urna'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={ocupado}
                onClick={() => setConfirmando(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

/** Los tres números, uno al lado del otro. Es el punto de la pantalla. */
function Control({
  marcas,
  recuento,
  sobres,
}: {
  marcas: number
  recuento: number
  sobres: number | null
}) {
  const hayDiferencia = sobres !== null && (sobres !== marcas || recuento !== marcas)
  return (
    <section
      className={`card p-4 ${hayDiferencia ? 'border-l-4' : ''}`}
      style={hayDiferencia ? { borderLeftColor: 'var(--color-status-no)' } : undefined}
      aria-live="polite"
    >
      <div className="grid grid-cols-3 gap-3 text-center">
        <Numero titulo="Marcas" valor={marcas} />
        <Numero titulo="Sobres" valor={sobres} />
        <Numero titulo="Contados" valor={recuento} />
      </div>
      <p className="text-ink-2 text-sm leading-relaxed mt-3">
        {sobres === null
          ? 'Cargá los sobres contados en la urna para ver si la cuenta cierra.'
          : hayDiferencia
            ? 'Los tres números tendrían que coincidir. Revisá antes de cerrar; si la diferencia es real, se cierra con una observación.'
            : 'La cuenta cierra.'}
      </p>
    </section>
  )
}

function Numero({ titulo, valor }: { titulo: string; valor: number | null }) {
  return (
    <div>
      <p className="label-mono">{titulo}</p>
      <p className="font-mono text-3xl mt-1">{valor === null ? '—' : valor}</p>
    </div>
  )
}

function Casilla({
  etiqueta,
  nota,
  valor,
  onChange,
}: {
  etiqueta: string
  nota?: string | null
  valor: number
  onChange: (v: string) => void
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[16px] leading-tight">{etiqueta}</p>
        {nota && <p className="text-ink-3 text-[13px] truncate">{nota}</p>}
      </div>
      <input
        value={valor === 0 ? '' : String(valor)}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        placeholder="0"
        aria-label={etiqueta}
        className="field font-mono text-lg text-center w-24 shrink-0"
      />
    </li>
  )
}
