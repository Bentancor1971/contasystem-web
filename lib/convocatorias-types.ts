/**
 * Tipos y mensajes del formulario de postulación (convocatorias).
 *
 * Este archivo NO importa nada de servidor: lo usan por igual el Server
 * Component de `/p/[token]`, los route handlers y el componente cliente.
 * El acceso a Supabase vive en `lib/convocatorias.ts` (service_role, server-only).
 *
 * Contrato: docs/supabase/50_convocatorias.sql del repo desktop. Las cuatro RPC
 * (`buscar_convocatoria`, `validar_invitado`, `registrar_postulacion`,
 * `retirar_postulacion`) devuelven un JSONB con forma `{ ok: true, ... }` o
 * `{ error: '<codigo>', ...datos }`.
 *
 * Qué se toma prestado de `elecciones-types` y por qué: `tokenValido`,
 * `digitosValidos`, `fechaHoraCorta` y `horaAperturaPasada` no tienen nada de
 * electoral —son la sanidad de un token, la de N dígitos y dos formateadores— y
 * los dos módulos comparten el mismo mecanismo de credencial. Copiarlos sería
 * empezar a tener dos definiciones de "dígitos válidos" que un día divergen y
 * gastan intentos de una credencial real.
 */

import { formatHoraUY } from '@/lib/format'
import {
  digitosValidos,
  fechaHoraCorta,
  horaAperturaPasada,
  tokenValido,
} from '@/lib/elecciones-types'

export { digitosValidos, fechaHoraCorta, horaAperturaPasada, tokenValido }

// ── Formas que devuelven las RPC ────────────────────────────────────────────

/**
 * Acá no existe el `cerrada_web` de Elecciones: una convocatoria no tiene canal
 * presencial que siga abierto después. Cerrada es cerrada.
 */
export type VentanaConvocatoria = 'abierta' | 'no_abierta' | 'cerrada'

/** Las tres conductas de deuda. La decisión ya viene tomada: esto es contexto. */
export type PoliticaDeuda = 'informar' | 'advertir' | 'bloquear'

export interface ConvocatoriaPublica {
  id: string
  nombre: string
  descripcion: string | null
  /** "7 titulares y 3 suplentes". Informativo: no se elige cargo al anotarse. */
  cargos_descripcion: string | null
  instructivo: string | null
  texto_antes: string | null
  /** Cierre que muestra la institución una vez recibida la postulación. */
  texto_despues: string | null
  email_contacto: string | null
  imagen_url: string | null
  fecha_apertura: string
  fecha_cierre: string
  estado: 'abierta' | 'cerrada'
}

/**
 * `buscar_convocatoria` — paso 1. Deliberadamente NO trae el nombre de la
 * persona NI su situación de deuda. Acá pesa más que en Elecciones: el payload
 * de este módulo incluye cuánto debe alguien, y un link reenviado en un grupo de
 * WhatsApp no puede ser la vía para que se entere el vecino.
 */
export interface EstadoConvocatoria {
  ok: true
  convocatoria: ConvocatoriaPublica
  /** Cuántos dígitos finales de la cédula pide el segundo factor. 0 = sin factor. */
  verificacion_digitos: number
  ya_postulado: boolean
  bloqueado: boolean
  ventana: VentanaConvocatoria
}

/** `validar_invitado` — paso 2. Recién acá aparecen nombre y situación. */
export interface InvitadoValidado {
  ok: true
  /** "María P." — nombre de pila + inicial. Nunca el nombre completo. */
  nombre: string
  /**
   * Ya resuelto por el desktop con la política aplicada. La web lo obedece y no
   * lo reinterpreta: si la regla se escribiera en los dos lados, un día la
   * persona leería una cosa en el mail y otra en la pantalla.
   */
  puede_postularse: boolean
  /** Puede anotarse, pero con deuda: la postulación queda marcada. */
  advertido: boolean
  motivo: string | null
  politica_deuda: PoliticaDeuda
  fecha_limite_regularizacion: string | null
  cuotas_pendientes: number
  importe_adeudado: number
  deuda_actualizada_at: string | null
}

export interface PostulacionRegistrada {
  ok: true
  postulacion_id: string
  recibida_at: string
}

export interface PostulacionRetirada {
  ok: true
}

/** Sólo para resolver el "no sé si llegó" de un envío sin respuesta. */
export interface EstadoPostulacion {
  ok: true
  ya_postulado: boolean
}

