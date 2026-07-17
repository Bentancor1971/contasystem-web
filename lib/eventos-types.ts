/**
 * Tipos del módulo de eventos (modelo PUENTE con el desktop).
 * Sin imports server-only: seguro de importar desde Client Components.
 * Coinciden con docs/supabase/22_eventos_online.sql.
 */

export type TipoParticipante = 'socio' | 'no_socio'

/** Modalidad de inscripción elegida en el formulario público. */
export type ModalidadInscripcion = 'reserva' | 'pago_transferencia'

export type EstadoInscripcionRemota =
  | 'pendiente'
  | 'pagado'
  | 'importado'
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
  moneda_codigo: string
  umbral_cuotas_no_socio: number
  texto_antes: string | null
  texto_despues: string | null
  email_contacto: string | null
  transporte_disponible: boolean
  transporte_con_costo: boolean
  transporte_importe_socio: number
  transporte_importe_no_socio: number
  transporte_descripcion: string | null
  /** Tope de plazas del transporte (NULL = sin tope, independiente del cupo del evento). */
  transporte_cupo_maximo: number | null
  alimentacion_disponible: boolean
  alimentacion_con_costo: boolean
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

/** Config de transporte tal como la ve el formulario público. */
export interface TransportePublico {
  disponible: boolean
  con_costo: boolean
  importe_socio: number
  importe_no_socio: number
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
  importe_socio: number
  importe_no_socio: number
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

/** Categoría agrupada para el formulario público (una fila por categoría, con ambos precios). */
export interface CategoriaEvento {
  categoria_id: string
  nombre: string
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
}

/** Payload que el server manda al formulario público. */
export interface EventoPublico {
  slug: string
  nombre: string
  descripcion: string | null
  lugar: string | null
  fecha: string | null
  moneda_codigo: string
  tipo: 'con_costo' | 'sin_costo'
  umbral_cuotas_no_socio: number
  abierto: boolean
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
  /** Config web del evento (visibilidad + HTML propio). Nunca null: cae a defaults. */
  config: EventoWebConfig
  /** Datos de depósito/transferencia (null si el evento no los tiene cargados). */
  datos_deposito: string | null
  /** Modalidades ofrecidas antes de pedir la cédula (las setea el desktop). */
  permitir_pago_realizado: boolean
  permitir_preinscripcion: boolean
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
 * SÍ incluye versiones ENMASCARADAS (`*_mask`) para que el socio se reconozca al
 * verificar su cédula. Es un compromiso: filtra iniciales + dominio de mail a un
 * endpoint público. El dato en claro nunca baja; el front las usa sólo como
 * placeholder y, si el socio deja el campo vacío, el server lo completa desde la
 * ficha al inscribir.
 *
 * `tipo_participante` es inevitable (el precio depende de él), pero colapsa dos
 * casos —"no es socio" y "socio con cuotas pendientes"— en un mismo `no_socio`,
 * de modo que no revela el estado de deuda de nadie.
 */
export interface ResolucionPublica {
  tipo_participante: TipoParticipante
  /** Categoría del socio, para pre-seleccionar la tarifa. null si no se resolvió. */
  categoria_id: string | null
  /** Nombre enmascarado (ej. "PR•••"). null si no se resolvió el socio. */
  nombre_mask: string | null
  /** Apellido enmascarado. null si no se resolvió o no tiene. */
  apellido_mask: string | null
  /** Mail enmascarado (ej. "b•••@gmail.com"). null si no se resolvió o no tiene. */
  mail_mask: string | null
  /** Teléfono enmascarado (ej. "•••456"). null si no se resolvió o no tiene. */
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
  tipo_participante: TipoParticipante
  /** Categoría del socio definida en la BD (para pre-seleccionar y sugerir tarifa). */
  categoria_id: string | null
  categoria_nombre: string | null
}
