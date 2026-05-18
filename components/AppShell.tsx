'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { Header } from './Header'
import { Sidenav } from './Sidenav'
import { AppProvider } from '@/lib/app-context'
import {
  isRolValido,
  permisosConDefaults,
  ROLES,
  type PermisosRol,
  type Rol,
} from '@/lib/roles'
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

      const [empRes, rolRes] = await Promise.all([
        supabase
          .from('empresas_online_remoto')
          .select('*')
          .eq('empresa_id', empresaId)
          .single(),
        supabase
          .from('user_empresas')
          .select('rol')
          .eq('user_id', user.id)
          .eq('empresa_id', empresaId)
          .single(),
      ])

      if (cancelled) return

      if (empRes.error || !empRes.data) {
        toast.error('No tenés acceso a esa empresa')
        router.replace('/empresa')
        return
      }

      const rolRaw = rolRes.data?.rol
      const rol: Rol = isRolValido(rolRaw) ? rolRaw : ROLES.USUARIO

      // Permisos efectivos: si la empresa tiene fila para este rol, la usamos;
      // si no, caemos a los defaults definidos en lib/roles.ts.
      const { data: permRow } = await supabase
        .from('rol_permisos')
        .select(
          'puede_cargar, puede_ver_config, puede_gestionar_usuarios, puede_gestionar_roles',
        )
        .eq('empresa_id', empresaId)
        .eq('rol', rol)
        .maybeSingle()

      if (cancelled) return

      const permisos = permisosConDefaults(rol, permRow ?? null)

      setBootstrap({
        empresa: empRes.data as EmpresaOnline,
        rol,
        permisos,
        userEmail: user.email ?? '',
        userId: user.id,
      })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [router])

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
