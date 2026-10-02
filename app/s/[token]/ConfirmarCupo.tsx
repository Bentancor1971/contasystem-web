'use client'

/**
 * Los dos botones de /s/[token]. Confirmar es un clic; rechazar pide una
 * segunda confirmación, porque no tiene vuelta atrás desde la web (el cupo
 * pasa al siguiente y un cambio sólo lo hace la secretaría).
 */

import { useState } from 'react'
import { MENSAJE_ERROR, type RespuestaCupo } from '@/lib/sorteo-confirmacion-types'

type Paso = 'elegir' | 'seguro_rechazo' | 'enviando' | RespuestaCupo

export function ConfirmarCupo({
  token,
  venceTexto,
  preseleccion,
}: {
  token: string
  venceTexto: string
  /** Qué botón tocó en el mail. Rechazar arranca en la pregunta de seguridad. */
  preseleccion: 'confirmar' | 'rechazar' | null
}) {
  const [paso, setPaso] = useState<Paso>(preseleccion === 'rechazar' ? 'seguro_rechazo' : 'elegir')
  const [error, setError] = useState<string | null>(null)
  // Si sale la constancia por mail (fase 10), la pantalla lo dice.
  const [constancia, setConstancia] = useState(false)

  async function responder(acepta: boolean) {
    const volverA: Paso = acepta ? 'elegir' : 'seguro_rechazo'
    setPaso('enviando')
    setError(null)
    try {
      const res = await fetch(`/api/sorteo/${encodeURIComponent(token)}/responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acepta }),
      })
      const d = (await res.json()) as { ok?: boolean; respuesta?: RespuestaCupo; error?: string; constancia?: boolean }
      if (res.status === 429) {
        setError('Demasiados intentos. Esperá un momento y volvé a probar.')
        setPaso(volverA)
        return
      }
      if (d.ok && d.respuesta) {
        setConstancia(!!d.constancia)
        setPaso(d.respuesta)
        return
      }
      if (d.error === 'ya_respondio' && d.respuesta) {
        setPaso(d.respuesta)
        return
      }
      setError(MENSAJE_ERROR[d.error ?? ''] ?? 'No se pudo registrar tu respuesta. Probá de nuevo en un momento.')
      setPaso(volverA)
    } catch {
      setError('No hay conexión. Probá de nuevo en un momento.')
      setPaso(volverA)
    }
  }

  if (paso === 'confirmo') {
    return (
      <div className="voto-aviso voto-aviso--ok" role="status">
        <h2 className="font-display text-2xl font-medium leading-tight mb-2">¡Listo, tu cupo está confirmado!</h2>
        <p className="text-ink-2 text-[17px] leading-relaxed">
          En los próximos días nos comunicamos con vos para coordinar.
          {constancia ? ' Te enviamos una constancia por mail.' : ''} Ya podés cerrar esta página.
        </p>
      </div>
    )
  }
  if (paso === 'rechazo') {
    return (
      <div className="voto-aviso voto-aviso--medio" role="status">
        <h2 className="font-display text-2xl font-medium leading-tight mb-2">Registramos que no vas a usar el cupo</h2>
        <p className="text-ink-2 text-[17px] leading-relaxed">
          Gracias por avisar: el cupo se asignará a un suplente del sorteo.
          {constancia ? ' Te enviamos una constancia por mail.' : ''}
        </p>
      </div>
    )
  }

  const enviando = paso === 'enviando'

  return (
    <div>
      {paso === 'seguro_rechazo' ? (
        <>
          <p className="text-ink text-[17px] leading-relaxed">
            <strong>¿Seguro que no vas a usar el cupo?</strong> Si lo rechazás, se asignará a un suplente del
            sorteo, y desde acá no se puede deshacer.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button type="button" className="btn-primary w-full" disabled={enviando} onClick={() => responder(false)}>
              Sí, rechazo el cupo
            </button>
            <button type="button" className="btn-secondary w-full" disabled={enviando} onClick={() => setPaso('elegir')}>
              No, volver
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-ink-2 text-[17px] leading-relaxed">
            Para quedarte con el cupo, confirmalo hasta el <strong>{venceTexto}</strong> inclusive.
          </p>
          <p className="text-ink-2 text-[17px] leading-relaxed mt-3">
            Si no podés ir, tocá «Rechazar cupo» y se asignará a un suplente del sorteo.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button type="button" className="btn-primary w-full" disabled={enviando} onClick={() => responder(true)}>
              {enviando ? 'Registrando…' : 'Confirmar cupo'}
            </button>
            <button type="button" className="btn-secondary w-full" disabled={enviando} onClick={() => setPaso('seguro_rechazo')}>
              Rechazar cupo
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="mt-4 text-[15px] text-status-no" role="alert">{error}</p>
      )}
    </div>
  )
}
