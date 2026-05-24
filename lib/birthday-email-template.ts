/**
 * Plantilla del mail de saludo de cumpleaños.
 *
 * El diseño es: una imagen de fondo (la identidad de la empresa) con el
 * texto del saludo ENCIMA, usando la técnica "bulletproof background"
 * (background-image para clientes modernos + VML para Outlook).
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

/** hex (#rgb o #rrggbb) + opacidad 0–100 → string rgba(). */
function hexToRgba(hex: string, opacidad: number): string {
  const h = (hex || '').replace('#', '').trim()
  const full =
    h.length === 3
      ? h.split('').map((c) => c + c).join('')
      : h.padEnd(6, '0').slice(0, 6)
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  const a = Math.min(100, Math.max(0, opacidad)) / 100
  return `rgba(${r},${g},${b},${a})`
}

/** Devuelve un hex válido o el fallback. */
function hexSeguro(hex: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test((hex || '').trim()) ? hex.trim() : fallback
}

const HERO_HEIGHT = 420
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
  // las variables sobreviven), sustituir con valores escapados, nl2br.
  const cuerpoHtml = aplicarVariables(escapeHtml(plantilla.cuerpo), {
    nombre: escapeHtml(vars.nombre),
    denominacion: escapeHtml(vars.denominacion),
  }).replace(/\r?\n/g, '<br>')

  const textoColor = hexSeguro(plantilla.textoColor, '#ffffff')
  const panelColor = hexSeguro(plantilla.panelColor, '#1a1814')
  const img = plantilla.imagenUrl

  // Bloque de texto (panel semitransparente + cuerpo).
  const panelBg = hexToRgba(panelColor, plantilla.panelOpacidad)
  const textoBloque = `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;max-width:440px;">
      <tr>
        <td class="panel-pad" style="background-color:${panelBg};border-radius:12px;padding:30px 34px;text-align:center;">
          <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:${textoColor};font-size:17px;line-height:1.65;">
            ${cuerpoHtml}
          </div>
        </td>
      </tr>
    </table>`

  // Sección "hero": con imagen → bulletproof background; sin imagen →
  // color sólido (panelColor) para que el texto siga siendo legible.
  let hero: string
  if (img) {
    const imgSafe = escapeHtml(img)
    hero = `
      <td background="${imgSafe}" bgcolor="${panelColor}" valign="middle"
          style="background-image:url('${imgSafe}');background-size:cover;background-position:center;background-color:${panelColor};min-height:${HERO_HEIGHT}px;">
        <!--[if gte mso 9]>
        <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${CARD_WIDTH}px;height:${HERO_HEIGHT}px;">
        <v:fill type="frame" src="${imgSafe}" color="${panelColor}" />
        <v:textbox inset="0,0,0,0">
        <![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" class="hero-pad" style="padding:44px 32px;">${textoBloque}</td></tr>
        </table>
        <!--[if gte mso 9]>
        </v:textbox>
        </v:rect>
        <![endif]-->
      </td>`
  } else {
    hero = `
      <td bgcolor="${panelColor}" valign="middle"
          style="background-color:${panelColor};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" class="hero-pad" style="padding:56px 32px;">
            <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:${textoColor};font-size:17px;line-height:1.65;text-align:center;">
              ${cuerpoHtml}
            </div>
          </td></tr>
        </table>
      </td>`
  }

  const html = `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .hero-pad { padding: 24px 12px !important; }
      .panel-pad { padding: 22px 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f3f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f3f0;padding:28px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="${CARD_WIDTH}" cellpadding="0" cellspacing="0" style="width:${CARD_WIDTH}px;max-width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e3dd;">
          <tr>${hero}</tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}
