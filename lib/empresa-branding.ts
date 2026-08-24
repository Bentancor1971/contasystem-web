/**
 * Identidad y marca de la empresa para los mails que arma la WEB
 * (tabla empresa_branding_remoto).
 *
 * La escribe el desktop en el push de eventos, leyéndola de `empresas` +
 * `configuracion_email` — la misma fuente que usan todos los mails del sistema,
 * así que el acuse de la web queda igual al recibo del desktop.
 * Ver docs/supabase/59_empresa_branding.sql en contasystem-desktop.
 *
 * Sin fila (o sin tabla) devuelve null y el llamador cae al comportamiento
 * anterior: el nombre del remitente como nombre de empresa y la paleta por
 * defecto. Eso es lo que hace que esto no rompa nada antes de correr el SQL ni
 * antes de que se redistribuya el desktop.
 *
 * Server-only: recibe el admin client (service_role) por parámetro.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { esTablaInexistente } from '@/lib/birthday-template-store'
import type { BrandingConfig, DatoEmpresa } from '@/lib/recibo-evento-email'

export const BRANDING_TABLE = 'empresa_branding_remoto'

const COLUMNS =
  'nombre, razon_social, rut, direccion, telefono, email, pagina_web, ' +
  'logo_url, color_primary, color_accent, color_secondary, footer_text, mostrar_documento'

export interface EmpresaBranding {
  empresa: DatoEmpresa
  branding: Partial<BrandingConfig>
}

/** Texto no vacío, o null. */
function txt(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Color `#rrggbb` válido, o undefined para que mande el default del template. */
function color(v: unknown): string | undefined {
  const s = txt(v)
  return s && /^#[0-9a-f]{3,8}$/i.test(s) ? s : undefined
}

/**
 * Marca de una empresa. null = no hay fila (el llamador decide el fallback).
 * Nunca lanza: un problema de branding no puede impedir que salga el acuse.
 */
export async function loadEmpresaBranding(
  admin: SupabaseClient,
  empresaId: string,
): Promise<EmpresaBranding | null> {
  try {
    const { data, error } = await admin
      .from(BRANDING_TABLE)
      .select(COLUMNS)
      .eq('empresa_id', empresaId)
      .maybeSingle()

    if (error) {
      if (!esTablaInexistente(error)) {
        console.error('[empresa-branding] error leyendo la marca:', error.message)
      }
      return null
    }
    const row = data as Record<string, unknown> | null
    const nombre = txt(row?.nombre)
    if (!nombre) return null

    // Sólo se pisan los campos que realmente vinieron: el resto los completa
    // DEFAULT_BRANDING dentro del template. Se arma con asignaciones y no con
    // un objeto literal porque un `color_primary: undefined` en el spread pisa
    // el default con undefined en vez de dejarlo pasar.
    const branding: Partial<BrandingConfig> = {}
    // El logo se referencia por URL desde el mail: el desktop sólo sube http(s)
    // por eso mismo, pero se vuelve a chequear acá.
    const logo = txt(row?.logo_url)
    if (logo && /^https?:\/\//i.test(logo)) branding.logo_url = logo
    const cp = color(row?.color_primary)
    if (cp) branding.color_primary = cp
    const ca = color(row?.color_accent)
    if (ca) branding.color_accent = ca
    const cs = color(row?.color_secondary)
    if (cs) branding.color_secondary = cs
    const pie = txt(row?.footer_text)
    if (pie) branding.footer_text = pie
    if (typeof row?.mostrar_documento === 'boolean') {
      branding.mostrar_documento = row.mostrar_documento
    }

    return {
      empresa: {
        nombre,
        razon_social: txt(row?.razon_social),
        rut: txt(row?.rut),
        direccion: txt(row?.direccion),
        telefono: txt(row?.telefono),
        email: txt(row?.email),
        pagina_web: txt(row?.pagina_web),
      },
      branding,
    }
  } catch (err) {
    console.error('[empresa-branding] excepción leyendo la marca:', err)
    return null
  }
}
