'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { EmpresaOnline } from '@/lib/types'

const LS_KEY = 'cs-carga-empresa-id'

interface HeaderProps {
  empresa: EmpresaOnline
  userEmail?: string
}

export function Header({ empresa, userEmail }: HeaderProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Cerrar dropdown al click fuera
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function cambiarEmpresa() {
    localStorage.removeItem(LS_KEY)
    router.push('/empresa')
  }

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    localStorage.removeItem(LS_KEY)
    router.replace('/login')
    router.refresh()
  }

  const initials = (userEmail ?? 'US').slice(0, 2).toUpperCase()

  return (
    <header className="border-b border-line bg-white sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-5 md:px-8 lg:px-10 h-16 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-xl font-medium">ContaSystem</span>
            <span className="label-mono">Carga</span>
          </div>
          <div className="hidden md:block w-px h-6 bg-line" />
          <div className="hidden md:block">
            <div className="font-display-tight text-[15px] font-medium leading-tight">{empresa.nombre}</div>
            <div className="font-mono text-[10px] text-ink-3 mt-0.5">
              {empresa.rut ? `RUT ${empresa.rut} · ` : ''}{empresa.moneda_base_codigo}
            </div>
          </div>
        </div>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full hover:bg-paper-2 transition-colors"
            aria-label="Menú de usuario"
          >
            <div className="w-8 h-8 rounded-full bg-ink text-paper flex items-center justify-center font-mono text-[11px] font-medium">
              {initials}
            </div>
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-64 card p-2 shadow-lg">
              {userEmail && (
                <div className="px-3 py-2 border-b border-line mb-1">
                  <p className="label-mono text-[10px] mb-0.5">Sesión</p>
                  <p className="font-mono text-xs text-ink-2 break-all">{userEmail}</p>
                </div>
              )}
              <button
                onClick={cambiarEmpresa}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded hover:bg-paper-2 transition-colors text-sm"
              >
                <RefreshCw size={14} className="text-ink-2" />
                Cambiar empresa
              </button>
              <button
                onClick={logout}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded hover:bg-paper-2 transition-colors text-sm text-status-no"
              >
                <LogOut size={14} />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
