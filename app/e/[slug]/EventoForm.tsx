'use client'

/**
 * Formulario público de inscripción (modelo puente).
 *
 * Flujo: cédula → "Verificar" → resuelve socio + tipo de participante
 * (socio/no_socio según cuotas pendientes) → muestra las categorías con el
 * precio que le corresponde → inscribe. El importe lo fija el server.
 */

import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Loader2, Search, Ticket, Info, X, Landmark, CalendarClock } from 'lucide-react'
import type {
  EventoPublico,
  ModalidadInscripcion,
  ResolucionParticipante,
  TipoParticipante,
} from '@/lib/eventos-types'
import { simboloMoneda } from '@/lib/format'

function formatImporte(n: number, moneda: string): string {
  const nf = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${simboloMoneda(moneda)} ${nf.format(n)}`
}

/** Valor de `categoriaId` cuando el participante elige la opción de categoría libre. */
const OTROS = '__otros__'
/** Valor del select de tipo de alimentación cuando elige "Otros". */
const ALIM_OTROS = '__otros_alim__'

interface Resultado {
  numero: string | null
  categoria_nombre: string | null
  importe: number
  moneda_codigo: string
  tipo_participante: string
  es_socio: boolean
  cuotas_pendientes: number | null
  lleva_transporte: boolean
  transporte_importe: number
  lleva_alimentacion: boolean
  alimentacion_importe: number
  alimentacion_tipo: string | null
  total: number
  modalidad: ModalidadInscripcion
  datos_deposito: string | null
}

export function EventoForm({ evento }: { evento: EventoPublico }) {
  const [documento, setDocumento] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [resuelto, setResuelto] = useState<ResolucionParticipante | null>(null)

  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [mail, setMail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [categoriaOtros, setCategoriaOtros] = useState('')
  const [llevaTransporte, setLlevaTransporte] = useState(false)
  const [llevaAlimentacion, setLlevaAlimentacion] = useState(false)
  const [alimentacionTipo, setAlimentacionTipo] = useState('')
  const [alimentacionOtros, setAlimentacionOtros] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const tipo: TipoParticipante = resuelto?.tipo_participante ?? 'no_socio'
  const conCosto = evento.tipo === 'con_costo'

  // Vuelve el formulario al estado inicial (útil en modo kiosco, para el siguiente inscripto).
  function cerrarFormulario() {
    setDocumento('')
    setVerificando(false)
    setResuelto(null)
    setNombre('')
    setApellido('')
    setMail('')
    setTelefono('')
    setCategoriaId('')
    setCategoriaOtros('')
    setLlevaTransporte(false)
    setLlevaAlimentacion(false)
    setAlimentacionTipo('')
    setAlimentacionOtros('')
    setEnviando(false)
    setResultado(null)
  }

  // Precio visible por categoría según el tipo de participante resuelto.
  const precioDe = (c: EventoPublico['categorias'][number]): number | null =>
    tipo === 'socio' ? c.precio_socio : c.precio_no_socio

  // Transporte: costo según tipo de participante (0 si sin costo o no lo pide).
  const transp = evento.transporte
  const transporteImporte =
    transp.disponible && llevaTransporte && transp.con_costo
      ? tipo === 'socio'
        ? transp.importe_socio
        : transp.importe_no_socio
      : 0
  // Alimentación: espejo de transporte. El tipo es una preferencia (no cambia precio).
  const alim = evento.alimentacion
  const alimentacionImporte =
    alim.disponible && llevaAlimentacion && alim.con_costo
      ? tipo === 'socio'
        ? alim.importe_socio
        : alim.importe_no_socio
      : 0
  // Opciones de categoría según el tipo de evento:
  //   - con costo: las categorías con precio del evento (tarifa socio/no_socio).
  //   - sin costo: el catálogo de categorías de socio, como clasificación.
  const opcionesCategoria: { id: string; nombre: string; precio: number | null }[] =
    conCosto
      ? evento.categorias.map((c) => ({ id: c.categoria_id, nombre: c.nombre, precio: precioDe(c) }))
      : evento.categorias_socio.map((c) => ({ id: c.id, nombre: c.nombre, precio: null }))

  // Tarifa de referencia para "Otros" (con costo): la más alta disponible para
  // el tipo de participante. null si el evento no tiene ninguna tarifa cargada.
  const preciosDisponibles = evento.categorias
    .map((c) => precioDe(c))
    .filter((p): p is number => p != null)
  const precioMaxOtros = preciosDisponibles.length ? Math.max(...preciosDisponibles) : null

  const esOtros = categoriaId === OTROS
  const categoriaSel = evento.categorias.find((c) => c.categoria_id === categoriaId)
  const categoriaImporte = !conCosto
    ? 0
    : esOtros
      ? precioMaxOtros ?? 0
      : categoriaSel
        ? precioDe(categoriaSel) ?? 0
        : 0
  const total = categoriaImporte + transporteImporte + alimentacionImporte
  // Puede ofrecer "pago por transferencia" si el evento publica datos de depósito
  // y la inscripción tiene algún costo (si no, sólo reserva de cupo).
  const puedeTransferir =
    !!evento.datos_deposito && (conCosto || transporteImporte > 0 || alimentacionImporte > 0)

  if (!evento.abierto) {
    return (
      <div className="card p-8 text-center rise">
        <p className="font-display text-2xl font-medium mb-2">Inscripciones cerradas</p>
        <p className="text-ink-2">{evento.motivo_cerrado}</p>
      </div>
    )
  }

  if (resultado) {
    return (
      <div className="card p-8 rise">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 className="text-status-ok" size={28} />
          <h2 className="font-display text-3xl font-medium">¡Listo!</h2>
        </div>
        <p className="text-ink-2 mb-6">
          {resultado.modalidad === 'pago_transferencia' ? (
            <>Tu inscripción a <strong>{evento.nombre}</strong> quedó registrada. Realizá la transferencia con los datos de abajo para confirmar tu lugar.</>
          ) : (
            <>Reservaste tu cupo para <strong>{evento.nombre}</strong>. Coordiná el pago con la organización para confirmar la inscripción.</>
          )}
        </p>
        <dl className="font-mono text-sm space-y-2 border-t border-line pt-4">
          {resultado.numero && (
            <div className="flex justify-between">
              <dt className="text-ink-3">N° de inscripción</dt>
              <dd className="font-semibold">{resultado.numero}</dd>
            </div>
          )}
          {resultado.categoria_nombre && (
            <div className="flex justify-between">
              <dt className="text-ink-3">Categoría</dt>
              <dd>{resultado.categoria_nombre} · {resultado.tipo_participante === 'socio' ? 'Socio' : 'No socio'}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-3">Inscripción</dt>
            <dd>{formatImporte(resultado.importe, resultado.moneda_codigo)}</dd>
          </div>
          {resultado.lleva_transporte && (
            <div className="flex justify-between">
              <dt className="text-ink-3">Transporte</dt>
              <dd>
                {resultado.transporte_importe > 0
                  ? formatImporte(resultado.transporte_importe, resultado.moneda_codigo)
                  : 'Sin costo'}
              </dd>
            </div>
          )}
          {resultado.lleva_alimentacion && (
            <div className="flex justify-between">
              <dt className="text-ink-3">Alimentación</dt>
              <dd>
                {resultado.alimentacion_tipo ? `${resultado.alimentacion_tipo} · ` : ''}
                {resultado.alimentacion_importe > 0
                  ? formatImporte(resultado.alimentacion_importe, resultado.moneda_codigo)
                  : 'Sin costo'}
              </dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 mt-1">
            <dt className="text-ink-3 font-semibold">Total</dt>
            <dd className="font-semibold">{formatImporte(resultado.total, resultado.moneda_codigo)}</dd>
          </div>
        </dl>

        {resultado.modalidad === 'pago_transferencia' && resultado.datos_deposito && (
          <div className="mt-6 rounded-xl border border-ink bg-paper-2 p-5">
            <p className="flex items-center gap-2 label-mono mb-3">
              <Landmark size={15} /> Datos para la transferencia
            </p>
            <p className="font-mono text-sm text-ink-1 whitespace-pre-line">
              {resultado.datos_deposito}
            </p>
            <dl className="font-mono text-sm space-y-1.5 border-t border-line pt-3 mt-3">
              <div className="flex justify-between">
                <dt className="text-ink-3">Importe a transferir</dt>
                <dd className="font-semibold">{formatImporte(resultado.total, resultado.moneda_codigo)}</dd>
              </div>
              {resultado.numero && (
                <div className="flex justify-between">
                  <dt className="text-ink-3">Referencia</dt>
                  <dd className="font-semibold">{resultado.numero}</dd>
                </div>
              )}
            </dl>
            <p className="text-[12px] text-ink-3 mt-3">
              Indicá la referencia en la transferencia para que podamos identificar tu pago.
            </p>
          </div>
        )}

        {evento.texto_despues && (
          <p className="text-ink-3 text-sm mt-6 whitespace-pre-line">{evento.texto_despues}</p>
        )}
        <button type="button" className="btn-primary w-full mt-6" onClick={cerrarFormulario}>
          <X size={16} />
          Cerrar Formulario
        </button>
      </div>
    )
  }

  async function verificar() {
    const doc = documento.trim()
    if (doc.replace(/[\s.\-]/g, '').length < 6) {
      toast.error('Ingresá una cédula válida')
      return
    }
    setVerificando(true)
    try {
      const res = await fetch(`/api/eventos/${evento.slug}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: doc }),
      })
      const data = (await res.json()) as ResolucionParticipante & { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo verificar')
        return
      }
      setResuelto(data)
      setCategoriaOtros('')
      // Pre-seleccionar la categoría que el socio tiene definida en la BD, si
      // está disponible en el evento (y con costo, con tarifa para su tipo).
      let preseleccion = ''
      if (data.categoria_id) {
        if (conCosto) {
          const c = evento.categorias.find((x) => x.categoria_id === data.categoria_id)
          const precio = c
            ? data.tipo_participante === 'socio'
              ? c.precio_socio
              : c.precio_no_socio
            : null
          if (c && precio != null) preseleccion = data.categoria_id
        } else if (evento.categorias_socio.some((x) => x.id === data.categoria_id)) {
          preseleccion = data.categoria_id
        }
      }
      setCategoriaId(preseleccion)
      setLlevaAlimentacion(false)
      setAlimentacionTipo('')
      setAlimentacionOtros('')
      if (data.encontrado) {
        setNombre(data.nombre ?? '')
        setApellido(data.apellido ?? '')
        setMail(data.mail ?? '')
        if (data.tipo_participante === 'no_socio') {
          toast('Socio con cuotas pendientes — se aplica tarifa No socio', { icon: '⚠️' })
        } else {
          toast.success('Te encontramos en el registro')
        }
      } else {
        toast('No estás en el registro — completá tus datos', { icon: '📝' })
      }
    } catch {
      toast.error('Error de conexión')
    } finally {
      setVerificando(false)
    }
  }

  async function enviar(modalidad: ModalidadInscripcion) {
    if (!nombre.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    if (!categoriaId) {
      toast.error('Elegí una categoría')
      return
    }
    if (esOtros && !categoriaOtros.trim()) {
      toast.error('Escribí tu categoría')
      return
    }
    // Tipo de alimentación obligatorio si el evento ofrece opciones y se reserva.
    const alimTipoFinal = llevaAlimentacion
      ? alimentacionTipo === ALIM_OTROS
        ? alimentacionOtros.trim()
        : alimentacionTipo
      : ''
    if (alim.disponible && llevaAlimentacion && alim.opciones.length > 0 && !alimTipoFinal) {
      toast.error('Elegí el tipo de alimentación')
      return
    }
    setEnviando(true)
    try {
      const res = await fetch(`/api/eventos/${evento.slug}/inscribir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documento: documento.trim(),
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          mail: mail.trim(),
          telefono: telefono.trim(),
          categoria_id: esOtros ? '' : categoriaId,
          categoria_otros: esOtros ? categoriaOtros.trim() : '',
          lleva_transporte: llevaTransporte,
          lleva_alimentacion: llevaAlimentacion,
          alimentacion_tipo: alimTipoFinal,
          modalidad,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo registrar')
        return
      }
      setResultado(data.inscripcion as Resultado)
    } catch {
      toast.error('Error de conexión')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rise space-y-8">
      {/* Paso 1 — Cédula */}
      <div>
        <label htmlFor="documento" className="label-mono block mb-1">Cédula</label>
        <div className="flex items-end gap-3">
          <input
            id="documento"
            inputMode="numeric"
            className="field"
            placeholder="1.234.567-8"
            value={documento}
            onChange={(e) => {
              setDocumento(e.target.value)
              setResuelto(null)
            }}
            disabled={verificando}
          />
          <button type="button" className="btn-primary shrink-0" onClick={verificar} disabled={verificando}>
            {verificando ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {verificando ? 'Buscando…' : 'Verificar'}
          </button>
        </div>
      </div>

      {/* Paso 2 — Datos + categoría (tras verificar) */}
      {resuelto && (
        <form
          className="space-y-7"
          onSubmit={(e) => {
            e.preventDefault()
            // Enter: si no hay opción de transferencia, confirma como reserva.
            if (!puedeTransferir) enviar('reserva')
          }}
        >
          {resuelto.encontrado ? (
            resuelto.tipo_participante === 'no_socio' ? (
              <p className="flex items-start gap-2 text-sm text-status-warn font-mono">
                <Info size={15} className="mt-0.5 shrink-0" />
                Sos socio pero figurás con {resuelto.cuotas_pendientes} cuota
                {resuelto.cuotas_pendientes === 1 ? '' : 's'} pendiente
                {resuelto.cuotas_pendientes === 1 ? '' : 's'} — se aplica tarifa <strong>No socio</strong>.
              </p>
            ) : (
              <p className="text-sm text-status-ok font-mono">✓ Socio al día — Evento con costo bonificado</p>
            )
          ) : (
            <p className="text-sm text-ink-2 font-mono">Registrándote como No socio.</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label htmlFor="nombre" className="label-mono block mb-1">Nombre</label>
              <input id="nombre" className="field" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="apellido" className="label-mono block mb-1">Apellido</label>
              <input id="apellido" className="field" value={apellido} onChange={(e) => setApellido(e.target.value)} />
            </div>
            <div>
              <label htmlFor="mail" className="label-mono block mb-1">Email</label>
              <input id="mail" type="email" className="field" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="tu@correo.com" />
            </div>
            <div>
              <label htmlFor="telefono" className="label-mono block mb-1">Teléfono</label>
              <input id="telefono" inputMode="tel" className="field" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="099 123 456" />
            </div>
          </div>

          <fieldset>
            <legend className="label-mono mb-3">
              Categoría{conCosto ? ` · tarifa ${tipo === 'socio' ? 'Socio' : 'No socio'}` : ''}
            </legend>
            <div className="space-y-3">
              {opcionesCategoria.map((c) => {
                // Sólo se deshabilita por falta de precio en eventos con costo.
                const disabled = conCosto && c.precio == null
                const selected = categoriaId === c.id
                return (
                  <label
                    key={c.id}
                    className={[
                      'flex items-center justify-between gap-4 p-4 rounded-xl border cursor-pointer transition',
                      disabled
                        ? 'border-line opacity-50 cursor-not-allowed'
                        : selected
                          ? 'border-ink bg-paper-2 shadow-[2px_2px_0_var(--color-ink)]'
                          : 'border-line hover:border-ink',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="categoria"
                        className="accent-amber-deep"
                        value={c.id}
                        checked={selected}
                        disabled={disabled}
                        onChange={() => setCategoriaId(c.id)}
                      />
                      <span className="font-medium">{c.nombre}</span>
                    </div>
                    {conCosto && (
                      <span className="font-mono font-semibold">
                        {c.precio != null ? formatImporte(c.precio, evento.moneda_codigo) : '—'}
                      </span>
                    )}
                  </label>
                )
              })}

              {/* Otros — categoría libre escrita por el participante */}
              <label
                className={[
                  'flex items-center justify-between gap-4 p-4 rounded-xl border cursor-pointer transition',
                  esOtros
                    ? 'border-ink bg-paper-2 shadow-[2px_2px_0_var(--color-ink)]'
                    : 'border-line hover:border-ink',
                ].join(' ')}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="categoria"
                    className="accent-amber-deep"
                    value={OTROS}
                    checked={esOtros}
                    onChange={() => setCategoriaId(OTROS)}
                  />
                  <span className="font-medium">Otros</span>
                </div>
                {conCosto && precioMaxOtros != null && (
                  <span className="font-mono font-semibold">
                    {formatImporte(precioMaxOtros, evento.moneda_codigo)}
                  </span>
                )}
              </label>

              {esOtros && (
                <div className="pl-4">
                  <input
                    className="field"
                    placeholder="Escribí tu categoría"
                    value={categoriaOtros}
                    onChange={(e) => setCategoriaOtros(e.target.value)}
                    maxLength={60}
                    autoFocus
                  />
                  {conCosto && precioMaxOtros != null && (
                    <p className="mt-2 text-[11px] font-mono text-ink-3">
                      Se aplica la tarifa {tipo === 'socio' ? 'Socio' : 'No socio'} más alta del evento
                      ({formatImporte(precioMaxOtros, evento.moneda_codigo)}).
                    </p>
                  )}
                </div>
              )}
            </div>
          </fieldset>

          {transp.disponible && (
            <div className="border-t border-line pt-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-amber-deep w-4 h-4 mt-1"
                  checked={llevaTransporte}
                  onChange={(e) => setLlevaTransporte(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Necesito transporte</span>
                  {transp.descripcion && (
                    <span className="block text-sm text-ink-2 mt-0.5">{transp.descripcion}</span>
                  )}
                  <span className="block text-sm font-mono text-ink-2 mt-0.5">
                    {transp.con_costo
                      ? formatImporte(
                          tipo === 'socio' ? transp.importe_socio : transp.importe_no_socio,
                          evento.moneda_codigo,
                        )
                      : 'Sin costo'}
                  </span>
                </span>
              </label>
            </div>
          )}

          {alim.disponible && (
            <div className="border-t border-line pt-5 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-amber-deep w-4 h-4 mt-1"
                  checked={llevaAlimentacion}
                  onChange={(e) => setLlevaAlimentacion(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Reservar alimentación</span>
                  {alim.descripcion && (
                    <span className="block text-sm text-ink-2 mt-0.5">{alim.descripcion}</span>
                  )}
                  <span className="block text-sm font-mono text-ink-2 mt-0.5">
                    {alim.con_costo
                      ? formatImporte(
                          tipo === 'socio' ? alim.importe_socio : alim.importe_no_socio,
                          evento.moneda_codigo,
                        )
                      : 'Sin costo'}
                  </span>
                </span>
              </label>

              {llevaAlimentacion && alim.opciones.length > 0 && (
                <div className="pl-7">
                  <label htmlFor="alim-tipo" className="label-mono block mb-1">Tipo de alimentación *</label>
                  <select
                    id="alim-tipo"
                    className="field"
                    value={alimentacionTipo}
                    onChange={(e) => setAlimentacionTipo(e.target.value)}
                  >
                    <option value="">— Elegir —</option>
                    {alim.opciones.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                    <option value={ALIM_OTROS}>Otros</option>
                  </select>
                  {alimentacionTipo === ALIM_OTROS && (
                    <input
                      className="field mt-2"
                      placeholder="Especificá tu preferencia"
                      value={alimentacionOtros}
                      onChange={(e) => setAlimentacionOtros(e.target.value)}
                      maxLength={60}
                      autoFocus
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {(conCosto || transporteImporte > 0 || alimentacionImporte > 0) && (
            <div className="flex justify-between items-baseline border-t border-line pt-4">
              <span className="label-mono">Total</span>
              <span className="font-mono text-xl font-semibold">
                {formatImporte(total, evento.moneda_codigo)}
              </span>
            </div>
          )}

          {puedeTransferir ? (
            <div className="space-y-3 border-t border-line pt-5">
              <p className="label-mono">¿Cómo querés registrarte?</p>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => enviar('pago_transferencia')}
                disabled={enviando}
              >
                {enviando ? <Loader2 className="animate-spin" size={16} /> : <Landmark size={16} />}
                Inscribirme y pagar por transferencia
              </button>
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => enviar('reserva')}
                disabled={enviando}
              >
                <CalendarClock size={16} />
                Reservar cupo (pago después)
              </button>
              <p className="text-[12px] text-ink-3 text-center">
                Con “pagar por transferencia” te mostramos la cuenta y el importe para depositar.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => enviar('reserva')}
              disabled={enviando}
            >
              {enviando ? <Loader2 className="animate-spin" size={16} /> : <Ticket size={16} />}
              {enviando ? 'Registrando…' : 'Confirmar inscripción'}
            </button>
          )}

          <div className="text-center">
            <button
              type="button"
              className="btn-ghost"
              onClick={cerrarFormulario}
              disabled={enviando}
            >
              <X size={15} />
              Cerrar Formulario
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
