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
  /**
   * Los estados que alguien puede llegar a ver. Desde `53_` la elección sigue
   * publicada después del acto: el link personal y el `{base}/e/{slug}` ya están
   * repartidos, y hacerlos desaparecer hace que la página diga "el link no es
   * válido" el día después de votar, que es cuando más gente vuelve a abrirlos.
   *
   * `ventana` no depende de esto —Postgres devuelve `cerrada` para todo lo que
   * no sea `abierta`—: el estado sólo elige las palabras.
   */
  estado: EstadoActo
}

export type EstadoActo = 'padron' | 'abierta' | 'cerrada' | 'escrutada' | 'archivada' | 'anulada'

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
  /**
   * Cuándo votó, si votó. `null` mientras no haya votado —y también contra una
   * base sin `54_buscar_credencial_emitido_at.sql`, que es un caso que las
   * pantallas tienen que aguantar: dicen "ya votaste" sin la fecha—.
   */
  emitido_at: string | null
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
  /** Desde 61_. `null` contra una base sin ese script, o si la elección no lo tiene cargado. */
  email_contacto: string | null
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
  /**
   * Id de la papeleta que falló. Desde 61_: señalar por título se rompe si
   * dos papeletas comparten nombre. Se prefiere este campo y `papeleta` queda
   * como respaldo contra una base sin ese script.
   */
  papeleta_id?: string
  min?: number
  max?: number
  /** `no_habilitado` desde `resolver_codigo` (61_): a quién escribirle. */
  email_contacto?: string | null
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

/**
 * Cómo se pinta un aviso. Los mismos tres que usa la portada de `/v/[token]`:
 * un hecho normal, algo que hay que atender, algo que corta.
 */
export type TonoAviso = 'ok' | 'medio' | 'alto'

export interface MensajeVotacion {
  titulo: string
  detalle: string
  /** `true` = no hay nada que reintentar en esta sesión: se corta el flujo. */
  terminal: boolean
  /**
   * Por defecto 'alto'. Que exista no es cosmética: "ya votaste" es una buena
   * noticia y en tono alto se lee como un error. La portada ya lo pintaba en
   * 'ok' y el mismo mensaje, alcanzado a mitad del flujo, salía en rojo.
   */
  tono: TonoAviso
}

/** Cómo se anuncia una votación en la que ya no se puede votar. */
export interface CierreDeLaVotacion {
  /** Una línea, para debajo del título: reemplaza al "se puede votar hasta el…". */
  linea: string
  titulo: string
  detalle: string
}

/**
 * Lo mínimo para poder explicar un cierre. Se pide así y no la elección entera
 * para que lo pueda pasar también el componente cliente, que necesita las
 * mismas palabras cuando la votación cierra con la persona adentro.
 */
export type CierreCtx = Pick<EleccionPublica, 'estado' | 'fecha_cierre' | 'email_contacto'>

/**
 * Por qué esta votación ya no recibe votos, en palabras.
 *
 * **El estado manda sobre la fecha.** Una elección que la comisión cerró antes
 * de la hora no puede anunciar la hora que figuraba —"cerró a las 20:00" leído a
 * las 18:00 es una hora futura y hace pensar que la página está rota—, y una
 * anulada no cerró nunca: se dejó sin efecto, que no es lo mismo.
 *
 * Nada de esto habla de resultados: en la web no hay conteo, ni parcial ni
 * final, y este texto no puede ser la primera vez que eso cambie. Quien pregunta
 * "¿quién ganó?" tiene que salir de acá sabiendo que lo comunica la institución.
 *
 * `cerrada_web` NO pasa por acá y es a propósito: esa persona todavía puede
 * votar, en el local. Ver `VentanaEleccion`.
 */
