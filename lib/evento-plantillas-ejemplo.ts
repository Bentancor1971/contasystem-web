/**
 * Plantillas de ejemplo para /configuracion/eventos.
 *
 * Antes vivían como `placeholder` de los campos (texto fantasma, no editable).
 * Ahora se cargan como valor inicial cuando el evento todavía no tiene nada
 * guardado: quedan a la vista, sirven de referencia y se pueden editar.
 *
 * Ojo con las variables: sólo los mails las interpolan ({nombre} {evento}
 * {numero} {total}). El encabezado/pie de la página pública y el certificado se
 * sanean y se insertan tal cual, así que ahí una llave sale literal.
 */

import type { EventoWebConfig } from '@/lib/eventos-types'

/** Campos de texto/HTML de la config (los que admiten ejemplo). */
export type CampoPlantilla = {
  [K in keyof EventoWebConfig]: EventoWebConfig[K] extends string | null ? K : never
}[keyof EventoWebConfig]

export const PLANTILLAS_EJEMPLO: Record<CampoPlantilla, string> = {
  pagina_html_encabezado: `<p>Te esperamos en esta nueva edición. Completá el formulario con tu cédula
y en un minuto quedás inscripto.</p>
<p><strong>Importante:</strong> el cupo es limitado y se asigna por orden de inscripción.</p>`,

  pagina_html_pie: `<p>Por consultas escribinos a <a href="mailto:contacto@ejemplo.com">contacto@ejemplo.com</a>.</p>
<p>Vas a recibir la confirmación por correo. Si no te llega, revisá la carpeta de spam.</p>`,

  mail_acuse_asunto: 'Preinscripción registrada — {evento}',

  mail_acuse_html: `<p>Hola {nombre},</p>
<p>Registramos tu preinscripción a <strong>{evento}</strong>. Tu cupo queda
reservado con el número <strong>{numero}</strong>.</p>
<p>Todavía figura como impaga: el importe a abonar es <strong>{total}</strong>.
Coordiná el pago con la organización para confirmar tu lugar.</p>
<p>¡Gracias y nos vemos pronto!</p>`,

  mail_acuse_pago_asunto: 'Inscripción con pago declarado — {evento}',

  mail_acuse_pago_html: `<p>Hola {nombre},</p>
<p>Recibimos tu inscripción a <strong>{evento}</strong> con el número
<strong>{numero}</strong> y la declaración de tu transferencia por
<strong>{total}</strong>.</p>
<p>Vamos a verificar el pago con el banco. Cuando esté confirmado, tu inscripción
queda cerrada y no tenés que hacer nada más.</p>
<p>¡Gracias!</p>`,

  certificado_html: `<p>Este certificado es válido y fue emitido por la organización del evento.</p>
<p>Podés verificar su autenticidad ingresando nuevamente a esta misma dirección.</p>`,
}

/**
 * Config lista para editar: los campos que vienen vacíos arrancan con el
 * ejemplo. Guardar deja el ejemplo como plantilla real del evento; borrar el
 * campo y guardar vuelve al recibo/diseño por defecto.
 */
export function conPlantillasEjemplo(cfg: EventoWebConfig): EventoWebConfig {
  const out = { ...cfg }
  for (const k of Object.keys(PLANTILLAS_EJEMPLO) as CampoPlantilla[]) {
    if (!out[k]?.trim()) out[k] = PLANTILLAS_EJEMPLO[k]
  }
  return out
}
