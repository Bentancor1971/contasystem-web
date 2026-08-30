'use client'

/**
 * Último recurso: sólo se muestra si falla el layout raíz (fuentes, Toaster).
 * Tiene que traer su propio <html>/<body> y no puede depender de globals.css,
 * por eso los estilos van inline y en los colores del design system.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fdfcf7',
          color: '#1a1814',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, marginBottom: 12 }}>No pudimos cargar la página</h1>
          <p style={{ color: '#4a4640', lineHeight: 1.5 }}>
            Probá de nuevo en unos segundos. Si sigue igual, avisale a la organización.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: '10px 18px',
              background: '#f59e0b',
              color: '#1a1814',
              border: 0,
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Volver a intentar
          </button>
          {error.digest && (
            <p style={{ fontSize: 10, color: '#8c8780', marginTop: 20 }}>ref. {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  )
}