export type CodigoErrorPostulacion =
  | 'credencial_inexistente'
  | 'convocatoria_inexistente'
  | 'digitos_incorrectos'
  | 'bloqueado'
  | 'ya_postulado'
  | 'no_abierta'
  | 'convocatoria_cerrada'
  /** La política es `bloquear` y esta persona no la pasa. */
  | 'no_puede_postularse'
  | 'no_postulado'
  /** El desktop ya bajó la postulación: retirarse deja de ser un botón. */
  | 'ya_importada'
  /** No viene de la base: lo exige el route handler, que es quien mira el checkbox. */
  | 'falta_aceptar'
  /** No viene de la base: lo pone la web cuando el fetch no llegó a destino. */
  | 'sin_respuesta'

export interface ErrorPostulacion {
  error: CodigoErrorPostulacion | string
  /** `digitos_incorrectos` */
  intentos_restantes?: number
  /** `bloqueado` — hasta cuándo. */
  hasta?: string
  /** `ya_postulado` */
  recibida_at?: string
  /** `no_puede_postularse` — el motivo tal como lo dice el mail y la grilla. */
  motivo?: string
  /** `ya_importada` / `convocatoria_cerrada` al retirarse. */
  contacto?: string
}

/**
 * Discrimina la unión sin repetir el `'ok' in r` por todos lados.
 *
 * Es gemela de la de `elecciones-types` y no se reusa a propósito: aquélla
 * estrecha contra `ErrorVotacion`, y como `ErrorPostulacion` no es ese tipo, el
 * `else` no descartaba nada y TypeScript dejaba de ver los campos del `ok`.
 */
export function esError<T extends { ok: true }>(r: T | ErrorPostulacion): r is ErrorPostulacion {
  return !('ok' in r) || r.ok !== true
}

export type RespuestaEstadoConv = EstadoConvocatoria | ErrorPostulacion
export type RespuestaValidarInvitado = InvitadoValidado | ErrorPostulacion
export type RespuestaRegistrar = PostulacionRegistrada | ErrorPostulacion
export type RespuestaRetirar = PostulacionRetirada | ErrorPostulacion

// ── Lo que la web manda al registrar ────────────────────────────────────────

/**
 * Lo que viaja al registrar. **No es la postulación**: que la fila exista ya
 * significa "me interesa integrar la lista".
 *
 * El formulario público sólo pide `comentario`: el contacto de la persona ya lo
 * tiene la institución en su ficha, y pedirlo de nuevo agregaba fricción justo
 * en la pantalla donde menos conviene. `telefono` y `mail_contacto` siguen en el
 * contrato de la RPC —llegan vacíos— porque la columna existe y la baja del
 * desktop los lee.
 */
export interface DatosPostulacion {
  telefono: string
  mail_contacto: string
  comentario: string
  acepta_condiciones: boolean
}

// ── Mensajes ────────────────────────────────────────────────────────────────

export interface MensajePostulacion {
  titulo: string
  detalle: string
  /** `true` = no hay nada que reintentar en esta sesión: se corta el flujo. */
  terminal: boolean
}

/**
 * Traduce un error de las RPC al mensaje que ve la persona.
 *
 * Dos criterios heredados de la votación, y que no son cosméticos:
 *
 *  · `credencial_inexistente` recibe EL MISMO texto que `digitos_incorrectos`.
 *    Quien tiene un link reenviado no tiene que poder distinguir "token válido,
 *    dígitos mal" de "token inválido". El caso legítimo —el link está roto— ya
 *    se resuelve en la portada de `/p/`, antes de pedir dígitos.
 *
 *  · `intentos_restantes === 0` se cuenta como bloqueo, no como "te quedan 0
 *    intentos": el intento que agotó el contador YA dejó la credencial
 *    bloqueada, y decir lo otro invita a gastar un toque más para descubrirlo.
 */
