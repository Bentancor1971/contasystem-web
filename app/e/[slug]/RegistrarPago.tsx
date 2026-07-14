'use client'

/**
 * "Ya me inscribí — registrar mi pago".
 *
 * Para quien tiene una PREINSCRIPCIÓN impaga y después transfirió: deja una
 * DECLARACIÓN de pago (pagos_evento_remoto, estado 'pendiente') para que la
 * organización la concilie. No confirma el pago por sí solo. El server manda el
 * acuse por mail al guardar (a la casilla de la inscripción, no a una elegida acá).
 *
 * Dos entradas, un mismo componente:
 *   • Como MODALIDAD ("vengo sólo a registrar mi pago"): pide la cédula, la
 *     verifica contra el lookup y muestra el registro encontrado (con el nombre
 *     ENMASCARADO, igual que al inscribirse) antes de pedir la referencia.
 *   • Dentro del aviso de "ya tenés una preinscripción" (EventoForm): la cédula
 *     ya se verificó y el registro ya está a la vista, así que sólo pide la
 *     referencia.
 *
 * Nunca se le ofrece a quien ya declaró el pago al inscribirse: no tiene nada
 * que registrar.
 */

import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Landmark, Loader2, Search, X } from 'lucide-react'
import type { InscripcionPrevia, ResolucionPublica } from '@/lib/eventos-types'
import { simboloMoneda } from '@/lib/format'

interface Resultado {
  numero: string | null
  total: number
  moneda_codigo: string
  actualizado: boolean
  /** Mail enmascarado al que salió el acuse. null si no se pudo enviar. */
  mail_mask: string | null
}

