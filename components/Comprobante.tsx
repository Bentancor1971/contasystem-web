/**
 * Ilustración decorativa del hero del login: una boleta estilizada.
 * No representa un documento real — los renglones son barras y el QR
 * es un patrón fijo, no escaneable. Se combina con <Stamp /> encima.
 */

// Patrón del glifo de QR: 5×5, con los tres "ojos" en las esquinas.
const QR = [
  1, 1, 0, 1, 1,
  1, 0, 1, 0, 1,
  0, 1, 1, 1, 0,
  1, 0, 1, 0, 1,
  1, 1, 0, 1, 1,
]

export function Comprobante() {
  return (
    <div className="recibo" aria-hidden>
      <div className="flex items-baseline justify-between">
        <span className="recibo__label">Comprobante</span>
        <span className="recibo__label">A 000-1204</span>
      </div>

      <div className="perforated mt-3 mb-4" />

      {/* Los renglones dejan una banda alta en el medio: es donde apoya
          el sello, sin tocar ni el número de arriba ni el total de abajo. */}
      <div className="space-y-2.5">
        <div className="recibo__renglon" style={{ width: '78%' }} />
        <div className="recibo__renglon" style={{ width: '54%' }} />
        <div className="recibo__renglon" style={{ width: '66%' }} />
        <div className="recibo__renglon" style={{ width: '46%' }} />
        <div className="recibo__renglon" style={{ width: '71%' }} />
      </div>

      <div className="perforated mt-4 mb-3.5" />

      <div className="recibo__qr">
        {QR.map((on, i) => (
          <i key={i} className={on ? undefined : 'off'} />
        ))}
      </div>
    </div>
  )
}
