/**
 * `/mesa/*` — el puesto de mesa del local.
 *
 * Es la única superficie AUTENTICADA del sitio público: entra con código + PIN
 * y guarda una cookie httpOnly propia, sin nada que ver con la sesión de
 * Supabase del resto de la app. Ver docs/web/elecciones-mesa.md.
 *
 * `noindex` y `no-referrer` por la misma razón que `/v/{token}`: nada de esto se
 * indexa, y ninguna URL de acá tiene por qué viajar en un header Referer.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mesa de votación',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function MesaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
