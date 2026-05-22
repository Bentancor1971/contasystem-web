/**
 * Acceso server-side a las plantillas de mail de cumpleaños y al registro
 * de empresas, en Supabase.
 *
 * Lo usan el cron (app/api/cron/birthdays) y los endpoints admin de la
 * página editora. Recibe el SupabaseClient ya creado por el caller (en la
 * práctica, el cliente service_role).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_BIRTHDAY_TEMPLATE,
  type BirthdayTemplate,
} from '@/lib/birthday-email-template'

/** Bucket de Storage con las imágenes de fondo. */
export const BIRTHDAY_BUCKET = 'birthday-assets'

/** Tabla de plantillas. */
export const TEMPLATE_TABLE = 'birthday_email_templates'

/**
 * Tabla "registro de empresas": mapea empresa_id → nombre. La feature de
 * cumpleaños toma de acá la lista de empresas, así una empresa nueva
 * aparece sola sin tocar código.
 */
export const EMPRESAS_TABLE = 'empresas_api_keys'

/** Tabla de ajustes generales (fila única). */
export const SETTINGS_TABLE = 'birthday_settings'

/** Hora de envío por defecto (Montevideo) si no hay ajuste guardado. */
export const DEFAULT_HORA_ENVIO = 9

// Columnas de la tabla de plantillas (snake_case, como en Postgres).
// Debe ser UN string literal (sin concatenar) para que el cliente de
// Supabase pueda inferir el tipo de las filas.
export const TEMPLATE_COLUMNS =
  'empresa_id, asunto, denominacion, cuerpo, imagen_fondo_path, texto_color, panel_color, panel_opacidad, activo, gmail_user, gmail_app_password, from_name'

export interface TemplateRow {
  empresa_id: string
  asunto: string
  denominacion: string
  cuerpo: string
  imagen_fondo_path: string | null
  texto_color: string
  panel_color: string
  panel_opacidad: number
  activo: boolean
  gmail_user: string | null
  gmail_app_password: string | null
  from_name: string | null
}

/** Credenciales SMTP de la casilla Gmail remitente de una empresa. */
export interface GmailAccount {
  user: string
  appPassword: string
  fromName: string
}

/** Una empresa activa: su plantilla + su casilla Gmail (null si incompleta). */
export interface ActiveEmpresa {
  plantilla: BirthdayTemplate
  cuenta: GmailAccount | null
}

/** Una empresa del registro. */
export interface EmpresaRegistro {
  empresaId: string
  nombre: string
  slug: string | null
}

/**
 * true si el error de Supabase indica que falta correr la migración:
 * la tabla no existe, o existe pero le falta alguna columna nueva.
 */
export function esTablaInexistente(err: {
  code?: string
  message: string
}): boolean {
  return (
    err.code === '42P01' || // tabla/relación no existe
    err.code === '42703' || // columna no existe (esquema desactualizado)
    err.code === 'PGRST205' || // tabla no está en el schema cache
    err.code === 'PGRST204' || // columna no está en el schema cache
    /does not exist|schema cache/i.test(err.message)
  )
}

/** URL pública de un objeto del bucket de cumpleaños. */
export function storagePublicUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
): string | null {
  if (!path) return null
  return supabase.storage.from(BIRTHDAY_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Convierte una fila de la tabla en una BirthdayTemplate lista para renderizar. */
export function rowToTemplate(
  row: TemplateRow,
  supabase: SupabaseClient,
): BirthdayTemplate {
  const d = DEFAULT_BIRTHDAY_TEMPLATE
  return {
    asunto: row.asunto || d.asunto,
    denominacion: row.denominacion || d.denominacion,
    cuerpo: row.cuerpo || d.cuerpo,
    imagenUrl: storagePublicUrl(supabase, row.imagen_fondo_path),
    textoColor: row.texto_color || d.textoColor,
    panelColor: row.panel_color || d.panelColor,
    panelOpacidad:
      typeof row.panel_opacidad === 'number' ? row.panel_opacidad : d.panelOpacidad,
  }
}

/**
 * Lista de empresas del registro (empresas_api_keys), ordenadas por nombre
 * y deduplicadas por empresa_id (una empresa puede tener varias API keys).
 * Si la tabla no existe o falla, devuelve [].
 */
export async function loadEmpresasRegistro(
  supabase: SupabaseClient,
): Promise<EmpresaRegistro[]> {
  const { data, error } = await supabase
    .from(EMPRESAS_TABLE)
    .select('empresa_id, nombre, empresa_slug')
    .eq('activo', true)
    .order('nombre')

  if (error || !data) return []

  const porId = new Map<string, EmpresaRegistro>()
  for (const r of data as {
    empresa_id: string
    nombre: string | null
    empresa_slug: string | null
  }[]) {
    if (!r.empresa_id || porId.has(r.empresa_id)) continue
    porId.set(r.empresa_id, {
      empresaId: r.empresa_id,
      nombre: r.nombre?.trim() || r.empresa_id,
      slug: r.empresa_slug ?? null,
    })
  }
  return [...porId.values()]
}

/**
 * Extrae la casilla Gmail de una fila. Devuelve null si falta algún dato
 * (la empresa no puede enviar hasta completar usuario + App Password +
 * nombre del remitente).
 */
export function rowToGmailAccount(row: TemplateRow): GmailAccount | null {
  const user = row.gmail_user?.trim()
  const appPassword = row.gmail_app_password?.trim()
  const fromName = row.from_name?.trim()
  if (!user || !appPassword || !fromName) return null
  return { user, appPassword, fromName }
}

/**
 * Hora de envío configurada (0-23, hora de Montevideo). Si la tabla no
 * existe o el valor es inválido, devuelve DEFAULT_HORA_ENVIO.
 */
export async function loadHoraEnvio(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select('hora_envio')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) return DEFAULT_HORA_ENVIO
  const h = (data as { hora_envio: number }).hora_envio
  return typeof h === 'number' && h >= 0 && h <= 23 ? h : DEFAULT_HORA_ENVIO
}

/**
 * Empresas con `activo = true`, en un Map empresa_id → { plantilla, cuenta }.
 * Esas son las empresas a las que el cron les manda saludos. `cuenta` es
 * null si la casilla Gmail está incompleta. Si la tabla no existe,
 * devuelve un Map vacío.
 */
export async function loadActiveEmpresas(
  supabase: SupabaseClient,
): Promise<Map<string, ActiveEmpresa>> {
  const map = new Map<string, ActiveEmpresa>()

  const { data, error } = await supabase
    .from(TEMPLATE_TABLE)
    .select(TEMPLATE_COLUMNS)
    .eq('activo', true)

  if (error || !data) return map

  for (const row of data as TemplateRow[]) {
    map.set(row.empresa_id, {
      plantilla: rowToTemplate(row, supabase),
      cuenta: rowToGmailAccount(row),
    })
  }
  return map
}
