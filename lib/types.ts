/**
 * Tipos TS para las tablas remotas en Supabase.
 * Coinciden con docs/supabase/05_comprobantes_online.sql del repo desktop.
 */

export type EstadoComprobante = 'pendiente' | 'importado' | 'rechazado'
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

export interface PlantillaRemota {
  id: string
  empresa_id: string
  nombre: string
  iva_porcentaje: number
  descripcion_default: string | null
  activo: number
  row_updated_at: string
  created_at: string
}

export interface ComprobanteRemoto {
  id: string
  empresa_id: string
  plantilla_id: string
  contacto_id: string | null
  fecha: string                // ISO date YYYY-MM-DD
  moneda_codigo: string
  monto_total: number
  descripcion: string | null
  numero_borrador: string | null
  numero_oficial: string | null
  estado: EstadoComprobante
  asiento_id_local: string | null
  motivo_rechazo: string | null
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
  contacto_nombre?: string | null
}
