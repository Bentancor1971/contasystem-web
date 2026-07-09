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
  | 'importado'
  | 'rechazado'
  | 'anulado'

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
  alimentacion_disponible: boolean
  alimentacion_con_costo: boolean
  alimentacion_importe_socio: number
  alimentacion_importe_no_socio: number
  alimentacion_descripcion: string | null
  /** Lista de tipos de alimentación (JSON array de strings). */
  alimentacion_opciones: string | null
  /** Datos de la cuenta para pago por transferencia (texto libre, opcional). */
  datos_deposito: string | null
}

/** Config de transporte tal como la ve el formulario público. */
export interface TransportePublico {
  disponible: boolean
  con_costo: boolean
  importe_socio: number
  importe_no_socio: number
  descripcion: string | null
}

/** Config de alimentación tal como la ve el formulario público. Espejo de
 * transporte + la lista de tipos (opciones) para que la persona elija. */
export interface AlimentacionPublica {
  disponible: boolean
  con_costo: boolean
  importe_socio: number
  importe_no_socio: number
  descripcion: string | null
  /** Tipos ofrecidos (Estándar, Vegetariano, …). Vacío = solo checkbox. */
  opciones: string[]
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
  texto_antes: string | null
  texto_despues: string | null
  categorias: CategoriaEvento[]
  /** Catálogo de categorías de socio (sin precio) — se ofrece como grilla en eventos sin costo. */
  categorias_socio: CategoriaSocioPublica[]
  transporte: TransportePublico
  alimentacion: AlimentacionPublica
  /** Datos de depósito/transferencia (null si el evento no los tiene cargados). */
  datos_deposito: string | null
}

/** Validación pública de un certificado (leído por /c/[token]). */
export interface CertificadoPublico {
  token: string
  estado: 'valido' | 'revocado'
  evento_nombre: string
  evento_fecha: string | null
  evento_lugar: string | null
  nombre_completo: string
  categoria_nombre: string | null
  numero: string | null
  emitido_at: string | null
}

/** Resultado de resolver la cédula: quién es y qué precio le toca. */
export interface ResolucionParticipante {
  encontrado: boolean
  socio_id: string | null
  nombre: string
  apellido: string
  mail: string
  cuotas_pendientes: number | null
  tipo_participante: TipoParticipante
}
