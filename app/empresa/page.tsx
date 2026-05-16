'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, LogOut, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { Highlight } from '@/components/Highlight'
import type { EmpresaOnline } from '@/lib/types'

const LS_KEY = 'cs-carga-empresa-id'

export default function EmpresaPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<EmpresaOnline[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('empresas_online_remoto')
        .select('*')
        .eq('habilitada', 1)
        .order('nombre')
      if (error) {
        setError(error.message)
        return
      }
      const list = (data ?? []) as EmpresaOnline[]
      setEmpresas(list)

      // Si hay una sola, entra directo
      if (list.length === 1) {
        localStorage.setItem(LS_KEY, list[0].empresa_id)
        router.replace('/carga')
        return
      }

      // Si hay una preferencia previa válida, entra directo
      const previa = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      if (previa && list.some((e) => e.empresa_id === previa)) {
        router.replace('/carga')
      }
    }
    void load()
  }, [router])

  function elegir(empresa: EmpresaOnline) {
    localStorage.setItem(LS_KEY, empresa.empresa_id)
    router.push('/carga')
  }

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    localStorage.removeItem(LS_KEY)
    router.replace('/login')
    router.refresh()
  }

  if (empresas === null) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-amber" size={32} />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="font-display text-2xl font-medium mb-2">No pudimos cargar las empresas</p>
          <p className="text-ink-2 text-sm font-mono break-all">{error}</p>
          <button onClick={logout} className="btn-ghost mt-6 mx-auto">
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>
      </main>
    )
  }

  if (empresas.length === 0) {
    return (
      <main className="min-h-screen grain flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="label-mono mb-3">Sin acceso</p>
          <h1 className="font-display text-4xl font-medium mb-4">
            No tenés empresas <Highlight thin>asignadas</Highlight>
          </h1>
          <p className="text-ink-2 leading-relaxed">
            Pedile al contador que active <em>"Permitir carga online"</em> para alguna empresa
            y te asocie en Supabase (<span className="font-mono text-xs">user_empresas</span>).
          </p>
          <button onClick={logout} className="btn-ghost mt-8 mx-auto">
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen grain flex items-center justify-center py-16 px-6">
      <div className="w-full max-w-2xl rise">
        {/* Header strip */}
        <div className="flex items-baseline justify-between mb-16">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl font-medium">ContaSystem</span>
            <span className="label-mono">Carga</span>
          </div>
          <button onClick={logout} className="btn-ghost">
            <span className="label-mono">Cerrar sesión</span>
            <LogOut size={12} />
          </button>
        </div>

        {/* Title */}
        <div className="mb-12">
          <p className="label-mono mb-3">Paso 1 / 1</p>
          <h1 className="font-display text-5xl md:text-6xl font-medium leading-[0.95]">
            Elegí tu <Highlight>empresa</Highlight>
          </h1>
          <p className="text-ink-2 mt-5 text-lg max-w-xl">
            Tenés acceso a {empresas.length} empresa{empresas.length === 1 ? '' : 's'} habilitada{empresas.length === 1 ? '' : 's'} para carga online.
            La elección se recuerda para próximas sesiones.
          </p>
        </div>

        {/* Lista */}
        <div className="space-y-3" role="list">
          {empresas.map((e) => (
            <button
              key={e.empresa_id}
              type="button"
              role="listitem"
              className="emp-card"
              onClick={() => elegir(e)}
            >
              <div>
                <div className="font-display-tight text-xl font-medium">{e.nombre}</div>
                <div className="font-mono text-xs text-ink-2 mt-1.5 flex items-center gap-3">
                  {e.rut && <span>RUT {e.rut}</span>}
                  {e.rut && <span className="text-ink-3">·</span>}
                  <span>{e.moneda_base_codigo}</span>
                </div>
              </div>
              <ChevronRight size={22} className="text-ink-2 flex-shrink-0" />
            </button>
          ))}
        </div>

        <p className="font-mono text-xs text-ink-3 mt-14 text-center leading-relaxed">
          ¿Falta una empresa? Pedile al contador que active <em className="text-ink-2">&quot;Permitir carga online&quot;</em><br />
          en ContaSystem · Configuración · Empresas.
        </p>
      </div>
    </main>
  )
}
