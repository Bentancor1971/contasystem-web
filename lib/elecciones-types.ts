/**
 * Tipos y mensajes de la votación web (elecciones).
 *
 * Este archivo NO importa nada de servidor: lo usan por igual el Server
 * Component de `/v/[token]`, los route handlers y el componente cliente.
 * El acceso a Supabase vive en `lib/elecciones.ts` (service_role, server-only).
 *
 * Contrato: docs/supabase/39_elecciones.sql del repo desktop. Las tres RPC
 * (`buscar_credencial`, `validar_credencial`, `emitir_voto`) devuelven un JSONB
 * con forma `{ ok: true, ... }` o `{ error: '<codigo>', ...datos }`.
 */

import { TZ_UY, formatHoraUY } from '@/lib/format'

// ── Formas que devuelven las RPC ────────────────────────────────────────────

/**
 * `cerrada_web` NO es `cerrada`, y confundirlos es el error más caro del módulo:
 * la elección sigue abierta, lo que cerró es el canal de internet, y quien lee
 * "la votación terminó" a esa hora se queda en su casa en vez de ir al local.
 * Ver docs/supabase/47_mesa_presencial.sql.
 */
export type VentanaEleccion = 'abierta' | 'no_abierta' | 'cerrada' | 'cerrada_web'

/** Cómo se dibuja la papeleta. No valida nada: quien valida es min/max. */
export type TipoPapeleta = 'lista' | 'cargo' | 'pregunta' | 'multiple'

export interface EleccionPublica {
  id: string
  nombre: string
  descripcion: string | null
  /** Texto donde la institución avisa, entre otras cosas, que el voto es nominal. */
  instructivo: string | null
  texto_antes: string | null
  /** Texto de cierre que la institución muestra una vez emitido el voto. */
  texto_despues: string | null
  email_contacto: string | null
  imagen_url: string | null
  fecha_apertura: string
  fecha_cierre: string
  /** Cierre del canal web, anterior al de la elección. `null` = cierran juntos. */
  fecha_cierre_web: string | null
  estado: 'abierta' | 'cerrada'
}

/** Integrante de una plancha. Informativo: no se vota por integrante. */
export interface IntegranteOpcion {
  nombre: string
  cargo: string | null
}

export interface OpcionPapeleta {
  id: string
  numero: string | null
  titulo: string
  lema: string | null
  descripcion: string | null
  imagen_url: string | null
  integrantes: IntegranteOpcion[]
}

export interface Papeleta {
  id: string
  orden: number
  titulo: string
  descripcion: string | null
  tipo: TipoPapeleta
  min_selecciones: number
  max_selecciones: number
  permite_blanco: boolean
  obligatoria: boolean
  opciones: OpcionPapeleta[]
}

/**
 * `buscar_credencial` — paso 1. Deliberadamente NO trae el nombre del votante
 * ni la boleta: un mail reenviado no puede filtrar datos de quien ni votó.
 */
export interface EstadoCredencial {
  ok: true
  eleccion: EleccionPublica
  /** Cuántos dígitos finales de la cédula pide el segundo factor. 0 = sin factor. */
  verificacion_digitos: number
  habilitado: boolean
  ya_voto: boolean
  bloqueado: boolean
  ventana: VentanaEleccion
}

export interface BoletaValidada {
  ok: true
  /** "María P." — nombre de pila + inicial. Nunca el nombre completo. */
  votante: string
  papeletas: Papeleta[]
}

export interface VotoEmitido {
  ok: true
  voto_id: string
  emitido_at: string
}

/** Todos los códigos que puede devolver cualquiera de las tres RPC. */
/**
 * `eleccion_publica` — la página que se reparte (`/e/{slug}`).
 *
 * No trae boleta, ni padrón, ni conteos: sólo lo que ya está en la cartelera del
 * club. Ver docs/supabase/43_publicacion_eleccion.sql.
 */
export interface EleccionPublicaPagina {
  ok: true
  eleccion: EleccionPublica & { slug: string }
  verificacion_digitos: number
  ventana: VentanaEleccion
}

/** `resolver_codigo` — traduce el código impreso al token de esa credencial. */
export interface CodigoResuelto {
  ok: true
  token: string
  slug: string
  eleccion: string
}

