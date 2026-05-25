/**
 * Plantilla del mail de saludo de cumpleaños.
 *
 * Layout apilado: la imagen de identidad de la empresa va arriba como
 * <img> responsive (width:100%, height:auto) y debajo, una tarjeta
 * sólida con el saludo. Evita superposiciones y se ve correcto en
 * cualquier ancho (desktop / mobile).
 *
 * El texto admite dos variables:
 *   {nombre}        → nombre de pila del cumpleañero
 *   {denominacion}  → tratamiento configurable (ej. "Estimado/a")
 *
 * Este módulo es PURO (solo arma strings): no importa nodemailer ni
 * Supabase, así que puede usarse tanto en el server (cron) como en el
 * cliente (preview en vivo de la página editora).
 */

/** Plantilla de una empresa. Coincide con la tabla birthday_email_templates. */
export interface BirthdayTemplate {
  asunto: string
  /** Tratamiento de la persona, sustituye a {denominacion}. */
  denominacion: string
  /** Cuerpo en texto plano; los saltos de línea pasan a <br>. */
  cuerpo: string
  /** URL pública de la imagen de fondo, o null si no hay. */
  imagenUrl: string | null
  /** Color del texto (hex). */
  textoColor: string
  /** Color del panel semitransparente detrás del texto (hex). */
  panelColor: string
  /** Opacidad del panel, 0–100. */
  panelOpacidad: number
}

/** Valores por defecto · se usan si una empresa no tiene plantilla guardada. */
export const DEFAULT_BIRTHDAY_TEMPLATE: BirthdayTemplate = {
  asunto: '¡Feliz cumpleaños, {nombre}!',
  denominacion: 'Estimado/a',
  cuerpo:
    '{denominacion} {nombre},\n\n' +
    '¡Te deseamos un muy feliz cumpleaños! Que tengas una jornada ' +
    'espléndida, rodeada de la gente que querés.\n\n' +
    '¡Un fuerte abrazo!',
  imagenUrl: null,
  textoColor: '#ffffff',
  panelColor: '#1a1814',
  panelOpacidad: 40,
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Escapa caracteres con significado en HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Reemplaza {nombre} y {denominacion} (case-insensitive). */
function aplicarVariables(
  texto: string,
  vars: { nombre: string; denominacion: string },
): string {
  return texto
    .replace(/\{nombre\}/gi, vars.nombre)
    .replace(/\{denominacion\}/gi, vars.denominacion)
}

/** Devuelve un hex válido o el fallback. */
function hexSeguro(hex: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test((hex || '').trim()) ? hex.trim() : fallback
}

const CARD_WIDTH = 600

// ────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────

/**
 * Renderiza el mail de cumpleaños a partir de una plantilla y el nombre
 * del cumpleañero. No envía nada: solo arma asunto + HTML + texto plano.
 */
export function renderBirthdayEmail({
  nombre,
  plantilla,
}: {
  nombre: string
  plantilla: BirthdayTemplate
}): RenderedEmail {
  const vars = {
    nombre: nombre.trim(),
    denominacion: plantilla.denominacion.trim(),
  }

  const subject = aplicarVariables(plantilla.asunto, vars).trim() ||
    '¡Feliz cumpleaños!'

  // Texto plano (fallback / entregabilidad).
  const text = aplicarVariables(plantilla.cuerpo, vars).trim()

  // Cuerpo HTML: escapar primero (las llaves {} no se escapan, así que
  // las variables sobreviven), sustituir con valores escapados, y
  // convertir a párrafos con margen acotado (los \n\n del editor no
  // generan dos <br> seguidos — se aplastaría con mucho aire).
  const cuerpoEscapado = aplicarVariables(escapeHtml(plantilla.cuerpo), {
    nombre: escapeHtml(vars.nombre),
    denominacion: escapeHtml(vars.denominacion),
  })
  const parrafos = cuerpoEscapado.split(/\r?\n\s*\r?\n+/)
  const cuerpoHtml = parrafos
    .map((p, i) => {
      const inner = p.replace(/\r?\n/g, '<br>')
      const last = i === parrafos.length - 1
      return `<p style="margin:0 0 ${last ? '0' : '10px'} 0;">${inner}</p>`
    })
    .join('')

  const textoColor = hexSeguro(plantilla.textoColor, '#ffffff')
  const panelColor = hexSeguro(plantilla.panelColor, '#1a1814')
  const img = plantilla.imagenUrl

  // Fila opcional con la imagen, responsive (mobile-friendly).
  const imagenRow = img
    ? `
      <tr>
        <td style="padding:0;line-height:0;font-size:0;">
          <img src="${escapeHtml(img)}" alt="" width="${CARD_WIDTH}" border="0"
               style="display:block;width:100%;max-width:${CARD_WIDTH}px;height:auto;border:0;outline:none;text-decoration:none;" />
        </td>
      </tr>`
    : ''

  // Fila con el saludo en una tarjeta sólida con el color de la empresa.
  // panelOpacidad ya no aplica (era para overlay sobre imagen), se usa
  // el color sólido para mantener contraste con textoColor.
  const textoRow = `
      <tr>
        <td class="text-pad" align="center" style="background-color:${panelColor};padding:24px 32px;text-align:center;">
          <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:${textoColor};font-size:16px;line-height:1.5;">
            ${cuerpoHtml}
          </div>
        </td>
      </tr>`

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .text-pad { padding: 20px 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f3f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f3f0;padding:28px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="${CARD_WIDTH}" cellpadding="0" cellspacing="0" style="width:${CARD_WIDTH}px;max-width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e3dd;">
          ${imagenRow}${textoRow}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}
