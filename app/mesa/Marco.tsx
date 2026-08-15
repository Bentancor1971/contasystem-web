/**
 * Piezas compartidas por las tres pantallas de mesa.
 *
 * Server Component: son marcado y nada más. Lo que necesita estado vive en los
 * componentes cliente de cada pantalla.
 */

export function Marco({
  children,
  ancho = 'xl',
}: {
  children: React.ReactNode
  /** El padrón necesita más ancho que el login. */
  ancho?: 'sm' | 'xl' | '3xl'
}) {
  const max = ancho === 'sm' ? 'max-w-md' : ancho === '3xl' ? 'max-w-3xl' : 'max-w-xl'
  return (
    <main className="min-h-screen bg-paper">
      <div className={`mx-auto w-full ${max} px-4 sm:px-6 py-6 sm:py-10`}>{children}</div>
    </main>
  )
}

export function Aviso({
  titulo,
  detalle,
  tono = 'medio',
  children,
}: {
  titulo: string
  detalle?: string
  tono?: 'ok' | 'medio' | 'alto'
  children?: React.ReactNode
}) {
  return (
    <div className={`voto-aviso voto-aviso--${tono}`} role="status">
      <h2 className="font-display text-xl font-medium leading-tight mb-1">{titulo}</h2>
      {detalle && <p className="text-ink-2 text-[16px] leading-relaxed">{detalle}</p>}
      {children}
    </div>
  )
}

/** Barra de identificación del puesto. Siempre a la vista: la mesa se confunde. */
export function BarraMesa({
  mesa,
  sede,
  eleccion,
  esPresidente,
  derecha,
}: {
  mesa: string
  sede?: string | null
  eleccion: string
  esPresidente: boolean
  derecha?: React.ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <span className="label-mono">{eleccion}</span>
        <h1 className="font-display text-2xl sm:text-3xl font-medium leading-tight mt-1">
          {mesa}
          {esPresidente && (
            <span className="badge badge-imported align-middle ml-2 text-[11px]">presidente</span>
          )}
        </h1>
        {sede && <p className="text-ink-3 text-sm mt-0.5">{sede}</p>}
      </div>
      {derecha}
    </header>
  )
}