export type CodigoError =
  | 'credencial_inexistente'
  | 'codigo_inexistente'
  | 'eleccion_inexistente'
  | 'no_habilitado'
  | 'ya_voto'
  | 'bloqueado'
  | 'digitos_incorrectos'
  | 'eleccion_cerrada'
  /** El canal web cerró; la elección NO. Se vota en el local. */
  | 'cerrada_web'
  | 'no_abierta'
  | 'falta_papeleta'
  | 'blanco_no_admitido'
  | 'blanco_con_opciones'
  | 'cantidad_invalida'
  | 'opcion_invalida'
  /** No viene de la base: lo pone la web cuando el fetch no llegó a destino. */
  | 'sin_respuesta'

export interface ErrorVotacion {
  error: CodigoError | string
  /** `digitos_incorrectos` */
  intentos_restantes?: number
  /** `bloqueado` — hasta cuándo. */
  hasta?: string
  /** `cerrada_web` / `no_abierta` — desde cuándo. */
  desde?: string
  /** `ya_voto` */
  emitido_at?: string
  /** Errores de boleta: título de la papeleta que falló. */
  papeleta?: string
  min?: number
  max?: number
}

export type RespuestaEstado = EstadoCredencial | ErrorVotacion
export type RespuestaValidar = BoletaValidada | ErrorVotacion
export type RespuestaEmitir = VotoEmitido | ErrorVotacion

/** Discrimina la unión sin repetir el `'ok' in r` por todos lados. */
export function esError<T extends { ok: true }>(r: T | ErrorVotacion): r is ErrorVotacion {
  return !('ok' in r) || r.ok !== true
}

// ── Lo que la web manda al emitir ───────────────────────────────────────────

export interface SeleccionPapeleta {
  papeleta_id: string
  opcion_ids: string[]
  en_blanco: boolean
}

// ── Validación de entrada ───────────────────────────────────────────────────

/**
 * Sanidad del token antes de ir a la base. Es un UUID v4 emitido por el
 * desktop; acá sólo se frena lo absurdo (vacío, kilométrico, con separadores),
 * sin exigir el formato exacto para no acoplarse a cómo lo genere el desktop.
 */
export function tokenValido(token: string | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(token)
}

/**
 * Los últimos N dígitos de la cédula. Cadena vacía = elección sin segundo
 * factor. Devuelve `null` si vino algo que no son dígitos: el hash de la base
 * se calcula sobre el texto crudo, así que un espacio o un punto no coincidiría
 * nunca y gastaría uno de los cinco intentos.
 */
export function digitosValidos(v: unknown): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') return null
  const d = v.trim()
  if (d === '') return ''
  return /^\d{1,12}$/.test(d) ? d : null
}

// ── Fechas ──────────────────────────────────────────────────────────────────

/**
 * "12/09 a las 19:30" en hora de Montevideo. El server corre en UTC: la zona
 * se pasa siempre explícita o una constancia de las 19:30 se mostraría 22:30.
 */
export function fechaHoraCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // Con `year` en el pedido, es-UY respeta el `2-digit` de día y mes; sin él
  // devuelve "19/8". Se piden los tres y se arma el texto con dos de ellos.
  const partes = new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ_UY,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d)
  const dia = partes.find((p) => p.type === 'day')?.value ?? ''
  const mes = partes.find((p) => p.type === 'month')?.value ?? ''
  return `${dia}/${mes} a las ${formatHoraUY(iso)}`
}

/**
 * Si la hora de apertura ya pasó. Sirve para elegir CÓMO se cuenta un
 * `ventana: 'no_abierta'`, que tiene dos causas bien distintas:
 *
 *  · la hora todavía no llegó → "abre el 14/08 a las 09:00" es una espera con
 *    fecha, y la persona sabe qué hacer: volver más tarde;
 *  · la hora ya pasó y la elección sigue en `padron` → la apertura del acto es
 *    un gesto manual de la comisión (ver `WHEN v_e.estado = 'padron'` en
 *    docs/supabase/43_publicacion_eleccion.sql, que gana ANTES de mirar el
 *    reloj) y ese gesto todavía no ocurrió. Decirle "abre a las 09:00" a las
 *    once de la mañana es mentirle, y es justo el caso que termina en un
 *    llamado por teléfono.
 *
 * Se compara contra el reloj del server de Next, no contra el del visitante: un
 * celular con la hora mal no puede cambiar el texto. Los dos son instantes
 * absolutos, así que la zona no interviene.
 *
 * ⚠️ Alcance: esto elige PALABRAS, no permisos. Quién puede votar lo sigue
 * decidiendo `ventana`, que resuelve Postgres contra su propio reloj.
 */
