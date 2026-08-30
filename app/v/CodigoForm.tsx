'use client'

/**
 * Entrada por código impreso. Un campo y nada más.
 *
 * Es para quien recibió la credencial en mano en vez de por mail: el desktop
 * imprime una planilla con un `codigo_corto` de 10 caracteres por persona.
 *
 * Dos cosas que este componente NO hace:
 *
 *  1. **No guarda el código.** Ni localStorage, ni cookies, ni analytics. Se usa
 *     y se descarta, igual que el token.
 *  2. **No valida el formato antes de mandar.** El alfabeto del código no tiene
 *     0/O ni 1/I/L justamente para que no haya que adivinar; rechazar de
 *     antemano lo que el RPC igual normaliza sólo sirve para trabar a quien
 *     copia de un papel con espacios o guiones.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Estado = { fase: 'quieto' } | { fase: 'yendo' } | { fase: 'error'; titulo: string; detalle: string }

export function CodigoForm({ contacto }: { contacto: string | null }) {
  const router = useRouter()
  const [codigo, setCodigo] = useState('')
  const [estado, setEstado] = useState<Estado>({ fase: 'quieto' })

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (estado.fase === 'yendo' || !codigo.trim()) return
    setEstado({ fase: 'yendo' })

    try {
      const r = await fetch('/api/votacion/codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
        cache: 'no-store',
      })
      const d = (await r.json()) as
        | { ok: true; token: string }
        | { error: string; email_contacto?: string | null }

      if ('ok' in d && d.ok) {
        // Reemplaza la entrada del historial: volver atrás desde la pantalla de
        // votación no tiene que devolver a un formulario con el código escrito.
        router.replace(`/v/${d.token}`)
        return
      }

      const codigoError = 'error' in d ? d.error : ''
      // Desde 61_, `resolver_codigo` trae el contacto de la elección en el
      // error `no_habilitado`: esta es la única vía de entrada que antes se
      // quedaba sin nadie a quién escribirle (`contacto` llega `null` porque
      // esta página no consulta la base hasta que hay un código).
      const contactoDeLaRespuesta = 'email_contacto' in d ? d.email_contacto : null
      const aQuienEscribir = contactoDeLaRespuesta ?? contacto
      if (r.status === 429) {
        setEstado({
          fase: 'error',
          titulo: 'Demasiados intentos',
          detalle: 'Esperá unos minutos y volvé a probar.',
        })
      } else if (codigoError === 'no_habilitado') {
        setEstado({
          fase: 'error',
          titulo: 'Esa credencial fue dada de baja',
          detalle: aQuienEscribir
            ? `Escribinos a ${aQuienEscribir}.`
            : 'Consultá con la comisión electoral.',
        })
      } else {
        setEstado({
          fase: 'error',
          titulo: 'Ese código no es válido',
          detalle: 'Revisá que esté completo y volvé a probar.',
        })
      }
    } catch {
      setEstado({
        fase: 'error',
        titulo: 'No pudimos verificar el código',
        detalle: 'Puede ser la conexión. Volvé a probar en un momento.',
      })
    }
  }

  return (
    <form onSubmit={enviar} className="rise">
      <label htmlFor="codigo" className="label-mono block mb-2">
        Código de la credencial
      </label>
      <input
        id="codigo"
        name="codigo"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.toUpperCase())}
        // Mayúsculas visuales; el resto lo normaliza el RPC.
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        maxLength={40}
        placeholder="GK7M2XQZNB"
        aria-describedby="codigo-ayuda"
        enterKeyHint="go"
        className="field text-center font-mono text-lg tracking-[0.2em]"
      />
      <p id="codigo-ayuda" className="text-ink-3 text-sm leading-relaxed mt-3">
        Son 10 caracteres. Podés escribirlo con espacios o guiones, y en minúsculas: se entiende
        igual.
      </p>

      {estado.fase === 'error' && (
        <div className="voto-aviso voto-aviso--alto mt-5" role="alert">
          <h2 className="font-display text-2xl font-medium leading-tight mb-2">{estado.titulo}</h2>
          <p className="text-ink-2 text-[17px] leading-relaxed">{estado.detalle}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={estado.fase === 'yendo' || !codigo.trim()}
        className="btn-primary w-full mt-6"
      >
        {estado.fase === 'yendo' ? 'Verificando…' : 'Continuar'}
      </button>
    </form>
  )
}
