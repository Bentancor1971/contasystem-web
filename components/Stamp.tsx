export function Stamp({
  top = 'Modalidad',
  main = 'Directa',
  bottom = 'v 1 · 2026',
}: { top?: string; main?: string; bottom?: string }) {
  return (
    <div className="stamp" aria-hidden>
      <span className="stamp__top">{top}</span>
      <span className="stamp__main">{main}</span>
      <span className="stamp__bot">{bottom}</span>
    </div>
  )
}
