'use client'

import { Toaster } from 'react-hot-toast'

/**
 * El Toaster con el estilo de la marca, para montarlo SÓLO en los layouts
 * cuyas pantallas usan `toast`. Vivía en el layout raíz y con eso
 * `react-hot-toast` + goober (~6 KB gzip) viajaban también a `/a/{token}`,
 * `/c/{token}`, `/v/{token}`, `/p/{token}` y `/mesa`, que no lo llaman nunca.
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      toastOptions={{
        style: {
          background: 'var(--color-ink)',
          color: 'var(--color-paper)',
          padding: '12px 18px',
          borderRadius: '8px',
          fontSize: '14px',
          fontFamily: 'var(--font-sans)',
          boxShadow: '0 12px 32px rgba(26,24,20,0.30)',
        },
        success: {
          iconTheme: { primary: 'var(--color-amber)', secondary: 'var(--color-ink)' },
        },
        error: {
          iconTheme: { primary: 'var(--color-status-no)', secondary: 'var(--color-paper)' },
        },
      }}
    />
  )
}