export function horaAperturaPasada(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !isNaN(d.getTime()) && Date.now() >= d.getTime()
}

// ── Mensajes ────────────────────────────────────────────────────────────────

export interface MensajeVotacion {
  titulo: string
  detalle: string
  /** `true` = no hay nada que reintentar en esta sesión: se corta el flujo. */
  terminal: boolean
}

/**
 * Traduce un error de las RPC al mensaje que ve la persona.
 *
 * Dos criterios que no son cosméticos:
 *
 *  · `credencial_inexistente` recibe EL MISMO texto que `digitos_incorrectos`.
 *    Quien prueba credenciales al azar no tiene que poder distinguir "token
 *    válido, dígitos mal" de "token inválido". El caso "el link no sirve" ya se
 *    resuelve en la portada de /v/, antes de pedir dígitos.
 *
 *  · Ningún mensaje afirma que el voto NO se registró salvo que el servidor lo
 *    haya dicho. Ver `sin_respuesta`: un fetch que se cortó puede haber llegado.
 */
export function mensajeDeError(
  r: ErrorVotacion,
  emailContacto: string | null,
): MensajeVotacion {
  const contacto = emailContacto ? ` Escribinos a ${emailContacto}.` : ''

  switch (r.error) {
    case 'digitos_incorrectos':
    case 'credencial_inexistente':
      // El intento que agota los reintentos ya dejó la credencial bloqueada:
      // `validar_credencial` incrementa el contador y devuelve
      // `intentos_restantes: 0` en la MISMA respuesta, y recién el toque
      // siguiente sale por `bloqueado`. Decir "te quedan 0 intentos" invita a
      // probar otra vez para descubrir que estaba bloqueado. Se trata como
      // bloqueo desde acá, que es lo que efectivamente pasó.
      if (r.intentos_restantes === 0) {
        return {
          titulo: 'Demasiados intentos',
          detalle: `Por seguridad la credencial quedó bloqueada un rato. Volvé a intentar más tarde.${contacto}`,
          terminal: true,
        }
      }
      return {
        titulo: 'Los dígitos no coinciden',
        detalle:
          typeof r.intentos_restantes === 'number'
            ? `Te ${r.intentos_restantes === 1 ? 'queda' : 'quedan'} ${r.intentos_restantes} ${
                r.intentos_restantes === 1 ? 'intento' : 'intentos'
              }.`
            : 'Revisá los últimos dígitos de tu cédula y volvé a probar.',
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

    case 'ya_voto': {
      const cuando = fechaHoraCorta(r.emitido_at)
      return {
        titulo: 'Ya votaste',
        detalle: cuando
          ? `Registramos tu voto el ${cuando}. No se puede votar dos veces.`
          : 'Tu voto ya está registrado. No se puede votar dos veces.',
        terminal: true,
      }
    }

    case 'no_habilitado':
      return {
        titulo: 'Esta credencial fue dada de baja',
        detalle: `Ya no habilita a votar.${contacto}`,
        terminal: true,
      }

    case 'eleccion_cerrada':
      return {
        titulo: 'La votación está cerrada',
        detalle: `Ya no se pueden emitir votos.${contacto}`,
        terminal: true,
      }

    case 'cerrada_web': {
      // NO decir que la votación terminó: no terminó. Quien lee esto todavía
      // puede votar, en persona. Es el mensaje más caro de equivocar del módulo.
      const desde = fechaHoraCorta(r.desde)
      return {
        titulo: 'El voto por internet cerró',
        detalle:
          (desde ? `Cerró el ${desde}. ` : '') +
          `La votación sigue abierta: se vota en el local, en persona.${contacto}`,
        terminal: true,
      }
    }

    case 'no_abierta':
      return {
        titulo: 'La votación todavía no está abierta',
        detalle: 'Volvé a entrar con este mismo link cuando empiece.',
        terminal: true,
      }

    case 'falta_papeleta':
      return {
        titulo: 'Falta completar una parte',
        detalle: r.papeleta
          ? `Todavía no elegiste nada en «${r.papeleta}».`
          : 'Todavía hay una parte de la boleta sin completar.',
        terminal: false,
      }

    case 'cantidad_invalida': {
      const cuantas =
        typeof r.min === 'number' && typeof r.max === 'number'
          ? r.min === r.max
            ? `Tenés que elegir ${r.min}.`
            : `Tenés que elegir entre ${r.min} y ${r.max}.`
          : 'Revisá cuántas opciones marcaste.'
      return {
        titulo: 'Cantidad de opciones incorrecta',
        detalle: r.papeleta ? `En «${r.papeleta}»: ${cuantas}` : cuantas,
        terminal: false,
      }
    }

    case 'blanco_no_admitido':
      return {
        titulo: 'No se admite voto en blanco',
        detalle: r.papeleta
          ? `«${r.papeleta}» no admite voto en blanco.`
          : 'Esa parte de la boleta no admite voto en blanco.',
        terminal: false,
      }

    case 'blanco_con_opciones':
      return {
        titulo: 'Revisá tu selección',
        detalle: r.papeleta
          ? `En «${r.papeleta}» quedó marcado el voto en blanco junto con otras opciones.`
          : 'Quedó marcado el voto en blanco junto con otras opciones.',
        terminal: false,
      }

    case 'opcion_invalida':
      return {
        titulo: 'Revisá tu selección',
        detalle: 'Alguna de las opciones marcadas ya no existe. Volvé a cargar la página.',
        terminal: false,
      }

    case 'sin_respuesta':
      // NUNCA decir "no se registró": el request pudo haber llegado igual.
      return {
        titulo: 'No pudimos confirmar tu voto',
        detalle:
          'Se cortó la conexión y no sabemos si llegó a registrarse. Verificá antes de volver a intentar.',
        terminal: false,
      }

    case 'eleccion_inexistente':
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

// ── Reglas de la boleta (mismas que revalida `emitir_voto`) ─────────────────

/** Lo elegido en una papeleta, del lado del cliente. */
export interface SeleccionLocal {
  opciones: string[]
  blanco: boolean
}

export const SELECCION_VACIA: SeleccionLocal = { opciones: [], blanco: false }

/**
 * Valida una papeleta contra sus propias reglas. Es AYUDA VISUAL: la decisión
 * la toma `emitir_voto` en la base, que revalida todo. Devuelve `null` si está
 * bien, o el texto del problema.
 */
export function problemaDePapeleta(p: Papeleta, sel: SeleccionLocal): string | null {
  if (sel.blanco) {
    return p.permite_blanco ? null : 'Esta parte no admite voto en blanco.'
  }
  const n = new Set(sel.opciones).size
  if (n === 0) {
    // `min_selecciones = 0` es una papeleta que se puede entregar vacía aunque
    // sea obligatoria. Raro, pero la base lo acepta: acá no puede ser más
    // estricto que la validación que manda.
    if (!p.obligatoria || p.min_selecciones === 0) return null
    return p.permite_blanco
      ? 'Elegí una opción o marcá voto en blanco.'
      : 'Elegí una opción.'
  }
  if (n < p.min_selecciones) {
    return `Elegí al menos ${p.min_selecciones}.`
  }
  if (n > p.max_selecciones) {
    return `Podés elegir hasta ${p.max_selecciones}.`
  }
  return null
}

/**
 * Arma el payload de `emitir_voto`. Las papeletas NO obligatorias que quedaron
 * intactas se omiten: la RPC las saltea (`v_sel IS NULL` + `obligatoria` false).
 */
export function armarSelecciones(
  papeletas: Papeleta[],
  sel: Record<string, SeleccionLocal>,
): SeleccionPapeleta[] {
  const out: SeleccionPapeleta[] = []
  for (const p of papeletas) {
    const s = sel[p.id] ?? SELECCION_VACIA
    const opciones = Array.from(new Set(s.opciones))
    if (!s.blanco && opciones.length === 0 && !p.obligatoria) continue
    out.push({
      papeleta_id: p.id,
      opcion_ids: s.blanco ? [] : opciones,
      en_blanco: s.blanco,
    })
  }
  return out
}
