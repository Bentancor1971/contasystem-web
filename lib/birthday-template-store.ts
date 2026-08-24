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

/**
 * Registro de empresas ONLINE: las que tienen login en la web y son dueñas
 * de los eventos. Es un conjunto distinto de `empresas_api_keys` (que son
 * las que sincronizan socios desde el desktop) y en la práctica disjunto:
 * una empresa puede estar en una tabla y no en la otra.
 */
export const EMPRESAS_ONLINE_TABLE = 'empresas_online_remoto'

/** Tabla de ajustes generales (fila única). */
export const SETTINGS_TABLE = 'birthday_settings'

/** Hora de envío por defecto (Montevideo) si no hay ajuste guardado. */
export const DEFAULT_HORA_ENVIO = 9

// Columnas de la tabla de plantillas (snake_case, como en Postgres).
// Debe ser UN string literal (sin concatenar) para que el cliente de
// Supabase pueda inferir el tipo de las filas.
export const TEMPLATE_COLUMNS =
  'empresa_id, asunto, denominacion, cuerpo, imagen_fondo_path, texto_color, panel_color, panel_opacidad, activo, solo_activos, gmail_user, gmail_app_password, from_name, copia_oculta_acuse'

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
  solo_activos: boolean
  gmail_user: string | null
  gmail_app_password: string | null
  from_name: string | null
  /** Copia oculta de los acuses de inscripción. Puede faltar en bases viejas. */
  copia_oculta_acuse?: boolean | null
}

/**
 * ¿Este `estado_registro_nombre` representa un socio "activo"?
 * Comparación tolerante a tildes/case: 'Activo', 'ACTIVO', 'Activa', etc.
 * Lo usan el cron (para saber a quién saludar) y el panel /configuracion/personas.
 */
export function esEstadoActivo(estado: string | null | undefined): boolean {
  if (!estado) return false
  const norm = estado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
  return norm.startsWith('activ')
}

/** Credenciales SMTP de la casilla Gmail remitente de una empresa. */
export interface GmailAccount {
  user: string
  appPassword: string
  fromName: string
  /**
   * Mandarse copia oculta de cada acuse de inscripción a la propia casilla.
   * Default de la empresa: un evento puede pisarlo (evento_web_config).
   * No afecta al saludo de cumpleaños, que sigue copiándose siempre.
   */
  copiaOcultaAcuse: boolean
}

/** Una empresa activa: su plantilla + su casilla Gmail (null si incompleta). */
export interface ActiveEmpresa {
  plantilla: BirthdayTemplate
  cuenta: GmailAccount | null
  /** Si true, el cron solo saluda a socios con estado "activo". */
  soloActivos: boolean
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
 * Empresas que pueden tener casilla de mail configurada: la unión del
 * registro de API keys (empresas del desktop → saludos de cumpleaños) y las
 * empresas online habilitadas (las dueñas de los eventos).
 *
 * La casilla vive por empresa en `birthday_email_templates` y la usan las
 * DOS features (cumpleaños y acuse de inscripción a eventos), así que la
 * pantalla de mails tiene que ofrecer ambas listas: una empresa que solo
 * hace eventos no está en `empresas_api_keys` y, si no, no habría forma de
 * configurarle el remitente desde la app.
 *
 * Ordenadas por nombre y deduplicadas por empresa_id (gana la fila del
 * registro de API keys, que además trae el slug).
 */
export async function loadEmpresasParaMails(
  supabase: SupabaseClient,
): Promise<EmpresaRegistro[]> {
  const porId = new Map<string, EmpresaRegistro>()
  for (const e of await loadEmpresasRegistro(supabase)) {
    porId.set(e.empresaId, e)
  }

  const { data } = await supabase
    .from(EMPRESAS_ONLINE_TABLE)
    .select('empresa_id, nombre')
    .eq('habilitada', 1)

  for (const r of (data ?? []) as {
    empresa_id: string
    nombre: string | null
  }[]) {
    if (!r.empresa_id || porId.has(r.empresa_id)) continue
    porId.set(r.empresa_id, {
      empresaId: r.empresa_id,
      nombre: r.nombre?.trim() || r.empresa_id,
      slug: null,
    })
  }

  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
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
  // Sin columna (base vieja) = copiarse, que es como venía funcionando.
  const copiaOcultaAcuse = row.copia_oculta_acuse !== false
  return { user, appPassword, fromName, copiaOcultaAcuse }
}

/**
 * Casilla Gmail de UNA empresa (independiente de si tiene cumpleaños activos).
 * La reutiliza el acuse de inscripción a eventos. Devuelve null si la empresa
 * no tiene la casilla completa (usuario + App Password + nombre remitente) o
 * si la tabla no existe.
 */
export async function loadGmailAccountForEmpresa(
  supabase: SupabaseClient,
  empresaId: string,
): Promise<GmailAccount | null> {
  const { data, error } = await supabase
    .from(TEMPLATE_TABLE)
    .select('gmail_user, gmail_app_password, from_name')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (error || !data) return null
  return rowToGmailAccount(data as TemplateRow)
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
      soloActivos: row.solo_activos !== false,
    })
  }
  return map
}
