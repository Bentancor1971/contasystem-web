/**
 * Confirmación del cupo de un sorteo (/s/[token]). SOLO server-side
 * (service_role): las dos RPC son SECURITY DEFINER con EXECUTE revocado a
 * PUBLIC/anon/authenticated. Ver docs/supabase/72_sorteos_confirmacion.sql del
 * repo desktop.
 *
 * ⚠️ No importar desde un Client Component: arrastra el cliente admin. Los
 * tipos que comparte con el cliente viven en lib/sorteo-confirmacion-types.ts.
 *
 * Toda la regla —una sola respuesta, dentro del plazo, con el cupo abierto—
 * vive en la base. Esto tipa y normaliza.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ConfirmacionSorteo,
  ErrorConfirmacion,
  EstadoConfirmacion,
  RespuestaCupo,
} from '@/lib/sorteo-confirmacion-types'

async function llamar(
  admin: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  if (!data || typeof data !== 'object') throw new Error(`${fn}: respuesta vacía`)
  return data as Record<string, unknown>
}

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function respuestaDe(v: unknown): RespuestaCupo | null {
  return v === 'confirmo' || v === 'rechazo' ? v : null
}

function estadoDe(v: unknown): EstadoConfirmacion {
  return v === 'confirmo' || v === 'rechazo' || v === 'reasignado' || v === 'anulado' ? v : 'abierto'
}

export async function buscarConfirmacionSorteo(
  admin: SupabaseClient,
  token: string,
): Promise<ConfirmacionSorteo | ErrorConfirmacion> {
  const d = await llamar(admin, 'buscar_confirmacion_sorteo', { p_token: token })
  if (d.ok !== true) return { error: texto(d.error) || 'credencial_inexistente' }
  return {
    ok: true,
    empresa_nombre: texto(d.empresa_nombre),
    evento_nombre: texto(d.evento_nombre),
    premio: texto(d.premio),
    numero_texto: texto(d.numero_texto),
    nombre_publico: texto(d.nombre_publico),
    vence_fecha: texto(d.vence_fecha).slice(0, 10),
    estado: estadoDe(d.estado),
    respuesta: respuestaDe(d.respuesta),
    respuesta_at: typeof d.respuesta_at === 'string' ? d.respuesta_at : null,
    vencido: d.vencido === true,
  }
}

export async function responderConfirmacionSorteo(
  admin: SupabaseClient,
  token: string,
  acepta: boolean,
): Promise<{ ok: true; respuesta: RespuestaCupo; respuesta_at: string } | ErrorConfirmacion> {
  const d = await llamar(admin, 'responder_confirmacion_sorteo', { p_token: token, p_acepta: acepta })
  if (d.ok !== true) {
    return {
      error: texto(d.error) || 'error',
      respuesta: respuestaDe(d.respuesta),
      estado: d.estado ? estadoDe(d.estado) : undefined,
    }
  }
  return { ok: true, respuesta: respuestaDe(d.respuesta) ?? (acepta ? 'confirmo' : 'rechazo'), respuesta_at: texto(d.respuesta_at) }
}
