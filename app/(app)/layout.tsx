import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { AppToaster } from '@/components/AppToaster'

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <AppToaster />
    </>
  )
}
