'use client'

import { useEffect } from 'react'
import { Highlight } from '@/components/Highlight'

/**
 * Error boundary de todo el árbol (salvo el layout raíz, que cubre
 * global-error.tsx). Antes, una consulta a Supabase que fallaba durante el
 * render de `/e/{slug}` o `/v/{token}` mostraba la pantalla de error por
 * defecto de Next, en inglés y sin marca.
 *
 * El mensaje técnico va a la consola, nunca a la pantalla: en las rutas
 * públicas lo lee un socio, y en las privadas un operador que igual no puede
 * hacer nada con "PGRST301".
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[error boundary]', error)
  }, [error])

  return (
    <main className="min-h-screen grain flex items-center justify-center p-6">
      <div className="max-w-md text-center rise">
        <p className="label-mono mb-3">Algo falló</p>
        <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[0.95] mb-5">
          No pudimos <Highlight thin>cargar</Highlight> esta página
        </h1>
        <p className="text-ink-2 leading-relaxed">
          Puede ser un problema momentáneo de conexión. Probá de nuevo en unos
          segundos; si sigue igual, avisale a la organización.
        </p>
        <button type="button" onClick={reset} className="btn-primary mt-8 mx-auto">
          Volver a intentar
        </button>
        {error.digest && (
          <p className="font-mono text-[10px] text-ink-3 mt-6">ref. {error.digest}</p>
        )}
      </div>
    </main>
  )
}