function formatImporte(n: number, moneda: string): string {
  const nf = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${simboloMoneda(moneda)} ${nf.format(n)}`
}

/** Sólo la preinscripción impaga tiene un pago para declarar. */
function tienePagoParaDeclarar(p: InscripcionPrevia): boolean {
  return p.modalidad === 'reserva' && p.estado === 'pendiente'
}

/** Por qué NO se le pide la referencia a este registro. */
function motivoSinPago(p: InscripcionPrevia): string {
  if (p.estado === 'importado') {
    return 'Tu inscripción ya está confirmada por la organización. No tenés que registrar ningún pago.'
  }
  if (p.estado === 'rechazado') {
    return 'La organización rechazó esta inscripción. Comunicate con ellos para regularizar tu situación.'
  }
  return 'Ya declaraste el pago de esta inscripción. La organización lo va a verificar contra el movimiento bancario.'
}

export function RegistrarPago({
  slug,
  documento: documentoFijo,
  onVolver,
}: {
  slug: string
  /**
   * Cédula ya verificada. Si viene, no se pide ni se vuelve a verificar (entrada
   * desde el aviso de inscripción previa, que ya muestra el registro).
   */
  documento?: string
  /** Volver a la pantalla de elección (sólo en la entrada como modalidad). */
  onVolver?: () => void
}) {
  const cedulaDada = documentoFijo != null

  // Con cédula dada arranca colapsado (es una opción más dentro del aviso); sin
  // cédula ya es la pantalla elegida, así que arranca abierto.
  const [abierto, setAbierto] = useState(!cedulaDada)
  const [documento, setDocumento] = useState('')
  const [verificando, setVerificando] = useState(false)
  /** Registro encontrado al verificar la cédula (sólo en la entrada como modalidad). */
  const [previa, setPrevia] = useState<InscripcionPrevia | null>(null)
  const [referencia, setReferencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const doc = (documentoFijo ?? documento).trim()
  // Sin cédula dada hay que verificarla primero: la referencia recién se pide
  // cuando sabemos que hay un registro con un pago pendiente.
  const puedeIngresarReferencia = cedulaDada || (previa != null && tienePagoParaDeclarar(previa))

  async function verificar() {
    if (documento.replace(/[\s.\-]/g, '').length < 6) {
      toast.error('Ingresá una cédula válida')
      return
    }
    setVerificando(true)
    try {
      const res = await fetch(`/api/eventos/${slug}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: documento.trim() }),
      })
      const data = (await res.json()) as ResolucionPublica & { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo verificar')
        return
      }
      if (!data.inscripcion_previa) {
        toast.error('No encontramos una inscripción con esa cédula en este evento')
        return
      }
      setPrevia(data.inscripcion_previa)
    } catch {
      toast.error('Error de conexión')
    } finally {
      setVerificando(false)
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!puedeIngresarReferencia) return
    if (!referencia.trim()) {
      toast.error('Ingresá la referencia de la transferencia')
      return
    }
    setEnviando(true)
    try {
      const res = await fetch(`/api/eventos/${slug}/pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: doc, referencia: referencia.trim() }),
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

  // ── Registrado ────────────────────────────────────────────────
  if (resultado) {
    const detalle = (
      <>
        <p className="flex items-start gap-2 text-sm text-status-ok">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>
            {resultado.actualizado
              ? 'Actualizamos la referencia de tu pago.'
              : 'Registramos tu declaración de pago.'}{' '}
            La organización la va a verificar contra el movimiento bancario.
          </span>
        </p>
        <dl className="font-mono text-sm space-y-2 mt-4">
          {resultado.numero && (
            <div className="flex justify-between">
              <dt className="text-ink-3">N° de inscripción</dt>
              <dd className="font-semibold">{resultado.numero}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-3">Total de tu inscripción</dt>
            <dd className="font-semibold">
              {formatImporte(resultado.total, resultado.moneda_codigo)}
            </dd>
          </div>
        </dl>
        {resultado.mail_mask && (
          <p className="text-[12px] text-ink-3 mt-4">
            Te enviamos el comprobante a <strong>{resultado.mail_mask}</strong>. Puede tardar unos
            minutos; revisá también el correo no deseado.
          </p>
        )}
      </>
    )
    // Dentro del aviso es un bloque más; como modalidad, es la pantalla entera.
    if (cedulaDada) return <div className="mt-6 border-t border-line pt-5">{detalle}</div>
    return (
      <div className="card p-8 rise">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 className="text-status-ok" size={28} />
          <h2 className="font-display text-3xl font-medium">Pago registrado</h2>
        </div>
        {detalle}
        {onVolver && (
          <button type="button" className="btn-primary w-full mt-6" onClick={onVolver}>
            <X size={16} />
            Cerrar Formulario
          </button>
        )}
      </div>
    )
  }

  // ── Colapsado: sólo en la entrada desde el aviso de inscripción previa ──
  if (!abierto) {
    return (
      <div className="mt-6 border-t border-line pt-5">
        <button type="button" className="btn-ghost" onClick={() => setAbierto(true)}>
          <Landmark size={15} />
          Ya transferí — registrar mi pago
        </button>
      </div>
    )
  }

  const campoReferencia = (
    <>
      <div>
        <label htmlFor="pago-referencia" className="label-mono block mb-1">
          Referencia de la transferencia *
        </label>
        <input
          id="pago-referencia"
          className="field"
          placeholder="N° de comprobante de la transferencia que hiciste"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          maxLength={80}
          disabled={enviando}
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={enviando}>
        {enviando ? <Loader2 className="animate-spin" size={16} /> : <Landmark size={16} />}
        {enviando ? 'Registrando…' : 'Registrar pago'}
      </button>
    </>
  )

  // ── Entrada desde el aviso: la cédula y el registro ya están a la vista ──
  if (cedulaDada) {
    return (
      <form onSubmit={enviar} className="mt-6 border-t border-line pt-5 space-y-5">
        <div>
          <p className="font-medium">Registrar mi pago</p>
          <p className="text-ink-2 text-sm mt-1">
            Dejanos la referencia de la transferencia que hiciste para que la organización pueda
            verificarla y confirmar tu inscripción.
          </p>
        </div>
        {campoReferencia}
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

  // ── Entrada como modalidad: cédula → registro encontrado → referencia ──
  return (
    <form onSubmit={enviar} className="rise space-y-7">
      <div>
        <p className="font-medium">Registrar mi pago</p>
        <p className="text-ink-2 text-sm mt-1">
          Si ya te preinscribiste y transferiste, verificá tu cédula y dejanos la referencia para
          que la organización pueda confirmar tu inscripción.
        </p>
      </div>

      <div>
        <label htmlFor="pago-documento" className="label-mono block mb-1">Cédula</label>
        <div className="flex items-end gap-3">
          <input
            id="pago-documento"
            inputMode="numeric"
            className="field"
            placeholder="1.234.567-2"
            value={documento}
            onChange={(e) => {
              setDocumento(e.target.value)
              // Otra cédula = otro registro: se cierra el paso 2.
              setPrevia(null)
              setReferencia('')
            }}
            disabled={verificando || enviando}
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            onClick={verificar}
            disabled={verificando || enviando}
          >
            {verificando ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {verificando ? 'Buscando…' : 'Verificar'}
          </button>
        </div>
      </div>

      {previa && (
        <div className="space-y-5">
          {/* El registro encontrado, con el nombre ENMASCARADO: alcanza para que
              se reconozca sin exponer el dato en un endpoint público. */}
          <dl className="font-mono text-sm space-y-2 border-t border-line pt-4">
            {previa.nombre_mask && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Inscripto</dt>
                <dd className="text-right font-semibold">{previa.nombre_mask}</dd>
              </div>
            )}
            {previa.numero && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">N° de inscripción</dt>
                <dd className="text-right font-semibold">{previa.numero}</dd>
              </div>
            )}
            {previa.categoria_nombre && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Categoría</dt>
                <dd className="text-right">{previa.categoria_nombre}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-2 mt-1">
              <dt className="text-ink-3 font-semibold">
                {tienePagoParaDeclarar(previa) ? 'Falta abonar' : 'Total'}
              </dt>
              <dd className="font-semibold">
                {formatImporte(previa.total, previa.moneda_codigo)}
              </dd>
            </div>
          </dl>

          {tienePagoParaDeclarar(previa) ? (
            campoReferencia
          ) : (
            <p className="text-sm text-ink-2">{motivoSinPago(previa)}</p>
          )}
        </div>
      )}

      <div className="text-center">
        <button
          type="button"
          className="btn-ghost"
          onClick={onVolver}
          disabled={verificando || enviando}
        >
          <X size={15} />
          Volver
        </button>
      </div>
    </form>
  )
}
