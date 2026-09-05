/**
 * Tipos del módulo de eventos (modelo PUENTE con el desktop).
 * Sin imports server-only: seguro de importar desde Client Components.
 * Coinciden con docs/supabase/22_eventos_online.sql.
 */

import { simboloMoneda } from '@/lib/format'

export type TipoParticipante = 'socio' | 'no_socio'

// ────────────────────────────────────────────────────────────────
// Multimoneda — PRECIO ESPEJO (docs/supabase/38_eventos_multimoneda.sql)
//
// Un evento puede publicar precios en varias monedas. Cada ítem con costo tiene
// un precio PROPIO E INDEPENDIENTE en cada una: el precio en dólares NO se
// deriva del de pesos, lo carga a mano quien arma el evento. NO HAY COTIZACIÓN
// EN NINGUNA PARTE DEL CIRCUITO, así que acá nunca se convierte ni se suman
// importes de monedas distintas.
//
// La persona ELIGE la moneda y toda su inscripción queda en ella (categoría,
// locomoción y alimentación). Se paga en la moneda del precio: el desktop
// bloquea la conciliación si el pago declarado viene en otra.
// ────────────────────────────────────────────────────────────────

/** Moneda en la que el evento publica precios. La BASE viene primera en la lista. */
export interface MonedaEvento {
  codigo: string
  /** Símbolo tal como lo cargó el desktop ('$', 'U$S'…). Es el que se muestra. */
  simbolo: string
  nombre: string
}

/** Extras con precio propio por moneda. */
export type ConceptoExtra = 'transporte' | 'alimentacion'

/**
 * Precio de un extra para un tipo de participante en UNA moneda.
 * Sólo existen entradas de los conceptos que el evento ofrece Y cobra: un
 * concepto disponible sin costo no aparece (es gratis en todas las monedas).
 */
export interface ExtraPrecio {
  concepto: ConceptoExtra
  tipo_participante: TipoParticipante
  moneda_codigo: string
  importe: number
}

/**
 * Precio de un extra en la moneda elegida, o null si no está definido (= gratis
 * o no ofrecido). NUNCA cae a otra moneda: mostrar pesos a quien eligió dólares
 * sería inventar un precio.
 */
export function precioExtra(
  extras: ExtraPrecio[],
  concepto: ConceptoExtra,
  tipo: TipoParticipante,
  moneda: string,
): number | null {
  const e = extras.find(
    (x) => x.concepto === concepto && x.tipo_participante === tipo && x.moneda_codigo === moneda,
  )
  return e ? e.importe : null
}

/** ¿El evento publica precios en esta moneda? */
export function esMonedaDelEvento(monedas: MonedaEvento[], codigo: string): boolean {
  return monedas.some((m) => m.codigo === codigo)
}

/**
 * Símbolo con el que mostrar un importe. Manda el que cargó el desktop; el
 * default de `simboloMoneda` es sólo la red para una moneda que no esté en la
 * lista (ej. la de una inscripción vieja).
 */
export function simboloDe(monedas: MonedaEvento[], codigo: string): string {
  return monedas.find((m) => m.codigo === codigo)?.simbolo || simboloMoneda(codigo)
}

/**
 * Datos de la cuenta donde transferir en la moneda elegida.
 *
 * El fallback a `datos_deposito` es deliberadamente literal: si el evento no
 * cargó cuenta para esa moneda, se muestra la única de siempre —que puede ser
 * la cuenta equivocada—. El desktop ya se lo avisa a quien arma el evento; acá
 * no se inventa nada más.
 */
export function datosDepositoDe(
  ev: { datos_deposito: string | null; datos_deposito_monedas?: Record<string, string> | null },
  moneda: string,
): string | null {
  const propio = ev.datos_deposito_monedas?.[moneda]
  return (propio && propio.trim()) || ev.datos_deposito
}

/**
 * Quién puede inscribirse al evento. La define el DESKTOP (ver
 * docs/supabase/evento_registro_permitido.sql); la web sólo la hace cumplir.
 *
 *   'todos'          cualquiera, incluso fuera del padrón (histórico y default)
 *   'padron'         sólo quien exista en la base, con o sin cuotas pendientes
 *   'socios_al_dia'  sólo quien pase la regla de cuotas del evento
 */
export type RegistroPermitido = 'todos' | 'padron' | 'socios_al_dia'

/**
 * Cómo decide el evento quién está "al día" (lo setea el desktop; ver
 * docs/supabase/68_tolerancia_cuotas.sql del repo desktop):
 *   'config'          cuotas_pendientes <= tolerancia del SOCIO (viene resuelta en
 *                     socios_cuotas_remoto, según su forma y tipo de pago)
 *   'fijo'            cuotas_pendientes <  umbral_cuotas_no_socio (regla histórica)
 *   'sin_restriccion' la deuda no cambia la tarifa ni la admisión
 * Un evento sin la columna (push anterior a la 68) se trata como 'fijo'.
 */
export type ModoToleranciaEvento = 'config' | 'fijo' | 'sin_restriccion'

