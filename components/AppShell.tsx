'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { Header } from './Header'
import { Sidenav } from './Sidenav'
import { AppProvider } from '@/lib/app-context'
import { getPermisosEfectivos } from '@/lib/permisos'
import type { PermisosRol, Rol } from '@/lib/roles'
import type { EmpresaOnline } from '@/lib/types'

const LS_KEY = 'cs-carga-empresa-id'

interface Bootstrap {
  empresa: EmpresaOnline
  rol: Rol
  permisos: PermisosRol
  userEmail: string
  userId: string
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  // Error de RED (o cualquier falla que no sea "esta empresa no es tuya"):
  // antes cualquier error acá te mandaba a /empresa con el mensaje crudo de
  // PostgREST en un toast. Un problema transitorio no debería sacarte de la
  // pantalla — con "Reintentar" el usuario vuelve a intentar sin recargar.
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)

  const reintentar = useCallback(() => {
    setError(null)
    setIntento((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const empresaId =
        typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null

      if (!empresaId) {
        router.replace('/empresa')
        return
      }

      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/login')
        return
      }

      // P6: un solo Promise.all para las dos cosas que hacían falta antes de
      // mostrar algo (empresa + permisos) — eran 3 consultas en cascada
      // (empresa, rol, rol_permisos); `getPermisosEfectivos` de por sí intenta
      // resumir rol+permisos en un solo viaje con la RPC `mis_permisos`
      // (P4, SQL 63) y sólo si no existe cae a las consultas sueltas.
      const [empRes, permisosResult] = await Promise.all([
        supabase
          .from('empresas_online_remoto')
          .select('*')
          .eq('empresa_id', empresaId)
          // Antes no se miraba `habilitada`: una empresa apagada seguía
          // siendo usable si ya estaba en localStorage.
          .eq('habilitada', 1)
          .single(),
        getPermisosEfectivos(supabase, user.id, empresaId),
      ])

      if (cancelled) return

      if (empRes.error) {
        if (empRes.error.code === 'PGRST116') {
          // 0 filas: no existe, está deshabilitada, o la RLS la esconde
          // porque el user no tiene acceso — en los tres casos la lectura
          // correcta es "no es tuya", no un error para reintentar.
          toast.error('No tenés acceso a esa empresa')
          router.replace('/empresa')
          return
        }
        // Cualquier otro código es un problema real (red, 5xx): mostrar y
        // dejar reintentar en vez de expulsar a /empresa con el texto crudo.
        setError(empRes.error.message)
        return
      }

      if (!permisosResult) {
        toast.error('No tenés acceso a esa empresa')
        router.replace('/empresa')
        return
      }

      setBootstrap({
        empresa: empRes.data as EmpresaOnline,
        rol: permisosResult.rol,
        permisos: permisosResult.permisos,
        userEmail: user.email ?? '',
        userId: user.id,
      })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [router, intento])

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="font-display text-2xl font-medium mb-2">
            No pudimos cargar la empresa
          </p>
          <p className="text-ink-2 text-sm font-mono break-all mb-6">{error}</p>
          <button onClick={reintentar} className="btn-ghost mx-auto">
            <RefreshCw size={14} /> Reintentar
          </button>
        </div>
      </main>
    )
  }

  if (!bootstrap) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-amber" size={32} />
      </main>
    )
  }

  return (
    <AppProvider value={bootstrap}>
      <Header
        empresa={bootstrap.empresa}
        userEmail={bootstrap.userEmail}
        onMenuClick={() => setNavOpen(true)}
      />
      <div className="flex flex-1 w-full max-w-7xl mx-auto">
        <Sidenav
          permisos={bootstrap.permisos}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </div>
    </AppProvider>
  )
}
