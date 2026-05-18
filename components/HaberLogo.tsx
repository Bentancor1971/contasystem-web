'use client'

import { useState } from 'react'
import { Wallet, Landmark, CreditCard } from 'lucide-react'
import type { MedioTipo } from '@/lib/types'

// Mapa logo_key → archivo SVG en /public/logos.
// Agregar nuevos archivos a /public/logos y referenciarlos acá.
const LOGOS: Record<string, string> = {
  visa: '/logos/visa.svg',
  mastercard: '/logos/mastercard.svg',
  master: '/logos/mastercard.svg',
  oca: '/logos/oca.svg',
  creditel: '/logos/creditel.svg',
  'pass-card': '/logos/pass-card.svg',
  anda: '/logos/anda.svg',
  bbva: '/logos/bbva.svg',
  itau: '/logos/itau.svg',
  brou: '/logos/brou.svg',
  santander: '/logos/santander.svg',
  scotiabank: '/logos/scotiabank.svg',
  hsbc: '/logos/hsbc.svg',
}

export function HaberLogo({
  logoKey,
  medioTipo,
  size = 24,
  className = '',
}: {
  logoKey: string | null
  medioTipo: MedioTipo | null
  size?: number
  className?: string
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const src = logoKey ? LOGOS[logoKey] : null

  if (src && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={logoKey ?? ''}
        width={size}
        height={size}
        className={`object-contain ${className}`}
        onError={() => setImgFailed(true)}
      />
    )
  }

  // Fallback por tipo: ícono genérico
  const Icon =
    medioTipo === 'tarjeta' ? CreditCard :
    medioTipo === 'banco' ? Landmark :
    Wallet
  return <Icon size={size} className={`text-ink-3 ${className}`} strokeWidth={1.6} />
}
