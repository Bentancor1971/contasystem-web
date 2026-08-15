'use client'

/**
 * Entrar al puesto: código de la planilla + PIN dictado. Nada más.
 *
 * El campo del código es amable con quien copia de un papel —mayúsculas
 * automáticas, y espacios y guiones se aceptan sin quejarse, que el RPC los
 * ignora—. El alfabeto no tiene 0/O ni 1/I/L justamente para que no haya que
 * adivinar.
 *
 * La sesión no vuelve en la respuesta: la escribe el route handler en una
 * cookie httpOnly. Este componente nunca la ve, y por eso no puede filtrarla.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { mensajeErrorMesa, type ErrorMesa, type MensajeMesa } from '@/lib/mesa-types'

export function LoginMesa() {
  const router = useRouter()
  const [codigo, setCodigo] = useState('')
  const [pin, setPin] = useState('')
  const [yendo, setYendo] = useState(false)
  const [error, setError] = useState<MensajeMesa | null>(null)

  const listo = codigo.trim() !== '' && pin.trim() !== ''

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (yendo || !listo) return
    setYendo(true)
    setError(null)

    try {
      const r = await fetch('/api/mesa/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, pin: pin.trim() }),
        cache: 'no-store',
      })
      const d = (await r.json()) as { ok?: true } | ErrorMesa

      if (r.status === 429) {
        setError({
          titulo: 'Demasiados intentos desde esta conexión',
          detalle: 'Esperá unos minutos y volvé a probar.',
        })
      } else if ('ok' in d && d.ok) {
        // `replace` y no `push`: volver atrás desde el padrón no tiene que
        // devolver a un formulario con el PIN escrito.
        router.replace('/mesa/padron')
        return
      } else {
        setError(mensajeErrorMesa(d as ErrorMesa))
        setPin('')
      }
    } catch {
      setError({
        titulo: 'No pudimos entrar',
        detalle: 'Puede ser la conexión del local. Volvé a probar en un momento.',
      })
    }
    setYendo(false)
  }

  return (
    <form onSubmit={enviar} className="rise">
      <label htmlFor="codigo" className="label-mono block mb-2">
        Código de la mesa
      </label>
      <input
        id="codigo"
        name="codigo"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        maxLength={40}
        placeholder="GK7M2XQZNB"
        enterKeyHint="next"
        className="field text-center font-mono text-lg tracking-[0.2em]"
      />

      <label htmlFor="pin" className="label-mono block mb-2 mt-6">
        PIN
      </label>
      <input
        id="pin"
        name="pin"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        // `numeric` y no `tel`: el teclado numérico sin las teclas de llamada.
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder="······"
        enterKeyHint="go"
        className="field text-center font-mono text-2xl tracking-[0.4em]"
      />
      <p className="text-ink-3 text-sm leading-relaxed mt-3">
        El PIN de presidente es el único que puede cargar el recuento y cerrar la urna.
      </p>

      {error && (
        <div className="voto-aviso voto-aviso--alto mt-5" role="alert">
          <h2 className="font-display text-xl font-medium leading-tight mb-1">{error.titulo}</h2>
          <p className="text-ink-2 text-[16px] leading-relaxed">{error.detalle}</p>
        </div>
      )}

      <button type="submit" disabled={yendo || !listo} className="btn-primary w-full mt-6">
        {yendo ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}

/** Salir del puesto en este dispositivo. Vive acá porque necesita el router. */
export function BotonSalir({ etiqueta = 'Salir' }: { etiqueta?: string }) {
  const router = useRouter()
  const [yendo, setYendo] = useState(false)

  return (
    <button
      type="button"
      className="btn-ghost text-sm shrink-0"
      disabled={yendo}
      onClick={async () => {
        setYendo(true)
        try {
          await fetch('/api/mesa/salir', { method: 'POST', cache: 'no-store' })
        } catch {
          // Si el POST no llegó, la cookie sigue puesta. Se refresca igual: la
          // pantalla siguiente dirá qué pasa en vez de mentir un "listo".
        }
        router.replace('/mesa')
        router.refresh()
      }}
    >
      {yendo ? 'Saliendo…' : etiqueta}
    </button>
  )
}