export function cierreDeLaVotacion(
  e: CierreCtx,
  emailContacto: string | null,
): CierreDeLaVotacion {
  const mail = emailContacto ?? e.email_contacto
  const escribinos = mail ? ` Si creés que es un error, escribinos a ${mail}.` : ''

  if (e.estado === 'anulada') {
    return {
      linea: 'Esta elección quedó sin efecto',
      titulo: 'La elección quedó sin efecto',
      detalle:
        `La institución la dejó sin efecto: no se emiten votos y no hay resultado.${escribinos}`,
    }
  }
  if (e.estado === 'escrutada' || e.estado === 'archivada') {
    return {
      linea: 'La votación terminó · ya se escrutó',
      titulo: 'La votación terminó',
      detalle:
        'Los votos ya se contaron y no se puede votar más. El resultado lo comunica la ' +
        `institución: acá no se publica.${escribinos}`,
    }
  }
  // Cerrada por la hora: la fecha explica sola qué pasó y cuándo.
  // `horaAperturaPasada` es "este instante ya pasó"; sirve igual para el cierre.
  if (horaAperturaPasada(e.fecha_cierre)) {
    return {
      linea: `La votación cerró el ${fechaHoraCorta(e.fecha_cierre)}`,
      titulo: 'La votación está cerrada',
      detalle: `Cerró el ${fechaHoraCorta(e.fecha_cierre)} y ya no se pueden emitir votos.${escribinos}`,
    }
  }
  // Cerrada a mano, antes de la hora anunciada.
  return {
    linea: 'La votación ya cerró',
    titulo: 'La votación está cerrada',
    detalle:
      'La comisión la cerró antes de la hora prevista y ya no se pueden emitir ' +
      `votos.${escribinos}`,
  }
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
 *
 * `eleccion` es opcional y sirve para una sola cosa: que un cierre alcanzado a
 * mitad del flujo se cuente con las mismas palabras que un cierre encontrado al
 * abrir el link. Ver el caso `eleccion_cerrada`.
 */
export function mensajeDeError(
  r: ErrorVotacion,
  emailContacto: string | null,
  eleccion?: CierreCtx,
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
          tono: 'alto',
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
        tono: 'alto',
      }

    case 'bloqueado': {
      const hora = formatHoraUY(r.hasta)
      return {
        titulo: 'Demasiados intentos',
        detalle: hora
          ? `Probá de nuevo después de las ${hora}.`
          : 'Esperá unos minutos y volvé a probar.',
        terminal: true,
        tono: 'alto',
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
        // Haber votado no es un error: es exactamente lo que tenía que pasar.
        tono: 'ok',
      }
    }

    case 'no_habilitado':
      return {
        titulo: 'Esta credencial fue dada de baja',
        detalle: `Ya no habilita a votar.${contacto}`,
        terminal: true,
        tono: 'alto',
      }

    case 'eleccion_cerrada': {
      // Con la elección a mano se cuenta igual que en la portada: escrutada,
      // anulada, cerrada por la hora o cerrada a mano por la comisión. Sin ella
      // —`emitir_voto` no manda de qué cierre habla— queda el texto genérico.
      //
      // El reloj que decide las palabras acá es el del navegador y no el de
      // Postgres, a diferencia de la portada. Sólo puede errarle en los minutos
      // pegados a la hora de cierre, y entre las dos frases posibles: las dos
      // dicen que está cerrada. Quién puede votar no se decide acá.
      if (eleccion) {
        const c = cierreDeLaVotacion(eleccion, emailContacto)
        return { titulo: c.titulo, detalle: c.detalle, terminal: true, tono: 'alto' }
      }
      return {
        titulo: 'La votación está cerrada',
        detalle: `Ya no se pueden emitir votos.${contacto}`,
        terminal: true,
        tono: 'alto',
      }
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
        // No es un error ni un cierre: es un cambio de canal, y esta persona
        // todavía tiene algo que hacer.
        tono: 'medio',
      }
    }

    case 'no_abierta': {
      // `validar_credencial` manda `desde` desde 43_. La portada ya decía la
      // fecha y acá se decía "cuando empiece", como si no la supiéramos.
      // `emitir_voto` no la manda: ahí se cae al texto sin fecha.
      const desde = fechaHoraCorta(r.desde)
      return {
        titulo: 'La votación todavía no está abierta',
        detalle: desde
          ? `Abre el ${desde}. Volvé a entrar con este mismo link.`
          : 'Volvé a entrar con este mismo link cuando empiece.',
        terminal: true,
        tono: 'medio',
      }
    }

    case 'falta_papeleta':
      return {
        titulo: 'Falta completar una parte',
        detalle: r.papeleta
          ? `Todavía no elegiste nada en «${r.papeleta}».`
          : 'Todavía hay una parte de la boleta sin completar.',
        terminal: false,
        tono: 'alto',
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
        tono: 'alto',
      }
    }

    case 'blanco_no_admitido':
      return {
        titulo: 'No se admite voto en blanco',
        detalle: r.papeleta
          ? `«${r.papeleta}» no admite voto en blanco.`
          : 'Esa parte de la boleta no admite voto en blanco.',
        terminal: false,
        tono: 'alto',
      }

    case 'blanco_con_opciones':
      return {
        titulo: 'Revisá tu selección',
        detalle: r.papeleta
          ? `En «${r.papeleta}» quedó marcado el voto en blanco junto con otras opciones.`
          : 'Quedó marcado el voto en blanco junto con otras opciones.',
        terminal: false,
        tono: 'alto',
      }

    case 'opcion_invalida':
      return {
        titulo: 'Revisá tu selección',
        detalle: 'Alguna de las opciones marcadas ya no existe. Volvé a cargar la página.',
        terminal: false,
        tono: 'alto',
      }

    case 'sin_respuesta':
      // NUNCA decir "no se registró": el request pudo haber llegado igual.
      return {
        titulo: 'No pudimos confirmar tu voto',
        detalle:
          'Se cortó la conexión y no sabemos si llegó a registrarse. Verificá antes de volver a intentar.',
        terminal: false,
        tono: 'medio',
      }

    case 'eleccion_inexistente':
      return {
        titulo: 'El link no es válido',
        detalle: `Revisá que hayas abierto el link completo del mail.${contacto}`,
        terminal: true,
        tono: 'alto',
      }

    default:
      return {
        titulo: 'No pudimos completar la operación',
        detalle: `Volvé a probar en un momento.${contacto}`,
        terminal: false,
        tono: 'alto',
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
