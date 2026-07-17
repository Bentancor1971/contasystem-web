/**
 * Recibo de inscripción a evento para email — MISMO formato/tipo que los
 * recibos que envía el desktop (contasystem-desktop email-templates.ts:
 * baseLayout + generarReciboEventoHTML). Portado al web para que el acuse
 * inmediato tenga la misma identidad visual que el recibo formal.
 *
 * Branding por defecto (coincide con el de A.T.R.I.: #230d66 / #e57c15 /
 * #0892d9, sin logo). Si en el futuro se sincroniza el branding por empresa,
 * pasar un `branding` parcial.
 *
 * HTML email-safe: tablas + estilos inline.
 */

export type ModalidadInscripcion = 'reserva' | 'pago_transferencia'

export interface CambioDato {
  campo: string
  anterior: string
  nuevo: string
}

export interface BrandingConfig {
  logo_url: string | null
  color_primary: string
  color_accent: string
  color_secondary: string
  footer_text: string | null
  mostrar_documento: boolean
}

const DEFAULT_BRANDING: BrandingConfig = {
  logo_url: null,
  color_primary: '#230d66',
  color_accent: '#e57c15',
  color_secondary: '#0892d9',
  footer_text: null,
  mostrar_documento: false,
}

export interface DatoEmpresa {
  nombre: string
  razon_social?: string | null
  rut?: string | null
  direccion?: string | null
  telefono?: string | null
  email?: string | null
  pagina_web?: string | null
}

