'use client'

/**
 * Panel público "Ya me inscribí — registrar mi pago".
 *
 * Para quien reservó el cupo y después transfirió: encuentra su inscripción por
 * cédula y deja una DECLARACIÓN de pago (pagos_evento_remoto, estado 'pendiente')
 * para que la organización la concilie. No confirma el pago por sí solo.
 */

import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, ChevronDown, Landmark, Loader2 } from 'lucide-react'
import { simboloMoneda } from '@/lib/format'

interface Resultado {
  numero: string | null
  total: number
  moneda_codigo: string
  actualizado: boolean
}

export function RegistrarPago({ slug }: { slug: string }) {
  const [abierto, setAbierto] = useState(false)
  const [documento, setDocumento] = useState('')
  const [referencia, setReferencia] = useState('')
  const [importe, setImporte] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (documento.replace(/[\s.\-]/g, '').length < 6) {
      toast.error('Ingresá una cédula válida')
      return
    }
    if (!referencia.trim()) {
      toast.error('Ingresá la referencia de la transferencia')
      return
    }
    setEnviando(true)
    try {
      const res = await fetch(`/api/eventos/${slug}/pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documento: documento.trim(),
          referencia: referencia.trim(),
          importe: importe.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo registrar el pago')
        return
      }
      setResultado(data as Resultado)
    } catch {
      toast.error('Error de conexión')
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    const nf = new Intl.NumberFormat('es-UY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return (
      <div className="card p-6 mt-8 rise">
        <div className="flex items-center gap-3 mb-3">
          <CheckCircle2 className="text-status-ok" size={24} />
          <h2 className="font-display text-2xl font-medium">Pago registrado</h2>
        </div>
        <p className="text-ink-2 text-sm">
          {resultado.actualizado
            ? 'Actualizamos la referencia de tu pago.'
            : 'Registramos tu declaración de pago.'}{' '}
          La organización la va a verificar contra el movimiento bancario.
        </p>
        <dl className="font-mono text-sm space-y-2 border-t border-line pt-4 mt-4">
          {resultado.numero && (
            <div className="flex justify-between">
              <dt className="text-ink-3">N° de inscripción</dt>
              <dd className="font-semibold">{resultado.numero}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-3">Total de tu inscripción</dt>
            <dd className="font-semibold">
              {simboloMoneda(resultado.moneda_codigo)} {nf.format(resultado.total)}
            </dd>
          </div>
        </dl>
      </div>
    )
  }

  if (!abierto) {
    return (
      <div className="mt-8 text-center">
        <button type="button" className="btn-ghost" onClick={() => setAbierto(true)}>
          <Landmark size={15} />
          Ya me inscribí — registrar mi pago
          <ChevronDown size={14} />
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={enviar} className="card p-6 mt-8 rise space-y-5">
      <div>
        <h2 className="font-display text-2xl font-medium">Registrar mi pago</h2>
        <p className="text-ink-2 text-sm mt-1">
          Si reservaste tu cupo y ya transferiste, dejanos la referencia para que podamos
          confirmar tu inscripción.
        </p>
      </div>

      <div>
        <label htmlFor="pago-documento" className="label-mono block mb-1">Cédula</label>
        <input
          id="pago-documento"
          inputMode="numeric"
          className="field"
          placeholder="1.234.567-8"
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          disabled={enviando}
        />
      </div>

      <div>
        <label htmlFor="pago-referencia" className="label-mono block mb-1">
          Referencia de la transferencia
        </label>
        <input
          id="pago-referencia"
          className="field"
          placeholder="N° de comprobante"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          maxLength={80}
          disabled={enviando}
        />
      </div>

      <div>
        <label htmlFor="pago-importe" className="label-mono block mb-1">
          Importe transferido (opcional)
        </label>
        <input
          id="pago-importe"
          inputMode="decimal"
          className="field"
          placeholder="0.00"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          disabled={enviando}
        />
      </div>

      <button type="submit" className="btn-primary w-full" disabled={enviando}>
        {enviando ? <Loader2 className="animate-spin" size={16} /> : <Landmark size={16} />}
        {enviando ? 'Registrando…' : 'Registrar pago'}
      </button>
      <div className="text-center">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setAbierto(false)}
          disabled={enviando}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
