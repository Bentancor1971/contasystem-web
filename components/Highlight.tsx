import type { ReactNode } from 'react'

/**
 * Resalta una palabra con marker ámbar.
 * Usar UNA VEZ por pantalla, sobre la palabra que comunica la intención.
 */
export function Highlight({ children, thin = false }: { children: ReactNode; thin?: boolean }) {
  return <span className={thin ? 'hl hl-thin' : 'hl'}>{children}</span>
}
