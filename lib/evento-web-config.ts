/**
 * Store de la config web por evento (tabla evento_web_config).
 *
 * Server-only: recibe el admin client (service_role) por parámetro.
 * Tolera que la tabla todavía no exista (cae a defaults) para que la página
 * pública no se rompa antes de correr supabase/evento_web_config.sql.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_EVENTO_WEB_CONFIG, type EventoWebConfig } from '@/lib/eventos-types'
import { esTablaInexistente } from '@/lib/birthday-template-store'

export const EVENTO_CONFIG_TABLE = 'evento_web_config'

/** Columnas de config (sin evento_id/empresa_id/metadata). */
export const EVENTO_CONFIG_COLUMNS = [
  'mostrar_apellido',
  'apellido_obligatorio',
  'mostrar_email',
  'email_obligatorio',
  'mostrar_telefono',
  'telefono_obligatorio',
  'mostrar_categoria',
  'permitir_categoria_otros',
  'mostrar_transporte',
  'mostrar_alimentacion',
  'mostrar_sorteo',
  'mostrar_total',
  'permitir_pago_transferencia',
  'pagina_html_encabezado',
  'pagina_html_pie',
  'mail_acuse_asunto',
  'mail_acuse_html',
  'mail_acuse_pago_asunto',
  'mail_acuse_pago_html',
  'certificado_html',
] as const

const SELECT = EVENTO_CONFIG_COLUMNS.join(', ')

/** Normaliza una fila cruda a EventoWebConfig, completando con defaults. */
export function rowToConfig(row: Record<string, unknown> | null): EventoWebConfig {
  if (!row) return { ...DEFAULT_EVENTO_WEB_CONFIG }
  const d = DEFAULT_EVENTO_WEB_CONFIG
  const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def)
  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v : null
  return {
    mostrar_apellido: bool(row.mostrar_apellido, d.mostrar_apellido),
    apellido_obligatorio: bool(row.apellido_obligatorio, d.apellido_obligatorio),
    mostrar_email: bool(row.mostrar_email, d.mostrar_email),
    email_obligatorio: bool(row.email_obligatorio, d.email_obligatorio),
    mostrar_telefono: bool(row.mostrar_telefono, d.mostrar_telefono),
    telefono_obligatorio: bool(row.telefono_obligatorio, d.telefono_obligatorio),
    mostrar_categoria: bool(row.mostrar_categoria, d.mostrar_categoria),
    permitir_categoria_otros: bool(row.permitir_categoria_otros, d.permitir_categoria_otros),
    mostrar_transporte: bool(row.mostrar_transporte, d.mostrar_transporte),
    mostrar_alimentacion: bool(row.mostrar_alimentacion, d.mostrar_alimentacion),
    mostrar_sorteo: bool(row.mostrar_sorteo, d.mostrar_sorteo),
    mostrar_total: bool(row.mostrar_total, d.mostrar_total),
    permitir_pago_transferencia: bool(
      row.permitir_pago_transferencia,
      d.permitir_pago_transferencia,
    ),
    pagina_html_encabezado: text(row.pagina_html_encabezado),
    pagina_html_pie: text(row.pagina_html_pie),
    mail_acuse_asunto: text(row.mail_acuse_asunto),
    mail_acuse_html: text(row.mail_acuse_html),
    mail_acuse_pago_asunto: text(row.mail_acuse_pago_asunto),
    mail_acuse_pago_html: text(row.mail_acuse_pago_html),
    certificado_html: text(row.certificado_html),
  }
}

/** Config de un evento. Devuelve defaults si no hay fila (o si falta la tabla). */
export async function loadEventoWebConfig(
  admin: SupabaseClient,
  eventoId: string,
): Promise<EventoWebConfig> {
  const { data, error } = await admin
    .from(EVENTO_CONFIG_TABLE)
    .select(SELECT)
    .eq('evento_id', eventoId)
    .maybeSingle()

  if (error) {
    if (esTablaInexistente(error)) return { ...DEFAULT_EVENTO_WEB_CONFIG }
    throw new Error(`Error leyendo config del evento: ${error.message}`)
  }
  return rowToConfig((data as Record<string, unknown> | null) ?? null)
}
