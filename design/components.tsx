/**
 * Primitivos visuales de ContaSystem Carga.
 *
 * Estos componentes están listos para copiar al proyecto Next.js cuando
 * lo inicialicemos. Pensados para Tailwind v4 con el theme definido en
 * DESIGN_SYSTEM.md (colores `paper`, `ink`, `amber`, etc., y fuentes
 * `font-display`, `font-sans`, `font-mono`).
 *
 * Sin lógica de Supabase aún — solo presentación.
 */

import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'

// ─────────────────────────────────────────────────────────────────────
// Button — "estampado" con sombra hard
// ─────────────────────────────────────────────────────────────────────

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  children: ReactNode
}

export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonProps) {
  if (variant === 'ghost') {
    return (
      <button
        {...rest}
        className={`inline-flex items-center gap-1.5 text-ink-2 text-sm hover:text-ink transition-colors ${className}`}
      >
        {children}
      </button>
    )
  }
  return (
    <button
      {...rest}
      className={
        'inline-flex items-center justify-center gap-2.5 bg-amber text-ink ' +
        'font-sans font-semibold text-[15px] tracking-tight ' +
        'px-6 py-3.5 min-h-[48px] rounded ' +
        'border-[1.5px] border-ink ' +
        'shadow-[3px_3px_0_var(--color-ink)] ' +
        'hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_var(--color-ink)] ' +
        'active:translate-x-px active:translate-y-px active:shadow-[1px_1px_0_var(--color-ink)] ' +
        'transition-all duration-100 ease-out ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        className
      }
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Field — input de línea inferior (estilo formulario impreso)
// ─────────────────────────────────────────────────────────────────────

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  optional?: boolean
}

export function Field({ label, hint, optional, className = '', id, ...rest }: FieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className={className}>
      <label htmlFor={inputId} className="block mb-2 label-mono">
        {label}
        {optional && <span className="ml-1 normal-case tracking-normal text-ink-3">(opcional)</span>}
      </label>
      <input
        id={inputId}
        {...rest}
        className={
          'w-full bg-transparent border-0 border-b-[1.5px] border-ink ' +
          'py-3 text-[17px] text-ink ' +
          'placeholder:text-ink-3 ' +
          'focus:outline-none focus:border-amber-deep focus:border-b-2 focus:pb-[11px] ' +
          'transition-colors'
        }
      />
      {hint && <p className="mt-1.5 text-[11px] text-ink-3 font-mono">{hint}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// LabelMono — utilidad reusable para "label-mono"
// ─────────────────────────────────────────────────────────────────────

export function LabelMono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`font-mono text-[11px] tracking-[0.14em] uppercase text-ink-2 font-medium ${className}`}
    >
      {children}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-line rounded-2xl ${className}`}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Badge — pill con bullet, 3 variantes de estado
// ─────────────────────────────────────────────────────────────────────

type BadgeKind = 'pending' | 'imported' | 'rejected'

const BADGE_STYLES: Record<BadgeKind, string> = {
  pending:  'bg-amber-light text-amber-deep',
  imported: 'bg-status-ok-bg text-status-ok',
  rejected: 'bg-status-no-bg text-status-no',
}

const BADGE_LABELS: Record<BadgeKind, string> = {
  pending:  'Pendiente',
  imported: 'Importado',
  rejected: 'Rechazado',
}

export function Badge({ kind, count }: { kind: BadgeKind; count?: number }) {
  return (
    <span
      className={
        `inline-flex items-center gap-1.5 pl-2 pr-2.5 py-[3px] rounded-full ` +
        `font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase whitespace-nowrap ` +
        `${BADGE_STYLES[kind]}`
      }
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
      {BADGE_LABELS[kind]}
      {typeof count === 'number' && <span className="opacity-70 ml-0.5">· {count}</span>}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Highlight — resalta una palabra clave (marker amber, una vez por pantalla)
// ─────────────────────────────────────────────────────────────────────

export function Highlight({ children, thin = false }: { children: ReactNode; thin?: boolean }) {
  return (
    <span className="relative inline-block isolate">
      {children}
      <span
        aria-hidden
        className={
          `absolute -left-1 -right-1 bg-amber rounded-md -z-10 ` +
          (thin ? `h-[0.4em] bottom-[0.06em] opacity-45` : `h-[0.55em] bottom-[0.08em] opacity-40`)
        }
        style={{ transform: 'rotate(-0.7deg) skewX(-3deg)' }}
      />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Perforated — línea punteada horizontal, separador estilo recibo
// ─────────────────────────────────────────────────────────────────────

export function Perforated({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-px bg-repeat-x ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(to right, var(--color-line) 50%, transparent 50%)',
        backgroundSize: '6px 1px',
      }}
      aria-hidden
    />
  )
}

// ─────────────────────────────────────────────────────────────────────
// PillGroup — toggle de moneda (UYU/USD/EUR)
// ─────────────────────────────────────────────────────────────────────

interface PillGroupProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: readonly T[]
}

export function PillGroup<T extends string>({ value, onChange, options }: PillGroupProps<T>) {
  return (
    <div className="inline-flex gap-0.5 p-[3px] bg-paper-2 rounded-full" role="group">
      {options.map((opt) => {
        const active = opt === value
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={
              `px-3.5 py-1.5 rounded-full font-mono text-xs transition-colors ` +
              (active
                ? 'bg-ink text-paper font-semibold'
                : 'text-ink-2 hover:text-ink')
            }
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// EmpresaCard — fila clickeable de la pantalla de selector
// ─────────────────────────────────────────────────────────────────────

interface EmpresaCardProps {
  nombre: string
  rut: string
  moneda?: string
  onClick?: () => void
}

export function EmpresaCard({ nombre, rut, moneda = 'UYU', onClick }: EmpresaCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full text-left flex items-center justify-between gap-4 ' +
        'bg-white border border-line border-l-4 border-l-amber rounded-xl ' +
        'px-5 py-4 transition-all duration-200 ease-out ' +
        'hover:border-l-8 hover:translate-x-0.5 hover:bg-paper-2'
      }
    >
      <div>
        <div className="font-display text-xl font-medium">{nombre}</div>
        <div className="font-mono text-xs text-ink-2 mt-1.5 flex items-center gap-3">
          <span>RUT {rut}</span>
          <span className="text-ink-3">·</span>
          <span>{moneda}</span>
        </div>
      </div>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-ink-2 flex-shrink-0"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// LedgerRow — fila de la lista "Últimos 20"
// ─────────────────────────────────────────────────────────────────────

interface LedgerRowProps {
  id: string
  estado: BadgeKind
  plantilla: string
  contacto?: string
  fecha: string
  monto: string  // ya formateado: "$ 12.450,00"
  moneda: string
  motivoRechazo?: string
}

export function LedgerRow({
  id, estado, plantilla, contacto, fecha, monto, moneda, motivoRechazo,
}: LedgerRowProps) {
  const tachado = estado === 'rechazado'
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 px-2 py-3.5 rounded-lg hover:bg-paper-2 transition-colors">
      <div>
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-ink-3">{id}</span>
          <Badge kind={estado} />
        </div>
        <div className="font-display text-base font-medium">{plantilla}</div>
        <div className="text-[13px] text-ink-2 mt-0.5">
          {contacto ?? '—'} · {fecha}
          {motivoRechazo && (
            <>
              {' · '}
              <span className="text-status-no">{motivoRechazo}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right">
        <div
          className={
            'font-mono text-lg font-medium leading-tight ' +
            (tachado ? 'text-ink-3 line-through' : '')
          }
        >
          {monto}
        </div>
        <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider mt-0.5">
          {moneda}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Stamp — sello decorativo (solo login)
// ─────────────────────────────────────────────────────────────────────

export function Stamp({
  top = 'Modalidad',
  main = 'Directa',
  bottom = 'v 1 · 2026',
}: {
  top?: string
  main?: string
  bottom?: string
}) {
  return (
    <div
      className={
        'relative inline-flex flex-col items-center px-6 pt-3.5 pb-3 ' +
        'border-[2.5px] border-amber-deep text-amber-deep ' +
        'rounded font-mono text-center leading-none opacity-90'
      }
      style={{ transform: 'rotate(-4.5deg)' }}
      aria-hidden
    >
      <span
        className="absolute left-1/2 -translate-x-1/2 -top-2 w-7 h-[1.5px] bg-amber-deep"
        aria-hidden
      />
      <span
        className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-7 h-[1.5px] bg-amber-deep"
        aria-hidden
      />
      <span className="text-[9px] tracking-[0.32em]">{top}</span>
      <span
        className="font-display my-1.5 uppercase"
        style={{
          fontSize: '30px',
          letterSpacing: '0.06em',
          fontVariationSettings: '"opsz" 144, "wght" 600',
        }}
      >
        {main}
      </span>
      <span className="text-[9px] tracking-[0.32em]">{bottom}</span>
    </div>
  )
}