/**
 * Regla de admisión al evento, en un solo lugar.
 *
 * La usan el formulario público (para avisar al verificar la cédula) y
 * /inscribir, que la RE-APLICA server-side: igual que con el sorteo y el
 * importe, lo que diga el cliente no se confía.
 *
 * `encontrado` = la cédula existe en el padrón. `tipo` ya trae aplicada la
 * tolerancia de cuotas (umbral_cuotas_no_socio), así que 'socios_al_dia' se
 * resuelve simplemente contra tipo === 'socio'.
 */
export function puedeInscribirse(
  politica: RegistroPermitido,
  tipo: TipoParticipante,
  encontrado: boolean,
): boolean {
  if (politica === 'socios_al_dia') return tipo === 'socio'
  if (politica === 'padron') return encontrado
  return true
}

/**
 * Estados de registro que cuentan como socio cuando la empresa NO configuró su
 * lista (ver supabase/empresa_estados_socio_remoto.sql). Se comparan por
 * PREFIJO y normalizados, así que cubren 'Activo', 'Activa', 'ACTIVOS'.
 *
 * El default no es "todos los estados": el caso conservador es no regalar la
 * tarifa de socio a quien está de baja. Cada empresa tiene su propio catálogo
 * (hay padrones con 'Eventos', 'Honorario', 'Pendiente'…), por eso lo que va
 * más allá de "Activo" lo define el desktop y no una lista fija acá.
 */
export const PREFIJOS_ESTADO_SOCIO_POR_DEFECTO = ['activ']

