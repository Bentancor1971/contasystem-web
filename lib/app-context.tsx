'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { EmpresaOnline } from '@/lib/types'
import type { PermisosRol, Rol } from '@/lib/roles'

interface AppContextValue {
  empresa: EmpresaOnline
  rol: Rol
  permisos: PermisosRol
  userEmail: string
  userId: string
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue
  children: ReactNode
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error('useApp debe usarse dentro de <AppProvider> (vía AppShell)')
  }
  return ctx
}