export interface ReciboEventoEmailData {
  empresa: DatoEmpresa
  eventoNombre: string
  eventoFecha: string | null // ISO
  socioNombre: string
  socioDocumento: string
  categoriaNombre: string | null
  tipoParticipante: 'socio' | 'no_socio'
  importe: number
  transporteImporte: number
  alimentacionImporte: number
  alimentacionTipo: string | null
  total: number
  monedaCodigo: string
  modalidad: ModalidadInscripcion
  /** Datos de la cuenta donde depositar (texto libre del evento). */
  datosDeposito: string | null
  numero: string | null
  /**
   * Número correlativo del sorteo. null = no participa.
   * OJO: el rango arranca en 0 por defecto, así que 0 es un número VÁLIDO.
   * Chequear siempre `!= null`, nunca por truthiness.
   */
  numeroSorteo?: number | null
  /** Link al formulario público de "registrar mi pago" (sólo preinscripción). */
  urlPago?: string | null
  /** Referencia de transferencia que la persona declaró (modalidad "pago realizado"). */
  referenciaDeclarada?: string | null
  cambios: CambioDato[]
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatImporte(n: number, moneda: string): string {
  return `${moneda} ${n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fechaLarga(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${d} de ${meses[m - 1]} de ${y}`
}

function getColors(b: BrandingConfig) {
  return {
    primary: b.color_primary,
    accent: b.color_accent,
    secondary: b.color_secondary,
    grayText: '#656464',
    grayLight: '#d9d9d9',
    white: '#ffffff',
  }
}

function baseLayout(empresa: DatoEmpresa, contenido: string, b: BrandingConfig): string {
  const C = getColors(b)
  const logoHtml = b.logo_url
    ? `<img src="${b.logo_url}" alt="${esc(empresa.nombre)}" width="180" style="display:block;margin:0 auto 8px;max-width:180px;height:auto;" />`
    : ''
  const razon = empresa.razon_social || empresa.nombre
  const headerContent = `${logoHtml}<p style="margin:0;font-size:22px;font-weight:bold;color:${C.white};letter-spacing:1px;">${esc(empresa.nombre)}</p>${razon && razon !== empresa.nombre ? `<p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">${esc(razon)}</p>` : ''}`
  const footerExtra = b.footer_text
    ? `<tr><td style="padding:8px 32px 0;text-align:center;font-size:12px;color:rgba(255,255,255,0.7);">${esc(b.footer_text)}</td></tr>`
    : ''
  const contactoParts: string[] = []
  if (empresa.telefono) contactoParts.push(`Tel: ${esc(empresa.telefono)}`)
  if (empresa.email) contactoParts.push(`<a href="mailto:${esc(empresa.email)}" style="color:${C.white};text-decoration:none;">${esc(empresa.email)}</a>`)

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Recibo de inscripción</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${C.white};border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background-color:${C.primary};padding:24px 32px;text-align:center;">${headerContent}</td></tr>
        <tr><td style="background-color:${C.accent};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        ${contenido}
        <tr>
          <td style="background-color:${C.primary};padding:20px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="color:${C.white};font-size:13px;line-height:20px;text-align:center;">
                <strong>${esc(razon)}</strong>${empresa.rut ? `<br/>RUT: ${esc(empresa.rut)}` : ''}
                ${empresa.direccion ? `<br/>${esc(empresa.direccion)}` : ''}
                ${contactoParts.length ? `<br/>${contactoParts.join(' | ')}` : ''}
                ${empresa.pagina_web ? `<br/><a href="${esc(empresa.pagina_web)}" target="_blank" style="color:${C.white};text-decoration:underline;font-weight:bold;">${esc(empresa.pagina_web.replace(/^https?:\/\//, ''))}</a>` : ''}
              </td></tr>
              ${footerExtra}
            </table>
          </td>
        </tr>
        <tr><td style="padding:12px 32px;text-align:center;font-size:11px;color:#94949b;">${esc(empresa.nombre)} · Acuse automático de inscripción</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export function renderReciboEventoEmail(
  d: ReciboEventoEmailData,
  branding?: Partial<BrandingConfig>,
): { subject: string; html: string; text: string } {
  const b = { ...DEFAULT_BRANDING, ...branding }
  const C = getColors(b)
  const esTransferencia = d.modalidad === 'pago_transferencia'
  const fecha = fechaLarga(d.eventoFecha)
  // El 0 es un número de sorteo válido (el rango arranca ahí por defecto).
  const tieneSorteo = d.numeroSorteo != null

  const contenido = `
          <!-- Saludo -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <p style="margin:0;font-size:16px;color:${C.grayText};">Hola, <strong style="color:${C.primary};">${esc(d.socioNombre)}</strong></p>
              <p style="margin:8px 0 0;font-size:14px;color:${C.grayText};">${esTransferencia
                ? 'Recibimos tu inscripción y tu declaración de pago. Vamos a verificar la transferencia y te enviaremos recibo con la confirmación definitiva.'
                : `Tu preinscripción quedó registrada. Recuerda realizar el pago correspondiente y registrar el mismo en${d.urlPago ? ':' : ' el formulario de inscripción del evento.'}`}</p>
            </td>
          </tr>

          ${!esTransferencia && d.urlPago ? `
          <!-- Botón: registrar el pago -->
          <tr>
            <td style="padding:12px 32px 4px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:${C.accent};border-radius:6px;">
                    <a href="${esc(d.urlPago)}" target="_blank" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:bold;color:${C.white};text-decoration:none;">Registrar mi pago</a>
                  </td>
                </tr>
              </table>
              <p style="margin:8px 0 0;font-size:12px;color:#94949b;">Si el botón no funciona, copiá este enlace: <a href="${esc(d.urlPago)}" style="color:${C.secondary};">${esc(d.urlPago)}</a></p>
            </td>
          </tr>` : ''}

          <!-- Monto destacado -->
          <tr>
            <td style="padding:20px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.primary};border-radius:8px;">
                <tr><td style="padding:24px;text-align:center;">
                  <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:1px;">Importe Inscripción</p>
                  <p style="margin:8px 0 0;font-size:32px;font-weight:bold;color:${C.white};">${formatImporte(d.total, d.monedaCodigo)}</p>
                </td></tr>
              </table>
            </td>
          </tr>

          ${tieneSorteo ? `
          <!-- Número de sorteo: es el dato que la persona tiene que conservar,
               y este mail es el único lugar donde lo recibe. -->
          <tr>
            <td style="padding:0 32px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${C.accent};border-radius:8px;">
                <tr><td style="padding:20px;text-align:center;">
                  <p style="margin:0;font-size:13px;color:#94949b;text-transform:uppercase;letter-spacing:1px;">Tu número para el sorteo</p>
                  <p style="margin:6px 0 0;font-size:40px;font-weight:bold;color:${C.accent};line-height:1.1;">${esc(String(d.numeroSorteo))}</p>
                  <p style="margin:8px 0 0;font-size:12px;color:#94949b;">Guardá este número: es el que participa del sorteo.</p>
                </td></tr>
              </table>
            </td>
          </tr>` : ''}

          <!-- Datos del evento -->
          <tr>
            <td style="padding:0 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.grayLight};border-radius:6px;overflow:hidden;">
                <tr style="background-color:${C.accent};"><td colspan="2" style="padding:10px 16px;color:${C.white};font-size:14px;font-weight:bold;">Evento: ${esc(d.eventoNombre)}</td></tr>
                ${fecha ? `<tr><td style="padding:10px 16px;font-size:13px;color:#94949b;width:160px;">Fecha</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};font-weight:bold;">${esc(fecha)}</td></tr>` : ''}
                <tr style="background-color:#fafafa;"><td style="padding:10px 16px;font-size:13px;color:#94949b;">Participante</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};font-weight:bold;">${esc(d.socioNombre)}</td></tr>
                ${b.mostrar_documento ? `<tr><td style="padding:10px 16px;font-size:13px;color:#94949b;">Documento</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};">${esc(d.socioDocumento)}</td></tr>` : ''}
                ${d.categoriaNombre ? `<tr style="background-color:#fafafa;"><td style="padding:10px 16px;font-size:13px;color:#94949b;">Categoría</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};">${esc(d.categoriaNombre)} · ${d.tipoParticipante === 'socio' ? 'Socio' : 'No socio'}</td></tr>` : ''}
                ${d.transporteImporte > 0 ? `<tr><td style="padding:10px 16px;font-size:13px;color:#94949b;">Transporte</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};">${formatImporte(d.transporteImporte, d.monedaCodigo)}</td></tr>` : ''}
                ${d.alimentacionTipo || d.alimentacionImporte > 0 ? `<tr><td style="padding:10px 16px;font-size:13px;color:#94949b;">Alimentación</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};">${d.alimentacionTipo ? esc(d.alimentacionTipo) : 'Sí'}${d.alimentacionImporte > 0 ? ` · ${formatImporte(d.alimentacionImporte, d.monedaCodigo)}` : ''}</td></tr>` : ''}
                <tr style="background-color:#fafafa;"><td style="padding:10px 16px;font-size:13px;color:#94949b;">Modalidad</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};font-weight:bold;">${esTransferencia ? 'Pago realizado (a verificar)' : 'Preinscripción (pago después)'}</td></tr>
              </table>
            </td>
          </tr>

          ${!esTransferencia && (d.datosDeposito || d.numero) ? `
          <tr>
            <td style="padding:0 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.primary};border-radius:6px;overflow:hidden;">
                <tr style="background-color:${C.primary};"><td colspan="2" style="padding:10px 16px;color:${C.white};font-size:14px;font-weight:bold;">Datos para el pago</td></tr>
                ${d.datosDeposito ? `<tr><td colspan="2" style="padding:12px 16px;font-size:13px;color:${C.grayText};white-space:pre-line;">${esc(d.datosDeposito)}</td></tr>` : ''}
                <tr style="background-color:#fafafa;"><td style="padding:10px 16px;font-size:13px;color:#94949b;width:180px;">Importe a pagar</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};font-weight:bold;">${formatImporte(d.total, d.monedaCodigo)}</td></tr>
                ${d.numero ? `<tr><td style="padding:10px 16px;font-size:13px;color:#94949b;">Referencia de inscripción</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};font-weight:bold;">${esc(d.numero)}</td></tr>` : ''}
              </table>
              <p style="margin:8px 0 0;font-size:12px;color:#94949b;">Después de transferir, registrá el pago con el botón de arriba para que podamos verificarlo.</p>
            </td>
          </tr>` : ''}

          ${esTransferencia && d.datosDeposito ? `
          <tr>
            <td style="padding:0 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.primary};border-radius:6px;overflow:hidden;">
                <tr style="background-color:${C.primary};"><td colspan="2" style="padding:10px 16px;color:${C.white};font-size:14px;font-weight:bold;">Pago declarado</td></tr>
                <tr><td colspan="2" style="padding:12px 16px;font-size:13px;color:${C.grayText};white-space:pre-line;">${esc(d.datosDeposito)}</td></tr>
                <tr style="background-color:#fafafa;"><td style="padding:10px 16px;font-size:13px;color:#94949b;width:160px;">Importe</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};font-weight:bold;">${formatImporte(d.total, d.monedaCodigo)}</td></tr>
                ${d.referenciaDeclarada ? `<tr><td style="padding:10px 16px;font-size:13px;color:#94949b;">Referencia declarada</td><td style="padding:10px 16px;font-size:14px;color:${C.grayText};font-weight:bold;">${esc(d.referenciaDeclarada)}</td></tr>` : ''}
              </table>
              <p style="margin:8px 0 0;font-size:12px;color:#94949b;">Vamos a verificar tu transferencia para confirmar la inscripción.</p>
            </td>
          </tr>` : ''}

          ${d.cambios.length > 0 ? `
          <tr>
            <td style="padding:8px 32px 8px;">
              <div style="padding:12px 16px;background-color:#fffbeb;border-left:3px solid ${C.accent};border-radius:0 4px 4px 0;">
                <p style="margin:0 0 6px;font-size:13px;font-weight:bold;color:#92400e;">Actualizamos tus datos</p>
                ${d.cambios.map((c) => `<p style="margin:2px 0;font-size:13px;color:#92400e;">${esc(c.campo)}: <span style="text-decoration:line-through;opacity:.7;">${esc(c.anterior || '—')}</span> → <strong>${esc(c.nuevo || '—')}</strong></p>`).join('')}
              </div>
            </td>
          </tr>` : ''}

          <tr><td style="height:16px;"></td></tr>`

  const subject = esTransferencia
    ? `Inscripción con pago declarado — ${d.eventoNombre}`
    : `Preinscripción — ${d.eventoNombre}`

  const html = baseLayout(d.empresa, contenido, b)

  const lineas: string[] = [
    `${esTransferencia ? 'Inscripción con pago declarado' : 'Preinscripción'} — ${d.eventoNombre}`,
    '',
    `Hola ${d.socioNombre},`,
    esTransferencia
      ? 'Recibimos tu inscripción y tu declaración de pago. Vamos a verificar la transferencia y te enviaremos recibo con la confirmación definitiva.'
      : `Tu preinscripción quedó registrada. Recuerda realizar el pago correspondiente y registrar el mismo en${d.urlPago ? `:\n${d.urlPago}` : ' el formulario de inscripción del evento.'}`,
    fecha ? `Fecha: ${fecha}` : '',
    d.categoriaNombre ? `Categoría: ${d.categoriaNombre} (${d.tipoParticipante === 'socio' ? 'Socio' : 'No socio'})` : '',
    `Modalidad: ${esTransferencia ? 'Pago realizado (a verificar)' : 'Preinscripción (pago después)'}`,
    `Total: ${formatImporte(d.total, d.monedaCodigo)}`,
  ].filter(Boolean)
  if (tieneSorteo) {
    lineas.push('', `TU NÚMERO PARA EL SORTEO: ${d.numeroSorteo}`, 'Guardá este número: es el que participa del sorteo.')
  }
  if (esTransferencia && d.datosDeposito) {
    lineas.push('', 'Pago declarado:', d.datosDeposito, `Importe: ${formatImporte(d.total, d.monedaCodigo)}`)
    if (d.referenciaDeclarada) lineas.push(`Referencia declarada: ${d.referenciaDeclarada}`)
  }
  if (!esTransferencia && (d.datosDeposito || d.numero)) {
    lineas.push('', 'Datos para el pago:')
    if (d.datosDeposito) lineas.push(d.datosDeposito)
    lineas.push(`Importe a pagar: ${formatImporte(d.total, d.monedaCodigo)}`)
    if (d.numero) lineas.push(`Referencia de inscripción: ${d.numero}`)
    if (d.urlPago) lineas.push('', `Registrá tu pago acá: ${d.urlPago}`)
  }
  if (d.cambios.length > 0) {
    lineas.push('', 'Actualizamos tus datos:')
    for (const c of d.cambios) lineas.push(`- ${c.campo}: ${c.anterior || '—'} -> ${c.nuevo || '—'}`)
  }
  lineas.push('', `${d.empresa.nombre} · Acuse automático.`)

  return { subject, html, text: lineas.join('\n') }
}