/** Minúsculas, sin tildes y sin espacios en los bordes: 'Activó ' → 'activo'. */
function normalizarEstadoRegistro(v: string | null | undefined): string {
  if (!v) return ''
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * ¿Este `socios_datos.estado_registro_nombre` cuenta como socio?
 *
 * `configurados` es la lista que pushea el desktop para la empresa:
 *   - `null`  → la empresa no la configuró: se aplica el default ('Activo*').
 *   - `[]`    → configurada vacía: NINGÚN estado es socio (es un valor válido,
 *               distinto de `null`; todo el padrón paga tarifa no socio).
 *   - lista   → match exacto, sin distinguir mayúsculas ni tildes.
 *
 * Un estado ausente (null o vacío) nunca es socio: no hay forma de afirmar la
 * membresía, y el default seguro es la tarifa no socio.
 */
export function esEstadoSocio(
  estado: string | null | undefined,
  configurados: string[] | null,
): boolean {
  const e = normalizarEstadoRegistro(estado)
  if (!e) return false
  if (configurados === null) {
    return PREFIJOS_ESTADO_SOCIO_POR_DEFECTO.some((p) => e.startsWith(p))
  }
  return configurados.some((c) => normalizarEstadoRegistro(c) === e)
}

/** Texto que ve quien queda excluido por la política del evento. */
export function motivoNoPuedeInscribirse(politica: RegistroPermitido): string {
  if (politica === 'socios_al_dia') {
    return 'Este evento es sólo para socios al día. Si sos socio y tenés cuotas pendientes, o tu registro figura dado de baja, regularizá tu situación o consultá con la organización.'
  }
  if (politica === 'padron') {
    return 'Este evento es sólo para personas registradas en nuestra base. Si creés que deberías estarlo, consultá con la organización.'
  }
  return ''
}

/** Modalidad de inscripción elegida en el formulario público. */
export type ModalidadInscripcion = 'reserva' | 'pago_transferencia'

/**
 * 'importado' = el desktop bajó la fila a su cola local (la organización la
 * RECIBIÓ), no que alguien validó el pago — el desktop la escribe en el mismo
 * instante en que la fila entra a la cola, todavía 'pendiente' del lado
 * desktop. 'confirmado' es el único estado que la web muestra como
 * confirmada, y hoy el desktop TODAVÍA NO LO ESCRIBE (ver
 * docs/supabase/60_eventos_web_fixes.sql): hasta que lo haga, ninguna
 * inscripción llega a 'confirmado' por este puente.
 */
export type EstadoInscripcionRemota =
  | 'pendiente'
  | 'pagado'
  | 'importado'
  | 'confirmado'
  | 'rechazado'
  | 'anulado'

/**
 * Modalidad elegida ANTES de pedir la cédula. Determina estado + mail:
 *   • preinscripcion → estado 'pendiente', modalidad 'reserva'
 *   • pago_realizado → estado 'pagado', modalidad 'pago_transferencia' + referencia
 */
export type ModalidadElegida = 'preinscripcion' | 'pago_realizado'

export interface EventoRemoto {
  id: string
  empresa_id: string
  slug: string
  nombre: string
  descripcion: string | null
  lugar: string | null
  fecha_inicio: string | null // ISO date
  fecha_fin: string | null
  tipo: 'con_costo' | 'sin_costo'
  estado: 'abierto' | 'cerrado' | 'anulado'
  cupo_maximo: number | null
  /**
   * Moneda BASE de la empresa. Se mantiene por compatibilidad y es el default
   * del selector; las monedas ofrecidas están en `monedas`.
   */
  moneda_codigo: string
  /**
   * Monedas en las que el evento publica precios, la base PRIMERO. JSONB.
   * Puede venir vacía (evento pusheado por un desktop previo a la migración 38):
   * ahí vale la moneda base — ver `normalizarMonedas`.
   */
  monedas: MonedaEvento[] | null
  /** Precios de locomoción y alimentación por moneda (JSONB). Ver `ExtraPrecio`. */
  extras_precio: ExtraPrecio[] | null
  /** Datos de cuenta por moneda: { "UYU": "Banco X…", "USD": "Banco X…" } (JSONB). */
  datos_deposito_monedas: Record<string, string> | null
  umbral_cuotas_no_socio: number
  texto_antes: string | null
  texto_despues: string | null
  email_contacto: string | null
  transporte_disponible: boolean
  transporte_con_costo: boolean
  /**
   * Importes de la MONEDA BASE. Se conservan como red de compatibilidad (un
   * push previo a la migración 38 sólo manda estos), pero el precio que se cobra
   * sale de `extras_precio`: leerlos directo le mostraría pesos a quien eligió
   * dólares. Único consumidor legítimo: `normalizarExtrasPrecio`.
   */
  transporte_importe_socio: number
  transporte_importe_no_socio: number
  transporte_descripcion: string | null
  /** Tope de plazas del transporte (NULL = sin tope, independiente del cupo del evento). */
  transporte_cupo_maximo: number | null
  alimentacion_disponible: boolean
  alimentacion_con_costo: boolean
  /** Importes de la MONEDA BASE — mismo criterio que los de transporte. */
  alimentacion_importe_socio: number
  alimentacion_importe_no_socio: number
  alimentacion_descripcion: string | null
  /** Lista de tipos de alimentación (JSON array de strings). */
  alimentacion_opciones: string | null
  /** Datos de la cuenta para pago por transferencia (texto libre, opcional). */
  datos_deposito: string | null
  /** Modalidades ofrecidas antes de pedir la cédula (las setea el desktop). */
  permitir_pago_realizado: boolean
  permitir_preinscripcion: boolean
  /** Política de admisión. La setea el desktop; default 'todos'. */
  registro_permitido: RegistroPermitido
  /** Cómo se decide "al día" (ver ModoToleranciaEvento). null = columna anterior a la migración 68. */
  modo_tolerancia: ModoToleranciaEvento | null
  /**
   * Permite categoría libre ("Otros") al inscribirse. La setea el desktop
   * (push, ver docs/supabase/38_eventos_multimoneda.sql); el efectivo que ve
   * el formulario es el AND con `evento_web_config.permitir_categoria_otros`
   * (ver `permitirCategoriaOtros`): cualquiera de los dos lados puede apagarlo.
   * `!== false` porque una fila pusheada antes de la migración 38 no tiene la
   * columna y COALESCE la deja en TRUE.
   */
  permitir_categoria_otros: boolean
  /**
   * Cupo ocupado por inscripciones cargadas A MANO en el desktop (rol
   * Asistente, activas). Las de la web no están acá: ya son filas de
   * inscripciones_evento_remoto y se cuentan solas. Lo publica el push del
   * desktop (65_eventos_puente_desktop.sql); `?? 0` cubre filas previas o la
   * migración sin aplicar.
   */
  ocupados_desktop?: number | null
  /** Ídem para el cupo propio del transporte. */
  ocupados_desktop_transporte?: number | null
  /** El evento incluye un sorteo (opt-in al inscribirse). Ver docs/supabase/31. */
  sorteo_disponible: boolean
  /**
   * Sólo socios al día pueden participar. La tolerancia de cuotas NO es propia:
   * reusa `umbral_cuotas_no_socio`, así que elegible ≡ tipo_participante 'socio'.
   * Ver el racional de privacidad en docs/supabase/31_eventos_sorteo.sql.
   */
  sorteo_solo_socios: boolean
  sorteo_descripcion: string | null
  /** Rango del número correlativo sorteable (default 0–100). */
  sorteo_numero_desde: number
  sorteo_numero_hasta: number
}

/**
 * Config de transporte tal como la ve el formulario público.
 *
 * NO lleva importes: con precio espejo cada moneda tiene el suyo, y todos viven
 * en `EventoPublico.extras_precio` (ver `precioExtra`). Tener acá los de la
 * moneda base sería la forma más fácil de mostrarle pesos a quien eligió dólares.
 */
export interface TransportePublico {
  disponible: boolean
  con_costo: boolean
  descripcion: string | null
  /**
   * Nivel de ocupación del cupo de transporte para la barra. `null` cuando el
   * transporte no tiene tope definido (no se muestra barra). Mismo racional de
   * privacidad que EventoPublico.ocupacion_nivel: sólo banda, nunca el conteo.
   */
  ocupacion_nivel: 'baja' | 'media' | 'alta' | null
  /** True si el cupo de transporte está lleno: la web bloquea la opción. */
  completo: boolean
}

/**
 * Tipo de alimentación por defecto: el que queda elegido si la persona no toca
 * el desplegable. Se antepone SIEMPRE a las opciones del evento (aun si el
 * evento no lo cargó), para que todo evento con opciones tenga un default válido.
 */
export const ALIMENTACION_SIN_RESTRICCION = 'Sin restricción'

/**
 * Opciones de alimentación que ve la persona: las del evento con
 * "Sin restricción" garantizada al frente. Lista vacía (evento sin opciones) se
 * deja vacía: ahí no hay desplegable, sólo el checkbox de reservar.
 */
export function opcionesConSinRestriccion(opciones: string[]): string[] {
  if (opciones.length === 0) return []
  const resto = opciones.filter(
    (o) => o.toLowerCase() !== ALIMENTACION_SIN_RESTRICCION.toLowerCase(),
  )
  return [ALIMENTACION_SIN_RESTRICCION, ...resto]
}

/** Config de alimentación tal como la ve el formulario público. Espejo de
 * transporte + la lista de tipos (opciones) para que la persona elija. */
export interface AlimentacionPublica {
  disponible: boolean
  con_costo: boolean
  descripcion: string | null
  /**
   * Tipos ofrecidos, con "Sin restricción" primero (el default).
   * Vacío = el evento no cargó opciones: sólo checkbox, sin desplegable.
   */
  opciones: string[]
}

/**
 * Config del sorteo tal como la ve el formulario público.
 *
 * NO lleva el rango de números ni cuántos se asignaron: el número correlativo ya
 * revela la posición a quien lo recibe por mail, no hace falta además convertir
 * la página pública en un contador de participantes. Mismo criterio que
 * EventoPublico.ocupacion_nivel: sólo banda cualitativa.
 */
export interface SorteoPublico {
  disponible: boolean
  /** Sólo socios al día. El form usa el `tipo_participante` del lookup para gatear. */
  solo_socios: boolean
  descripcion: string | null
  /** Ocupación del rango de números, en banda. null = todavía no se asignó ninguno. */
  ocupacion_nivel: 'baja' | 'media' | 'alta' | null
  /** Rango agotado: la inscripción sigue abierta, pero ya no se dan números. */
  completo: boolean
}

/**
 * Regla de elegibilidad al sorteo, en un solo lugar.
 *
 * La usan el formulario público (para decidir si ofrece el opt-in) y /inscribir,
 * que la RE-APLICA server-side: el `participa_sorteo` del body no se confía,
 * igual que el importe.
 *
 * `solo_socios` se resuelve contra `tipo_participante`, que ya trae aplicada la
 * tolerancia de cuotas (`umbral_cuotas_no_socio`). Por eso el sorteo no necesita
 * umbral propio — ver docs/supabase/31_eventos_sorteo.sql.
 */
export function elegibleParaSorteo(
  sorteo: { disponible: boolean; solo_socios: boolean },
  tipo: TipoParticipante,
): boolean {
  if (!sorteo.disponible) return false
  return !sorteo.solo_socios || tipo === 'socio'
}

/**
 * Eventos que corren en modo "solo sorteo", por slug.
 *
 * Es una lista a mano, y es deliberado: la condición estructural (sin costo +
 * sorteo + sin servicios) también da true en "Evento Imagenología Agosto 2026",
 * que SÍ es un evento al que se va y donde el sorteo es un extra opcional.
 * Distinguir los dos casos pide un flag por evento —columna en
 * evento_web_config con su toggle en /configuracion/eventos, que es donde
 * termina yendo—; mientras tanto se nombra el único evento que lo necesita.
 * Para agregar otro alcanza con sumar su slug acá.
 */
const SLUGS_SOLO_SORTEO = new Set([
  // Grupo GREI — Sorteo de Becas: Diplomado en Resonancia Magnética (ago/2026).
  'sorteo-de-becas-diplomado-en-resonancia-magnetica-d67d65e4',
])

/**
 * El evento existe SÓLO para el sorteo: no se cobra nada y no hay ningún
 * servicio que reservar, así que registrarse no significa "voy a ir a algo"
 * sino "quiero entrar al sorteo".
 *
 * Cambia tres cosas, y las tres son de honestidad, no de estética:
 *   - la participación deja de ser opt-in: la casilla "Quiero participar del
 *     sorteo" era la única forma de quedar afuera de lo único que el evento
 *     hace, y quien no la veía se iba convencido de que participaba;
 *   - los textos hablan del sorteo y no del evento ("te esperamos" es falso:
 *     no hay adónde ir);
 *   - agotado el rango de números el registro se cierra, porque anotarse sin
 *     número ya no deja nada.
 *
 * La condición estructural se exige IGUAL que el slug: si al evento le agregan
 * un costo o un servicio, el modo se apaga solo en vez de mentir.
 *
 * Se resuelve con lo que la persona VE, no con lo que el evento tiene cargado:
 * un transporte que la config web oculta no existe para quien completa el
 * formulario. El form y /inscribir aplican los mismos flags (evento + cfg), así
 * que los dos llegan al mismo veredicto.
 */
export function esSoloSorteo(v: {
  slug: string
  tipo: 'con_costo' | 'sin_costo'
  sorteoVisible: boolean
  transporteVisible: boolean
  alimentacionVisible: boolean
}): boolean {
  if (!SLUGS_SOLO_SORTEO.has(v.slug)) return false
  return (
    v.tipo !== 'con_costo' &&
    v.sorteoVisible &&
    !v.transporteVisible &&
    !v.alimentacionVisible
  )
}

/**
 * Categoría agrupada para el formulario público: una fila por categoría Y
 * MONEDA, con la tarifa socio y no socio de esa moneda.
 *
 * Con precio espejo la misma categoría aparece una vez por cada moneda del
 * evento, así que TODA lectura tiene que filtrar por la moneda elegida o la
 * grilla la muestra repetida.
 */
export interface CategoriaEvento {
  categoria_id: string
  nombre: string
  moneda_codigo: string
  precio_socio: number | null
  precio_no_socio: number | null
}

/** Categoría de socio del catálogo (sin precio) — clasificación para eventos sin costo. */
export interface CategoriaSocioPublica {
  id: string
  nombre: string
}

/**
 * Config web por evento (tabla evento_web_config, escrita sólo por la web).
 * Los flags `mostrar_*` sólo pueden OCULTAR: nunca habilitan algo que el
 * desktop no configuró (ej. transporte_disponible).
 */
export interface EventoWebConfig {
  mostrar_apellido: boolean
  apellido_obligatorio: boolean
  mostrar_email: boolean
  email_obligatorio: boolean
  mostrar_telefono: boolean
  telefono_obligatorio: boolean
  mostrar_categoria: boolean
  permitir_categoria_otros: boolean
  mostrar_transporte: boolean
  mostrar_alimentacion: boolean
  /** Oculta el opt-in al sorteo. NO lo habilita: eso es sorteo_disponible. */
  mostrar_sorteo: boolean
  mostrar_total: boolean
  permitir_pago_transferencia: boolean
  pagina_html_encabezado: string | null
  pagina_html_pie: string | null
  /** Acuse para PREINSCRIPCIÓN (modalidad 'reserva', pago pendiente). */
  mail_acuse_asunto: string | null
  mail_acuse_html: string | null
  /** Acuse para PAGO DECLARADO (modalidad 'pago_transferencia', a verificar). */
  mail_acuse_pago_asunto: string | null
  mail_acuse_pago_html: string | null
  certificado_html: string | null
  /**
   * Copia oculta del acuse a la casilla remitente, SÓLO para este evento.
   * null = heredar lo que diga la casilla de la empresa (lo normal). true/false
   * pisan ese default: un evento de inscripción masiva puede apagarla sin que
   * la empresa pierda el registro en los demás.
   */
  copia_oculta: boolean | null
  /**
   * Leyendas del formulario público. NULL = texto por defecto, que se adapta
   * solo según el evento sea con costo o sin costo (ver EventoForm). Escribir
   * una fija ese texto para ambos casos, así que conviene dejarlas vacías salvo
   * que se quiera una redacción propia.
   */
  leyenda_socio: string | null
  leyenda_no_socio: string | null
  leyenda_datos_ficha: string | null
  leyenda_sorteo: string | null
}

/**
 * Config por defecto: todo visible; apellido, email y teléfono OBLIGATORIOS.
 *
 * Los eventos alimentan el alta de socios en el desktop (una inscripción de
 * alguien que no está en el padrón crea una ficha de socio). Para que esa ficha
 * nazca completa, estos tres datos de contacto se exigen por defecto. Un evento
 * puntual puede aflojarlos desde /configuracion/eventos.
 */
export const DEFAULT_EVENTO_WEB_CONFIG: EventoWebConfig = {
  mostrar_apellido: true,
  apellido_obligatorio: true,
  mostrar_email: true,
  email_obligatorio: true,
  mostrar_telefono: true,
  telefono_obligatorio: true,
  mostrar_categoria: true,
  permitir_categoria_otros: true,
  mostrar_transporte: true,
  mostrar_alimentacion: true,
  mostrar_sorteo: true,
  mostrar_total: true,
  permitir_pago_transferencia: true,
  pagina_html_encabezado: null,
  pagina_html_pie: null,
  mail_acuse_asunto: null,
  mail_acuse_html: null,
  mail_acuse_pago_asunto: null,
  mail_acuse_pago_html: null,
  certificado_html: null,
  copia_oculta: null,
  leyenda_socio: null,
  leyenda_no_socio: null,
  leyenda_datos_ficha: null,
  leyenda_sorteo: null,
}

/** Claves de las leyendas editables del formulario público. */
export type ClaveLeyenda = 'socio' | 'no_socio' | 'datos_ficha' | 'sorteo'

/**
 * Vista previa EN TEXTO PLANO de las leyendas por defecto, para mostrarlas como
 * placeholder en /configuracion/eventos y que se vea qué aparece si el campo
 * queda vacío.
 *
 * NO es lo que renderiza el formulario: el default real vive en EventoForm con
 * su markup (íconos, negritas, colores). Acá sólo interesa el texto.
 *
 * `sinCosto` = registro sin costo (evento sin costo y sin extras pagos).
 */
export function leyendasPorDefecto(sinCosto: boolean): Record<ClaveLeyenda, string> {
  return {
    socio: sinCosto
      ? '✓ Socio al día — Registro sin costo'
      : '✓ Socio al día — Evento con costo bonificado',
    // La línea de cuotas no está acá porque no la ve todo el mundo: el
    // formulario se la agrega SÓLO al socio con cuotas pendientes (ver
    // `socio_con_deuda` en ResolucionPublica).
    no_socio: sinCosto
      ? 'Completá tus datos para registrarte.'
      : 'Completá tus datos para inscribirte. Se aplica la tarifa No socio.',
    datos_ficha:
      'Tus datos ya están registrados (los mostramos parcialmente para que los reconozcas) y no se pueden editar acá: usamos los de tu ficha, y el mail de confirmación llega con tus datos reales. Sólo tenés que completar lo que falte. Si alguno cambió, escribinos por correo y lo actualizamos.',
    sorteo: 'Te asignamos un número y te lo enviamos por correo. Sin costo.',
  }
}

/** Payload que el server manda al formulario público. */
export interface EventoPublico {
  slug: string
  nombre: string
  descripcion: string | null
  lugar: string | null
  fecha: string | null
  /**
   * Cierre del evento. En un evento normal es cuándo termina; en uno "solo
   * sorteo" (ver `esSoloSorteo`) `fecha`–`fecha_fin` es el período en que se
   * reciben registros, y es ESO lo que la página y el acuse muestran: la fecha
   * de inicio sola es el día que se abrió el formulario, un dato que no le
   * sirve a nadie. null = el evento no tiene cierre cargado.
   */
  fecha_fin: string | null
  /** Moneda base (= `monedas[0].codigo`). Es la preseleccionada en el selector. */
  moneda_codigo: string
  /**
   * Monedas que ofrece el evento, la base primero. SIEMPRE trae al menos una:
   * con una sola no se muestra selector y todo funciona como antes.
   */
  monedas: MonedaEvento[]
  /**
   * Precios de locomoción y alimentación en TODAS las monedas del evento. Van
   * completos al cliente para que cambiar de moneda no exija otra vuelta al
   * servidor. El importe se lee con `precioExtra`.
   */
  extras_precio: ExtraPrecio[]
  tipo: 'con_costo' | 'sin_costo'
  umbral_cuotas_no_socio: number
  abierto: boolean
  /**
   * Por qué no se puede inscribir, en dos partes. Van separadas porque los
   * motivos no son la misma noticia: "se completó el cupo" invita a insistir,
   * "el evento ya se realizó" no, y bajo un título fijo de "Inscripciones
   * cerradas" las dos se leían igual desde arriba. `null` con el evento abierto.
   */
  titulo_cerrado: string | null
  motivo_cerrado: string | null
  /**
   * Nivel de ocupación del cupo para el semáforo del form. `null` cuando el
   * evento no tiene cupo definido (no se muestra nada). Deliberadamente NO
   * expone el conteo real ni el % exacto: sólo una banda cualitativa, para no
   * convertir la página pública en un oráculo de asistencia.
   *   baja  (< 70%)  → verde,  "Cupos disponibles"
   *   media (70–90%) → ámbar,  "Últimos cupos"
   *   alta  (≥ 90%)  → rojo,   "Casi completo"
   */
  ocupacion_nivel: 'baja' | 'media' | 'alta' | null
  texto_antes: string | null
  texto_despues: string | null
  categorias: CategoriaEvento[]
  /** Catálogo de categorías de socio (sin precio) — se ofrece como grilla en eventos sin costo. */
  categorias_socio: CategoriaSocioPublica[]
  transporte: TransportePublico
  alimentacion: AlimentacionPublica
  sorteo: SorteoPublico
  /**
   * El evento existe sólo para el sorteo. Lo resuelve el server con
   * `esSoloSorteo` y viaja resuelto para que la página, el formulario y
   * /inscribir no puedan discrepar.
   */
  solo_sorteo: boolean
  /** Config web del evento (visibilidad + HTML propio). Nunca null: cae a defaults. */
  config: EventoWebConfig
  /** Datos de depósito/transferencia (null si el evento no los tiene cargados). */
  datos_deposito: string | null
  /**
   * Datos de cuenta POR MONEDA. Nadie transfiere dólares a una cuenta en pesos:
   * se muestran los de la moneda elegida (ver `datosDepositoDe`).
   */
  datos_deposito_monedas: Record<string, string>
  /** Modalidades ofrecidas antes de pedir la cédula (las setea el desktop). */
  permitir_pago_realizado: boolean
  permitir_preinscripcion: boolean
  /**
   * Política de admisión del evento. Se expone para que el formulario explique
   * el rechazo; el veredicto por cédula viaja en ResolucionPublica y se
   * re-decide server-side al inscribir.
   */
  registro_permitido: RegistroPermitido
  modo_tolerancia: ModoToleranciaEvento
}

/**
 * Lo que efectivamente lee `<EventoForm>` (y, a través suyo, `<RegistrarPago>`)
 * de `EventoPublico` — verificado con grep sobre los dos componentes, no a ojo.
 *
 * Recorta a propósito TODO lo que el form no usa y que viajaría igual si se le
 * pasara `EventoPublico` completo: `mail_acuse_html`, `mail_acuse_pago_html`,
 * `certificado_html`, `pagina_html_encabezado/pie` y las leyendas CRUDAS (el
 * form recibe las leyendas ya saneadas aparte, como prop `leyendas`). Esos
 * campos son los que un evento con un logo de 300 KB en base64 pegado en el
 * encabezado duplica en cada carga de `/e/{slug}` (ver P7c). `page.tsx` arma
 * este objeto a mano en vez de pasar `evento` entero.
 */
export interface EventoFormProps {
  slug: string
  nombre: string
  tipo: 'con_costo' | 'sin_costo'
  moneda_codigo: string
  monedas: MonedaEvento[]
  extras_precio: ExtraPrecio[]
  abierto: boolean
  titulo_cerrado: string | null
  motivo_cerrado: string | null
  texto_despues: string | null
  categorias: CategoriaEvento[]
  categorias_socio: CategoriaSocioPublica[]
  transporte: TransportePublico
  alimentacion: AlimentacionPublica
  sorteo: SorteoPublico
  solo_sorteo: boolean
  datos_deposito: string | null
  datos_deposito_monedas: Record<string, string>
  permitir_pago_realizado: boolean
  permitir_preinscripcion: boolean
  registro_permitido: RegistroPermitido
  /** Sólo los flags de visibilidad/obligatoriedad que el form consulta. */
  config: Pick<
    EventoWebConfig,
    | 'mostrar_apellido'
    | 'apellido_obligatorio'
    | 'mostrar_email'
    | 'email_obligatorio'
    | 'mostrar_telefono'
    | 'telefono_obligatorio'
    | 'mostrar_categoria'
    | 'permitir_categoria_otros'
    | 'mostrar_transporte'
    | 'mostrar_alimentacion'
    | 'mostrar_sorteo'
    | 'mostrar_total'
    | 'permitir_pago_transferencia'
  >
}

/** Arma un `EventoFormProps` a partir del payload completo (ver su comentario). */
export function proyectarEventoFormProps(evento: EventoPublico): EventoFormProps {
  return {
    slug: evento.slug,
    nombre: evento.nombre,
    tipo: evento.tipo,
    moneda_codigo: evento.moneda_codigo,
    monedas: evento.monedas,
    extras_precio: evento.extras_precio,
    abierto: evento.abierto,
    titulo_cerrado: evento.titulo_cerrado,
    motivo_cerrado: evento.motivo_cerrado,
    texto_despues: evento.texto_despues,
    categorias: evento.categorias,
    categorias_socio: evento.categorias_socio,
    transporte: evento.transporte,
    alimentacion: evento.alimentacion,
    sorteo: evento.sorteo,
    solo_sorteo: evento.solo_sorteo,
    datos_deposito: evento.datos_deposito,
    datos_deposito_monedas: evento.datos_deposito_monedas,
    permitir_pago_realizado: evento.permitir_pago_realizado,
    permitir_preinscripcion: evento.permitir_preinscripcion,
    registro_permitido: evento.registro_permitido,
    config: {
      mostrar_apellido: evento.config.mostrar_apellido,
      apellido_obligatorio: evento.config.apellido_obligatorio,
      mostrar_email: evento.config.mostrar_email,
      email_obligatorio: evento.config.email_obligatorio,
      mostrar_telefono: evento.config.mostrar_telefono,
      telefono_obligatorio: evento.config.telefono_obligatorio,
      mostrar_categoria: evento.config.mostrar_categoria,
      permitir_categoria_otros: evento.config.permitir_categoria_otros,
      mostrar_transporte: evento.config.mostrar_transporte,
      mostrar_alimentacion: evento.config.mostrar_alimentacion,
      mostrar_sorteo: evento.config.mostrar_sorteo,
      mostrar_total: evento.config.mostrar_total,
      permitir_pago_transferencia: evento.config.permitir_pago_transferencia,
    },
  }
}

/** Validación pública de un certificado (leído por /c/[token]). */
export interface CertificadoPublico {
  token: string
  estado: 'valido' | 'revocado'
  /** Permite resolver la config web del evento (evento_web_config). Puede faltar. */
  evento_id: string | null
  evento_nombre: string
  evento_fecha: string | null
  evento_lugar: string | null
  nombre_completo: string
  categoria_nombre: string | null
  numero: string | null
  emitido_at: string | null
}

/**
 * Lo ÚNICO que el endpoint público /lookup devuelve al navegador.
 *
 * NO incluye nombre/apellido/mail EN CLARO, socio_id ni el número de cuotas
 * pendientes: el endpoint no tiene autenticación, así que cualquiera podría
 * enumerar cédulas y cosechar esos datos.
 *
 * SÍ incluye versiones ENMASCARADAS (`*_mask`) para que la persona se reconozca al
 * verificar su cédula. Es un compromiso: filtra iniciales + dominio de mail a un
 * endpoint público. El dato en claro nunca baja; el front las usa sólo como
 * placeholder y, si deja el campo vacío, el server lo completa desde la ficha al
 * inscribir.
 *
 * Los masks se entregan a TODO el padrón, incluido el socio con cuotas
 * pendientes: si no, tendría que re-escribir datos que la organización ya tiene.
 * Consecuencia asumida: la PRESENCIA de masks es el bit de pertenencia al padrón.
 *
 * `socio_con_deuda` va más lejos y dice directamente que esa cédula es de un
 * socio que debe cuotas. Es una decisión de producto: los avisos de cuotas y de
 * sorteo sólo le sirven a esa persona, y mostrárselos a quien nunca fue socio
 * —el resto del padrón— lo confunde. Lo que sigue protegiendo el endpoint es el
 * tope por IP (ver lib/rate-limit) y que el NÚMERO de cuotas nunca se serializa.
 */
export interface ResolucionPublica {
  tipo_participante: TipoParticipante
  /**
   * Es socio por estado de registro pero NO está al día: el único caso en que
   * hablarle de cuotas tiene sentido. Todo el resto de los `no_socio` (quien no
   * está en el padrón y quien está con un estado que no es de socio) lo recibe
   * en false y no ve ningún aviso de cuotas ni de sorteo. Ver el costo de
   * privacidad en el comentario de esta interfaz.
   */
  socio_con_deuda: boolean
  /** Categoría del socio, para pre-seleccionar la tarifa. null si no se resolvió. */
  categoria_id: string | null
  /** Nombre enmascarado (ej. "PR•••"). null si la cédula no está en el padrón. */
  nombre_mask: string | null
  /** Apellido enmascarado. null si no está en el padrón o no tiene. */
  apellido_mask: string | null
  /** Mail enmascarado (ej. "b•••@gmail.com"). null si no está en el padrón o no tiene. */
  mail_mask: string | null
  /** Teléfono enmascarado (ej. "•••456"). null si no está en el padrón o no tiene. */
  telefono_mask: string | null
  /**
   * Inscripción vigente de esta cédula en este evento, si ya se inscribió.
   * Se expone para avisarlo al verificar en vez de dejar que llene todo el
   * formulario y choque con el 409 al enviar. No agrega superficie: el mismo
   * hecho ya se filtraba por el 409 de /inscribir, y ambos endpoints tienen
   * tope por IP.
   */
  inscripcion_previa: InscripcionPrevia | null
  /**
   * Veredicto de la política de admisión para ESTA cédula, resuelto server-side.
   * El formulario lo usa para avisar al verificar en vez de dejar que complete
   * todo; /inscribir lo vuelve a calcular y no confía en el cliente.
   *
   * Con 'padron' este booleano ES el bit de pertenencia al padrón: es el costo
   * de privacidad asumido al elegir esa política (ver el SQL de la columna).
   */
  puede_inscribirse: boolean
  /**
   * La cédula no pasa el dígito verificador Y no está en el padrón: es un error
   * de tipeo de alguien que se registra por primera vez. A los que YA están en el
   * padrón nunca se les exige el DV (hay documentos históricos que no cumplen).
   * Ver lib/cedula.
   */
  cedula_invalida: boolean
}

/**
 * Inscripción ya registrada para una cédula en un evento (aviso al verificar).
 * Lleva lo necesario para que la persona sepa CÓMO quedó registrada: modalidad
 * (pago declarado vs. preinscripción), estado y cuánto falta abonar.
 *
 * NO lleva `numero_sorteo` a propósito. Este payload lo sirve un endpoint público
 * sin autenticación: incluirlo permitiría enumerar cédulas y armar el mapa
 * cédula → número sorteable de todo el evento. Quien perdió el mail recupera su
 * número por POST /api/eventos/[slug]/reenviar-acuse, que manda la copia al mail
 * guardado en la inscripción y nunca a uno elegido por el requester.
 */
export interface InscripcionPrevia {
  numero: string | null
  estado: EstadoInscripcionRemota
  modalidad: ModalidadInscripcion
  /**
   * Nombre y apellido ENMASCARADOS tal como quedaron en la inscripción (ej.
   * "MA••• BE•••"). Sirve para que la persona reconozca su registro sin que el
   * dato en claro baje a un endpoint público. null si la inscripción no tiene nombre.
   */
  nombre_mask: string | null
  categoria_nombre: string | null
  /** Suma de inscripción + transporte + alimentación. */
  total: number
  moneda_codigo: string
  /** Referencia de transferencia declarada (sólo en modalidad pago_transferencia). */
  referencia_transferencia: string | null
  /**
   * Mail ENMASCARADO al que se enviaría la copia del comprobante (ej.
   * "b•••@gmail.com"). null si la inscripción no tiene mail: en ese caso no se
   * ofrece el reenvío. El mail en claro nunca baja al navegador.
   */
  mail_mask: string | null
}

/** Resultado interno de resolver la cédula. NUNCA se serializa al cliente. */
export interface ResolucionParticipante {
  encontrado: boolean
  socio_id: string | null
  nombre: string
  apellido: string
  mail: string
  telefono: string
  cuotas_pendientes: number | null
  /**
   * Estado de registro de la ficha ('Activo', 'Baja', 'Eventos'…). Junto con las
   * cuotas decide `tipo_participante` (ver esEstadoSocio). Es dato INTERNO: no
   * se serializa al navegador, ver ResolucionPublica.
   */
  estado_registro_nombre: string | null
  /**
   * El estado de la ficha cuenta como socio (típicamente 'Activo'), sin mirar
   * las cuotas. Se resuelve acá porque la lista de estados válidos es de la
   * empresa y el navegador no la tiene. Junto con `tipo_participante` separa los
   * dos motivos de "no socio": estado que no es de socio vs. deuda.
   */
  estado_es_socio: boolean
  tipo_participante: TipoParticipante
  /** Categoría del socio definida en la BD (para pre-seleccionar y sugerir tarifa). */
  categoria_id: string | null
  categoria_nombre: string | null
}
