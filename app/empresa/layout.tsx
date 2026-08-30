import type { ReactNode } from 'react'
import { AppToaster } from '@/components/AppToaster'

/** /empresa usa `toast`; el Toaster ya no está en el layout raíz. */
export default function EmpresaLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AppToaster />
    </>
  )
}