export function mensajeDeErrorPostulacion(
  r: ErrorPostulacion,
  emailContacto: string | null,
): MensajePostulacion {
  // El contacto que devuelve la RPC gana: es el de esta convocatoria.
  const mail = r.contacto ?? emailContacto
  const contacto = mail ? ` Escribinos a ${mail}.` : ''

  switch (r.error) {
    case 'digitos_incorrectos':
    case 'credencial_inexistente':
      if (r.intentos_restantes === 0) {
        return {
          titulo: 'Demasiados intentos',
          detalle: `Por seguridad la credencial quedó bloqueada un rato. Volvé a intentar más tarde.${contacto}`,
          terminal: true,
        }
      }
      return {
        titulo: 'Los dígitos no coinciden',
        // El error casi siempre es haber dejado afuera el verificador, así que
        // el recordatorio va acá y no sólo en la ayuda del campo.
        detalle:
          typeof r.intentos_restantes === 'number'
            ? `Te ${r.intentos_restantes === 1 ? 'queda' : 'quedan'} ${r.intentos_restantes} ${
                r.intentos_restantes === 1 ? 'intento' : 'intentos'
              }. Acordate de contar el dígito verificador.`
            : 'Revisá los últimos dígitos de tu cédula —contando el dígito verificador— y volvé a probar.',
        terminal: false,
      }

    case 'bloqueado': {
      const hora = formatHoraUY(r.hasta)
      return {
        titulo: 'Demasiados intentos',
        detalle: hora
          ? `Probá de nuevo después de las ${hora}.`
          : 'Esperá unos minutos y volvé a probar.',
        terminal: true,
      }
    }

    case 'ya_postulado': {
      const cuando = fechaHoraCorta(r.recibida_at)
      return {
        titulo: 'Ya estás anotado',
        detalle: cuando
          ? `Registramos tu interés el ${cuando}. Volvé a abrir el link si querés darte de baja.`
          : 'Tu interés ya está registrado.',
        terminal: true,
      }
    }

    case 'no_puede_postularse':
      return {
        titulo: 'No podés anotarte en este llamado',
        detalle: r.motivo
          ? `${r.motivo}${contacto}`
          : `Según el padrón de esta convocatoria, no cumplís las condiciones para integrar la lista.${contacto}`,
        terminal: true,
      }

    case 'convocatoria_cerrada':
      return {
        titulo: 'El plazo para anotarse cerró',
        detalle: `Ya no se reciben postulaciones por este medio.${contacto}`,
        terminal: true,
      }

    case 'no_abierta':
      return {
        titulo: 'El llamado todavía no está abierto',
        detalle: 'Volvé a entrar con este mismo link cuando empiece.',
        terminal: true,
      }

    case 'no_postulado':
      return {
        titulo: 'No figurás anotado',
        detalle: `No hay ninguna postulación tuya para dar de baja.${contacto}`,
        terminal: true,
      }

    case 'ya_importada':
      // No es un error de la persona: se anotó bien y la comisión ya la tiene.
      return {
        titulo: 'Tu postulación ya está en manos de la comisión',
        detalle: mail
          ? `Para darte de baja ahora hay que avisarles: escribí a ${mail}.`
          : 'Para darte de baja ahora hay que avisarle a la comisión.',
        terminal: true,
      }

    case 'falta_aceptar':
      return {
        titulo: 'Falta aceptar las condiciones',
        detalle: 'Marcá la casilla del final para poder anotarte.',
        terminal: false,
      }

    case 'sin_respuesta':
      // NUNCA decir "no se registró": el request pudo haber llegado igual.
      return {
        titulo: 'No pudimos confirmar tu postulación',
        detalle:
          'Se cortó la conexión y no sabemos si llegó a registrarse. Verificá antes de volver a intentar.',
        terminal: false,
      }

    case 'convocatoria_inexistente':
      return {
        titulo: 'El link no es válido',
        detalle: `Revisá que hayas abierto el link completo del mail.${contacto}`,
        terminal: true,
      }

    default:
      return {
        titulo: 'No pudimos completar la operación',
        detalle: `Volvé a probar en un momento.${contacto}`,
        terminal: false,
      }
  }
}

// ── Situación de deuda, en palabras ─────────────────────────────────────────

/**
 * La frase de regularización para quien NO puede anotarse. Existe porque el
 * reclamo típico de este módulo es el de alguien que pagó ayer: el mensaje no
 * puede ser "no podés", tiene que ser "no podés todavía, y hasta cuándo hay
 * tiempo".
 */
export function textoRegularizacion(fechaLimite: string | null): string | null {
  const cuando = fechaHoraCorta(fechaLimite)
  if (!cuando) return null
  return `Si te ponés al día antes del ${cuando}, vas a poder anotarte con este mismo link.`
}

/**
 * La misma fecha, para el ADVERTIDO. Es otra frase y no la de arriba porque a
 * esta persona no le falta poder anotarse —ya se anota, y en esa misma pantalla
 * lo está haciendo—: lo que esa fecha decide es si queda en el registro de
 * habilitados. Prometerle que "vas a poder anotarte" la deja esperando un
 * permiso que ya tiene. Es el mismo corte que el mail llama padrón.
 */
export function textoRegularizacionAdvertido(fechaLimite: string | null): string | null {
  const cuando = fechaHoraCorta(fechaLimite)
  if (!cuando) return null
  return `Si te ponés al día antes del ${cuando} integrarás el registro.`
}
