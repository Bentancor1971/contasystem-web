'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ChevronRight, Users, Lock, ShieldCheck, Cake } from 'lucide-react'
import { useApp } from '@/lib/app-context'
import {
  canManageRoles,
  canManageUsers,
  canSeeConfig,
  ROL_LABEL,
} from '@/lib/roles'

interface ConfigCard {
  href: string
  label: string
  description: string
  icon: typeof Users
  disabledReason?: string
}

export default function ConfiguracionPage() {
  const router = useRouter()
  const { rol, permisos } = useApp()

  useEffect(() => {
    if (!canSeeConfig(permisos)) {
      router.replace('/carga')
    }
  }, [permisos, router])

  if (!canSeeConfig(permisos)) return null

  const cards: ConfigCard[] = [
    {
      href: '/configuracion/usuarios',
      label: 'Usuarios',
      description: 'Crear cuentas y asignar roles por empresa',
      icon: Users,
      disabledReason: canManageUsers(permisos)
        ? undefined
        : 'Tu rol no tiene permiso para gestionar usuarios',
    },
    {
      href: '/configuracion/roles',
      label: 'Roles y permisos',
      description: 'Definir qué puede hacer cada rol en esta empresa',
      icon: ShieldCheck,
      disabledReason: canManageRoles(permisos)
        ? undefined
        : 'Tu rol no tiene permiso para editar la matriz de permisos',
    },
    {
      href: '/configuracion/mails',
      label: 'Saludos de cumpleaños',
      description: 'Estado del envío automático de mails de cumpleaños',
      icon: Cake,
    },
  ]

  return (
    <main className="max-w-3xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
      <div className="mb-8 rise">
        <p className="label-mono mb-2">Tu rol · {ROL_LABEL[rol]}</p>
        <h1 className="font-display text-4xl md:text-5xl font-medium leading-tight">
          Configuración
        </h1>
        <p className="text-ink-2 mt-3 text-base max-w-xl">
          Ajustes y administración de la empresa.
        </p>
      </div>

      <div className="space-y-3 rise">
        {cards.map((card) => {
          const Icon = card.icon
          const disabled = !!card.disabledReason
          const content = (
            <>
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    disabled ? 'bg-paper-2 text-ink-3' : 'bg-amber-light text-amber-deep'
                  }`}
                >
                  {disabled ? <Lock size={18} /> : <Icon size={18} />}
                </div>
                <div>
                  <div className="font-display-tight text-lg font-medium">
                    {card.label}
                  </div>
                  <div className="text-sm text-ink-2 mt-0.5">
                    {disabled ? card.disabledReason : card.description}
                  </div>
                </div>
              </div>
              {!disabled && (
                <ChevronRight size={20} className="text-ink-3 flex-shrink-0" />
              )}
            </>
          )

          if (disabled) {
            return (
              <div
                key={card.href}
                className="card p-5 flex items-center justify-between gap-4 opacity-60 cursor-not-allowed"
              >
                {content}
              </div>
            )
          }
          return (
            <Link
              key={card.href}
              href={card.href}
              className="card p-5 flex items-center justify-between gap-4 hover:border-ink-3 transition-colors"
            >
              {content}
            </Link>
          )
        })}
      </div>
    </main>
  )
}
