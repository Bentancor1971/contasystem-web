import type { ReactNode } from 'react'
import { AppToaster } from '@/components/AppToaster'

/** /login usa `toast`; el Toaster ya no está en el layout raíz. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AppToaster />
    </>
  )
}
