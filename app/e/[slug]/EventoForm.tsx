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
import { CheckCircle2, Loader2, Search, Ticket, Info } from 'lucide-react'
import type { EventoPublico, ResolucionParticipante, TipoParticipante } from '@/lib/eventos-types'

function formatImporte(n: number, moneda: string): string {
  const nf = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${moneda} ${nf.format(n)}`
}

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
  total: number
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
  const [llevaTransporte, setLlevaTransporte] = useState(false)

  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const tipo: TipoParticipante = resuelto?.tipo_participante ?? 'no_socio'
  const conCosto = evento.tipo === 'con_costo'

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
  const categoriaSel = evento.categorias.find((c) => c.categoria_id === categoriaId)
  const categoriaImporte = categoriaSel ? precioDe(categoriaSel) ?? 0 : 0
  const total = categoriaImporte + transporteImporte

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
          Tu inscripción a <strong>{evento.nombre}</strong> quedó registrada.
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
          <div className="flex justify-between border-t border-line pt-2 mt-1">
            <dt className="text-ink-3 font-semibold">Total</dt>
            <dd className="font-semibold">{formatImporte(resultado.total, resultado.moneda_codigo)}</dd>
          </div>
        </dl>
        {evento.texto_despues && (
          <p className="text-ink-3 text-sm mt-6 whitespace-pre-line">{evento.texto_despues}</p>
        )}
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
      setCategoriaId('')
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

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    if (conCosto && !categoriaId) {
      toast.error('Elegí una categoría')
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
          categoria_id: categoriaId,
          lleva_transporte: llevaTransporte,
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
        <form className="space-y-7" onSubmit={enviar}>
          {resuelto.encontrado ? (
            resuelto.tipo_participante === 'no_socio' ? (
              <p className="flex items-start gap-2 text-sm text-status-warn font-mono">
                <Info size={15} className="mt-0.5 shrink-0" />
                Sos socio pero figurás con {resuelto.cuotas_pendientes} cuota
                {resuelto.cuotas_pendientes === 1 ? '' : 's'} pendiente
                {resuelto.cuotas_pendientes === 1 ? '' : 's'} — se aplica tarifa <strong>No socio</strong>.
              </p>
            ) : (
              <p className="text-sm text-status-ok font-mono">✓ Socio al día — tarifa preferencial</p>
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

          {conCosto && (
            <fieldset>
              <legend className="label-mono mb-3">
                Categoría · tarifa {tipo === 'socio' ? 'Socio' : 'No socio'}
              </legend>
              <div className="space-y-3">
                {evento.categorias.map((c) => {
                  const precio = precioDe(c)
                  const disabled = precio == null
                  const selected = categoriaId === c.categoria_id
                  return (
                    <label
                      key={c.categoria_id}
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
                          value={c.categoria_id}
                          checked={selected}
                          disabled={disabled}
                          onChange={() => setCategoriaId(c.categoria_id)}
                        />
                        <span className="font-medium">{c.nombre}</span>
                      </div>
                      <span className="font-mono font-semibold">
                        {precio != null ? formatImporte(precio, evento.moneda_codigo) : '—'}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}

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

          {(conCosto || transporteImporte > 0) && (
            <div className="flex justify-between items-baseline border-t border-line pt-4">
              <span className="label-mono">Total</span>
              <span className="font-mono text-xl font-semibold">
                {formatImporte(total, evento.moneda_codigo)}
              </span>
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={enviando}>
            {enviando ? <Loader2 className="animate-spin" size={16} /> : <Ticket size={16} />}
            {enviando ? 'Registrando…' : 'Confirmar inscripción'}
          </button>
        </form>
      )}
    </div>
  )
}
