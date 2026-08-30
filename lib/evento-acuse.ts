/**
 * Acuse de inscripción por email (server-only).
 *
 * Único lugar donde se arma el mail de una inscripción: lo usan el alta
 * (POST /inscribir) y el reenvío de copia (POST /reenviar-acuse), para que la
 * persona reciba exactamente el mismo comprobante en ambos casos.
 *
 * Best-effort: nunca lanza. Devuelve el motivo para loguearlo.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EstadoInscripcionRemota,
  EventoRemoto,
  EventoWebConfig,
  ModalidadInscripcion,
} from '@/lib/eventos-types'
import { datosDepositoDe, esSoloSorteo, simboloDe } from '@/lib/eventos-types'
import { normalizarDatosDepositoMonedas, normalizarMonedas } from '@/lib/eventos'
import { buscarEntradaEmitida } from '@/lib/entradas'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { loadEmpresaBranding } from '@/lib/empresa-branding'
import { sendInscripcionEmail } from '@/lib/mailer'
import { qrPng } from '@/lib/qr'
import { aplicarVariables, escapeHtml, sanitizeHtml } from '@/lib/sanitize-html'
import type { CambioDato, EntradaRecibo } from '@/lib/recibo-evento-email'

/** Datos de la inscripción tal como quedaron guardados (lo que se le comprueba). */
export interface InscripcionAcuse {
  numero: string | null
  categoria_nombre: string | null
  tipo_participante: 'socio' | 'no_socio'
  importe: number
  /**
   * Extras reservados. Van aparte del importe porque pueden ser sin costo
   * (importe 0) y el comprobante los tiene que listar igual.
   */
  lleva_transporte: boolean
  transporte_importe: number
  lleva_alimentacion: boolean
  alimentacion_importe: number
  alimentacion_tipo: string | null
  moneda_codigo: string
  modalidad: ModalidadInscripcion
  /**
   * Estado en el puente. Sólo 'confirmado' cambia el mail: es la confirmación
   * de la organización (todavía no la escribe el desktop, ver
   * docs/supabase/60_eventos_web_fixes.sql), y a partir de ahí el comprobante
   * deja de reclamar pagos y pasa a llevar la entrada al evento. 'importado'
   * sólo dice que el desktop RECIBIÓ la fila, no que la confirmó — se trata
   * igual que 'pendiente'/'pagado' acá. Omitirlo = tratarlo como no
   * confirmada, que es lo correcto para el alta y para la declaración de pago.
   */
  estado?: EstadoInscripcionRemota
  referencia_transferencia: string | null
  /**
   * Número correlativo sorteable. null = no participa del sorteo.
   * Este mail es el ÚNICO canal por el que la persona lo recibe: el lookup
   * público no lo expone (ver InscripcionPrevia), así que quien lo pierde lo
   * recupera reenviándose esta copia.
   */
  numero_sorteo: number | null
}

export interface EnviarAcuseParams {
  evento: EventoRemoto
  cfg: EventoWebConfig
  /** Casilla a la que se envía (ya validada por el caller). */
  destino: string
  documento: string
  nombre: string
  apellido: string
  inscripcion: InscripcionAcuse
  /** Diferencias entre la ficha del socio y lo que escribió (sólo en el alta). */
  cambios?: CambioDato[]
  /** Origen público (https://host) para armar el link al registro de pago. */
  origen?: string | null
}

/**
 * Origen público del sitio a partir del request. Detrás del proxy de Vercel el
 * host real viaja en x-forwarded-*; `req.url` puede traer el interno.
 */
export function origenPublico(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!host) return new URL(req.url).origin
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export type ResultadoAcuse =
  | { ok: true }
  | { ok: false; motivo: 'sin_casilla' | 'sin_destino' | 'error'; error?: string }

/** Content-ID con el que el HTML referencia el QR adjunto (`src="cid:…"`). */
const CID_QR = 'entrada-qr'

/**
 * Entrada al evento lista para el mail: los datos que se muestran y el PNG del
 * QR para adjuntar. null = esta inscripción no lleva entrada, y el comprobante
 * sale igual con los datos del registro solos.
 *
 * Devuelve null en tres casos, todos normales:
 *   - el evento no emite entradas (se define en el desktop);
 *   - el desktop todavía no emitió la de esta persona;
 *   - no hay `origen` con qué armar el link (llamadores sin Request).
 *
 * Si falla el dibujo del QR se manda igual con `cidQr: null`: el link y el N.º
 * de recibo son el 90% del valor, y perderlos por un error de render sería peor.
 */
