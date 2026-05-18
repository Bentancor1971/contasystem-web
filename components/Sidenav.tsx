'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, Settings, X } from 'lucide-react'
import { canSeeConfig, type PermisosRol } from '@/lib/roles'

interface NavItem {
  href: string
  label: string
  icon: typeof FileText
  visible: (p: PermisosRol) => boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/carga', label: 'Carga', icon: FileText, visible: (p) => p.puede_cargar },
  {
    href: '/configuracion',
    label: 'Configuración',
    icon: Settings,
    visible: (p) => canSeeConfig(p),
  },
]

interface SidenavProps {
  permisos: PermisosRol
  open: boolean
  onClose: () => void
}

export function Sidenav({ permisos, open, onClose }: SidenavProps) {
  const pathname = usePathname()
  const visibleItems = NAV_ITEMS.filter((item) => item.visible(permisos))

  return (
    <>
      {/* Overlay (solo mobile) */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-ink/40 z-30"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:sticky top-0 md:top-16 left-0 z-40 md:z-10
          h-screen md:h-[calc(100vh-4rem)]
          w-64 shrink-0
          bg-paper border-r border-line
          transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          flex flex-col
        `}
        aria-label="Navegación principal"
      >
        {/* Header del drawer en mobile */}
        <div className="md:hidden flex items-center justify-between px-5 h-16 border-b border-line">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-medium">ContaSystem</span>
            <span className="label-mono">Carga</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 hover:bg-paper-2 rounded transition-colors"
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>

        {/* Items */}
        <nav className="flex-1 px-3 py-5 space-y-0.5">
          <p className="label-mono px-3 mb-2">Menú</p>
          {visibleItems.map((item) => {
            const active =
              item.href === '/carga'
                ? pathname === '/carga'
                : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors
                  ${
                    active
                      ? 'bg-paper-3 text-ink font-medium'
                      : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
                  }
                `}
              >
                <Icon size={16} strokeWidth={active ? 2.25 : 2} />
                <span>{item.label}</span>
                {active && (
                  <span className="ml-auto w-1 h-4 bg-amber rounded-full" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-line">
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            ContaSystem · Carga
            <br />
            <span className="text-ink-3/70">v0.1</span>
          </p>
        </div>
      </aside>
    </>
  )
}
