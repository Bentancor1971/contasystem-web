/**
 * Tipos TS para las tablas remotas en Supabase.
 * Coinciden con docs/supabase/05_comprobantes_online.sql del repo desktop.
 */

export type EstadoComprobante =
  | 'pendiente'
  | 'importado'
  | 'rechazado'
  | 'anulacion_solicitada'
  | 'anulado'
export type TipoContacto = 'proveedor' | 'otro' | 'cliente'

export interface EmpresaOnline {
  empresa_id: string
  grupo_id: string | null
  nombre: string
  rut: string | null
  moneda_base_codigo: string
  habilitada: number
  row_updated_at: string
  created_at: string
}

export interface ContactoRemoto {
  id: string
  grupo_id: string | null
  empresa_id: string | null
  nombre_razon_social: string
  rut_ci: string | null
  tipo: TipoContacto
  email: string | null
  telefono: string | null
  activo: number
  visible_web: number
  row_updated_at: string
  created_at: string
}

export type MedioTipo = 'efectivo' | 'banco' | 'tarjeta'

export interface HaberOption {
  id: string
  nombre: string
  /** Código de moneda de la cuenta (UYU, USD, …). Puede faltar en plantillas
   *  sincronizadas con versiones desktop viejas — en ese caso no se valida. */
  moneda: string | null
  medio_tipo: MedioTipo | null
  sello: string | null
  emisor: string | null
  logo_key: string | null
  /**
   * Solo para tarjetas: true si es de crédito. Cuando true, al elegir esta
   * opción la web muestra una advertencia "se cargará como Compra Crédito".
   */
  es_credito: boolean | null
}

export interface PlantillaRemota {
  id: string
  empresa_id: string
  nombre: string
  iva_porcentaje: number
  descripcion_default: string | null
  cuenta_debe_nombre: string | null
  cuenta_debe_moneda: string | null
  cuenta_haber_id: string | null
  cuenta_haber_nombre: string | null
  cuenta_haber_moneda: string | null
  cuenta_haber_medio_tipo: MedioTipo | null
  cuenta_haber_sello: string | null
  cuenta_haber_emisor: string | null
  cuenta_haber_logo_key: string | null
  cuenta_haber_es_credito: boolean | null
  cuenta_iva_nombre: string | null
  /** Auto-promote: tipo a usar si pagás con tarjeta crédito (display name). */
  tipo_comprobante_credito_id: string | null
  tipo_credito_nombre: string | null
  haberes_alternativos: HaberOption[]
  /** Contacto asociado opcional. Si está seteado, la web pre-rellena y bloquea
   *  el selector al elegir esta plantilla (override por carga via "cambiar"). */
  contacto_id: string | null
  contacto_nombre: string | null
  activo: number
  row_updated_at: string
  created_at: string
}

export interface TipoComprobanteRemoto {
  id: string
  empresa_id: string
  abreviacion: string
  nombre: string
  clasificacion: string | null
  activo: number
  row_updated_at: string
  created_at: string
}

export type TipoCuenta = 'ingreso' | 'egreso'

export interface CuentaRemota {
  id: string
  empresa_id: string
  codigo: string
  nombre: string
  tipo: TipoCuenta
  moneda_codigo: string
  activo: number
  row_updated_at: string
  created_at: string
}

export interface ComprobanteRemoto {
  id: string
  empresa_id: string
  plantilla_id: string | null
  contacto_id: string | null
  fecha: string                // ISO date YYYY-MM-DD
  moneda_codigo: string
  monto_total: number
  descripcion: string | null
  cuenta_haber_override_id: string | null
  cuenta_haber_override_nombre: string | null
  cuenta_debe_libre_id: string | null
  cuenta_debe_libre_nombre: string | null
  cuenta_haber_libre_id: string | null
  cuenta_haber_libre_nombre: string | null
  contacto_nombre: string | null
  tipo_comprobante_id: string | null
  tipo_comprobante_nombre: string | null
  numero_borrador: string | null
  numero_oficial: string | null
  estado: EstadoComprobante
  asiento_id_local: string | null
  motivo_rechazo: string | null
  anulacion_solicitada_at: string | null
  anulacion_motivo: string | null
  anulacion_confirmada_at: string | null
  nota_credito_asiento_id: string | null
  created_by: string
  created_at: string
  impactado_at: string | null
  row_updated_at: string
}

/**
 * Comprobante con joins resueltos para mostrar en la lista "Últimos 20".
 */
export interface ComprobanteListItem extends ComprobanteRemoto {
  plantilla_nombre?: string
}
