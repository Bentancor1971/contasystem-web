import type { ReactNode } from 'react'
import { AppToaster } from '@/components/AppToaster'

/**
 * La inscripción a eventos usa `toast` (EventoForm, RegistrarPago), así que
 * necesita el Toaster — que ya no está en el layout raíz (ver app/layout.tsx).
 * Las otras rutas públicas (/a, /c, /v, /p, /mesa) no lo montan a propósito.
 */
export default function EventoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AppToaster />
    </>
  )
}
