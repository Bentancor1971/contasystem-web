/**
 * Helper server-only para la validación pública de certificados.
 * Recibe el admin client (service_role) por parámetro; no importar desde
 * Client Components (usar el tipo de lib/eventos-types.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CertificadoPublico } from '@/lib/eventos-types'

/** Lee un certificado por token. Devuelve null si no existe. */
export async function loadCertificado(
  admin: SupabaseClient,
  token: string,
): Promise<CertificadoPublico | null> {
  const { data, error } = await admin
    .from('certificados_remoto')
    .select('token, estado, evento_id, evento_nombre, evento_fecha, evento_lugar, nombre_completo, categoria_nombre, numero, emitido_at')
    .eq('token', token)
    .maybeSingle()

  if (error) throw new Error(`Error consultando certificado: ${error.message}`)
  return (data as CertificadoPublico | null) ?? null
}
