'use client'

/**
 * "Descargar PDF" de la ayuda de la mesa: la impresión del navegador, con
 * "Guardar como PDF" como destino. Así el PDF es la página misma y no una
 * segunda copia del texto que mantener. Lo que no va en el papel se apaga con
 * `print:hidden` y las reglas de `@media print` de globals.css.
 */
export function BotonPdf({ className = 'btn-secondary text-sm' }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${className} print:hidden`}>
      Descargar PDF
    </button>
  )
}