async function resolverEntrada(
  admin: SupabaseClient,
  evento: EventoRemoto,
  documento: string,
  origen: string | null | undefined,
): Promise<{ recibo: EntradaRecibo; png: Buffer | null } | null> {
  if (!origen) return null

  const entrada = await buscarEntradaEmitida(admin, evento.id, documento)
  if (!entrada) return null

  const url = `${origen}/a/${entrada.token}`
  let png: Buffer | null = null
  try {
    png = await qrPng(url)
  } catch (err) {
    console.warn(`[acuse] no se pudo generar el QR de la entrada · ${String(err)}`)
  }

  return {
    recibo: { url, reciboNumero: entrada.numero, cidQr: png ? CID_QR : null },
    png,
  }
}

export async function enviarAcuseInscripcion(
  admin: SupabaseClient,
  { evento, cfg, destino, documento, nombre, apellido, inscripcion, cambios = [], origen }: EnviarAcuseParams,
): Promise<ResultadoAcuse> {
  const to = destino.trim()
  if (!to) return { ok: false, motivo: 'sin_destino' }

  try {
    // Las dos son independientes entre sí (P3): antes se esperaban en serie
    // aunque ninguna depende del resultado de la otra.
    const [cuenta, marca] = await Promise.all([
      // Sólo se puede enviar si la empresa tiene casilla Gmail configurada.
      loadGmailAccountForEmpresa(admin, evento.empresa_id),
      // Identidad y colores de quien ORGANIZA, que no tienen por qué coincidir
      // con el remitente: la casilla Gmail puede estar compartida entre
      // empresas de un grupo (y el `from_name` elegido a propósito). Sin fila
      // de branding se cae al comportamiento viejo —marca = nombre del
      // remitente— para no romper a ninguna empresa a la que todavía no le
      // corrió el push del desktop.
      loadEmpresaBranding(admin, evento.empresa_id),
    ])
    if (!cuenta) return { ok: false, motivo: 'sin_casilla' }

    // Copia oculta a la casilla remitente: default de la empresa, excepción por
    // evento. Un evento de inscripción masiva puede apagarla sin que la
    // organización pierda el registro en los demás.
    const copiaOculta = cfg.copia_oculta ?? cuenta.copiaOcultaAcuse

    const total =
      Number(inscripcion.importe) +
      Number(inscripcion.transporte_importe) +
      Number(inscripcion.alimentacion_importe)

    // Registro sin costo: evento sin costo cuya inscripción no genera pago. Sus
    // plantillas propias son de flujos de pago (preinscripción a pagar / pago
    // declarado), que acá no aplican: se ignoran y se usa el recibo branded, ya
    // adaptado para no mencionar pagos (y que sí incluye el número de sorteo).
    const registroSinCosto = evento.tipo !== 'con_costo' && total === 0

    // Evento que existe sólo para el sorteo: el comprobante habla del sorteo y
    // no del evento. Se resuelve con los mismos flags que el formulario público
    // y /inscribir, para que los tres cuenten la misma historia.
    const soloSorteo = esSoloSorteo({
      slug: evento.slug,
      tipo: evento.tipo,
      sorteoVisible: !!evento.sorteo_disponible && cfg.mostrar_sorteo,
      transporteVisible: !!evento.transporte_disponible && cfg.mostrar_transporte,
      alimentacionVisible: !!evento.alimentacion_disponible && cfg.mostrar_alimentacion,
    })

    // Confirmada por la organización: el comprobante cambia de naturaleza. Ya no
    // hay trámite pendiente que reclamar, y si el desktop emitió la entrada, ESA
    // es la parte útil del mail (ver el bloque de entrada en el recibo).
    //
    // 'importado' NO es esto (E1): sólo dice que el desktop bajó la fila a su
    // cola, no que alguien validó el pago. El desktop TODAVÍA NO ESCRIBE
    // 'confirmado' (ver docs/supabase/60_eventos_web_fixes.sql), así que hoy
    // este mail nunca sale como "confirmada" — se queda en "recibida" hasta que
    // el desktop lo haga.
    const confirmada = inscripcion.estado === 'confirmado'
    const entrada = confirmada
      ? await resolverEntrada(admin, evento, documento, origen)
      : null

    // Moneda de ESTA inscripción (la que eligió la persona, no la base del
    // evento): define con qué símbolo se muestran los importes y a qué cuenta
    // se le pide transferir. Nadie transfiere dólares a una cuenta en pesos.
    const monedaSimbolo = simboloDe(normalizarMonedas(evento), inscripcion.moneda_codigo)
    const datosDeposito = datosDepositoDe(
      {
        datos_deposito: evento.datos_deposito,
        datos_deposito_monedas: normalizarDatosDepositoMonedas(evento),
      },
      inscripcion.moneda_codigo,
    )

    // Plantilla propia del evento (si la cargaron en /configuracion/eventos).
    // El asunto es texto plano; el cuerpo es HTML (variables escapadas y saneado).
    const varsTexto: Record<string, string> = {
      nombre: `${nombre} ${apellido}`.trim(),
      evento: evento.nombre,
      numero: inscripcion.numero ?? '',
      // Vacío si no participa del sorteo: una plantilla propia que use
      // {numero_sorteo} en un evento sin sorteo no muestra nada, no "null".
      numero_sorteo:
        inscripcion.numero_sorteo == null ? '' : String(inscripcion.numero_sorteo),
      total: `${monedaSimbolo} ${total.toFixed(2)}`,
    }
    const varsHtml = Object.fromEntries(
      Object.entries(varsTexto).map(([k, v]) => [k, escapeHtml(v)]),
    )
    // Plantilla según la modalidad: pago declarado usa la propia (con el aviso de
    // verificación de transferencia); preinscripción usa la suya. Si el campo del
    // caso está vacío, cae al recibo branded por defecto.
    //
    // Una inscripción CONFIRMADA también las ignora, por el mismo motivo que el
    // registro sin costo: las dos plantillas propias que existen están redactadas
    // para un trámite pendiente (pagá / vamos a verificar), ninguna sirve para
    // quien ya está confirmado, y además el HTML propio reemplaza el cuerpo
    // entero — se llevaría puesta la entrada con el QR, que es lo único que la
    // persona necesita en la puerta.
    const esPago = inscripcion.modalidad === 'pago_transferencia'
    const sinPlantillaPropia = registroSinCosto || confirmada
    const asuntoTpl = sinPlantillaPropia ? null : esPago ? cfg.mail_acuse_pago_asunto : cfg.mail_acuse_asunto
    const htmlTpl = sinPlantillaPropia ? null : esPago ? cfg.mail_acuse_pago_html : cfg.mail_acuse_html

    // Link al registro de pago: sólo tiene sentido en la preinscripción con pago
    // pendiente y sólo si el form público lo ofrece (misma condición que
    // EventoForm/RegistrarPago: transferencia habilitada y datos de depósito
    // cargados). En un registro sin costo no hay pago que registrar.
    const urlPago =
      !esPago && !registroSinCosto && origen && cfg.permitir_pago_transferencia && datosDeposito
        ? `${origen}/e/${evento.slug}?pago=1`
        : null

    const envio = await sendInscripcionEmail({
      cuenta,
      to,
      branding: marca?.branding,
      copiaOculta,
      override: {
        asunto: asuntoTpl ? aplicarVariables(asuntoTpl, varsTexto) : null,
        html: htmlTpl ? sanitizeHtml(aplicarVariables(htmlTpl, varsHtml)) : null,
      },
      data: {
        empresa: marca?.empresa ?? { nombre: cuenta.fromName },
        eventoNombre: evento.nombre,
        eventoFecha: evento.fecha_inicio,
        eventoFechaFin: evento.fecha_fin,
        socioNombre: `${nombre} ${apellido}`.trim(),
        socioDocumento: documento,
        categoriaNombre: inscripcion.categoria_nombre,
        tipoParticipante: inscripcion.tipo_participante,
        importe: Number(inscripcion.importe),
        llevaTransporte: !!inscripcion.lleva_transporte,
        transporteImporte: Number(inscripcion.transporte_importe),
        llevaAlimentacion: !!inscripcion.lleva_alimentacion,
        alimentacionImporte: Number(inscripcion.alimentacion_importe),
        alimentacionTipo: inscripcion.alimentacion_tipo,
        total,
        monedaCodigo: inscripcion.moneda_codigo,
        monedaSimbolo,
        modalidad: inscripcion.modalidad,
        registroSinCosto,
        soloSorteo,
        confirmada,
        entrada: entrada?.recibo ?? null,
        datosDeposito,
        numero: inscripcion.numero,
        numeroSorteo: inscripcion.numero_sorteo,
        urlPago,
        referenciaDeclarada: inscripcion.referencia_transferencia,
        cambios,
      },
      attachments: entrada?.png
        ? [
            {
              filename: 'entrada-qr.png',
              content: entrada.png,
              cid: CID_QR,
              contentType: 'image/png',
            },
          ]
        : undefined,
    })
    if (!envio.ok) return { ok: false, motivo: 'error', error: envio.error }
    return { ok: true }
  } catch (err) {
    return { ok: false, motivo: 'error', error: err instanceof Error ? err.message : 'Error' }
  }
}
