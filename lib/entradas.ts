/**
 * Helpers server-only de la asistencia por QR.
 *
 * Los RPCs son SECURITY DEFINER (la tabla `entradas_remoto` no está expuesta a
 * `anon`), así que se llaman con service_role desde el server — mismo patrón
 * que el flujo público de inscripción en /api/eventos/[slug]/*.
 *
 * ⚠️ No importar desde Client Components: usar los tipos de lib/entradas-types.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BuscarEntradaResult,
  ConteoCheckin,
  EntradaRemota,
  MarcarEntradaResult,
  ResultadoDesmarca,
} from '@/lib/entradas-types'

/** Lo que devuelve `desmarcar_asistencia_entrada` (sin el caso propio de la web). */
interface DesmarcarEntradaResult {
  resultado: Exclude<ResultadoDesmarca, 'otro_evento'>
  entrada?: EntradaRemota
}

/** Consulta sin efectos: devuelve el estado de la entrada, no la marca. */
export async function buscarEntrada(
  admin: SupabaseClient,
  token: string,
): Promise<BuscarEntradaResult> {
  const { data, error } = await admin.rpc('buscar_entrada', { p_token: token })
  if (error) throw new Error(`Error consultando la entrada: ${error.message}`)
  return (data ?? { resultado: 'no_encontrada' }) as BuscarEntradaResult
}

/**
 * Marca la asistencia. Idempotente: reescanear devuelve 'ya_presente' con la
 * hora del PRIMER ingreso, sin pisarla.
 *
 * `por` queda en `asistio_por` como traza de quién escaneó: siempre el email de
 * la sesión del operador, nunca un valor que venga del navegador.
 */
export async function marcarAsistencia(
  admin: SupabaseClient,
  token: string,
  por: string | null,
): Promise<MarcarEntradaResult> {
  const { data, error } = await admin.rpc('marcar_asistencia_entrada', {
    p_token: token,
    p_por: por || null,
  })
  if (error) throw new Error(`Error marcando la asistencia: ${error.message}`)
  return (data ?? { resultado: 'no_encontrada' }) as MarcarEntradaResult
}

/**
 * Error que se levanta cuando el RPC de desmarcado todavía no existe en la base.
 *
 * Vale la pena distinguirlo de un error genérico: el mensaje que ve el operador
 * pasa de "algo falló" a "falta correr esta migración", que es accionable.
 */
export class MigracionFaltante extends Error {
  constructor(archivo: string) {
    super(
      `Falta correr ${archivo} en Supabase: sin esa migración no se puede desmarcar la asistencia.`,
    )
    this.name = 'MigracionFaltante'
  }
}

/** PostgREST cuando no encuentra la función pedida. */
const PGRST_FUNCION_INEXISTENTE = 'PGRST202'

/**
 * Da de baja una asistencia marcada por error. Deja traza en
 * `desmarcada_at` / `desmarcada_por` — ver supabase/desmarcar_asistencia.sql.
 *
 * `no_estaba` no es un error: es el doble toque sobre alguien que ya figuraba
 * ausente.
 */
export async function desmarcarAsistencia(
  admin: SupabaseClient,
  token: string,
  por: string | null,
): Promise<DesmarcarEntradaResult> {
  const { data, error } = await admin.rpc('desmarcar_asistencia_entrada', {
    p_token: token,
    p_por: por || null,
  })
  if (error) {
    if (error.code === PGRST_FUNCION_INEXISTENTE) {
      throw new MigracionFaltante('supabase/desmarcar_asistencia.sql')
    }
    throw new Error(`Error desmarcando la asistencia: ${error.message}`)
  }
  return (data ?? { resultado: 'no_encontrada' }) as DesmarcarEntradaResult
}

/**
 * Lee la entrada cruda para chequear a qué empresa/evento pertenece ANTES de
 * marcarla. service_role saltea RLS, por eso el scope lo pone la web.
 */
export async function leerEntradaCruda(
  admin: SupabaseClient,
  token: string,
): Promise<Pick<EntradaRemota, 'empresa_id' | 'evento_id' | 'evento_nombre'> | null> {
  const { data, error } = await admin
    .from('entradas_remoto')
    .select('empresa_id, evento_id, evento_nombre')
    .eq('token', token)
    .maybeSingle()

  if (error) throw new Error(`Error consultando la entrada: ${error.message}`)
  return data ?? null
}

/** Nombre y apellido separados de una ficha de socio. */
export interface NombrePartido {
  nombre: string
  apellido: string
}

/**
 * Resuelve nombre y apellido POR SEPARADO para una tanda de documentos.
 *
 * `entradas_remoto` guarda un único `nombre_completo` que el desktop arma como
 * "nombre + apellido". Para ordenar por apellido hay que deshacer esa unión, y
 * no se puede hacer por heurística: "MARÍA DEL CARMEN PÉREZ" y "ANA GONZÁLEZ
 * ROSSI" tienen la misma forma y el corte va en lugares distintos. La ficha del
 * socio sí los tiene separados, y la entrada trae el documento, que es la clave.
 *
 * Devuelve un Map documento → {nombre, apellido}. Los documentos sin ficha
 * simplemente no aparecen: el caller cae al `nombre_completo` del snapshot.
 *
 * No se filtra por empresa a propósito: el documento es la cédula, así que una
 * coincidencia en otra empresa del registro es la misma persona. Igual se
 * prefiere la ficha de la empresa del evento si hay más de una.
 */
export async function resolverNombres(
  admin: SupabaseClient,
  documentos: string[],
  empresaPreferida: string,
): Promise<Map<string, NombrePartido>> {
  const docs = [...new Set(documentos.filter((d): d is string => Boolean(d?.trim())))]
  const out = new Map<string, NombrePartido>()
  if (docs.length === 0) return out

  const { data, error } = await admin
    .from('socios_datos')
    .select('documento, nombre, apellido, empresa_id')
    .in('documento', docs)
    .is('deleted_at', null)

  if (error) {
    // Degradar es correcto acá: sin ficha la lista igual funciona, sólo que
    // muestra el nombre completo sin partir. Romper la puerta por esto sería peor.
    console.warn(`[entradas] no se pudieron resolver los apellidos · ${error.message}`)
    return out
  }

  for (const r of (data ?? []) as {
    documento: string | null
    nombre: string | null
    apellido: string | null
    empresa_id: string | null
  }[]) {
    const doc = r.documento?.trim()
    if (!doc || !r.apellido?.trim()) continue
    // Sólo se pisa una ficha ya elegida cuando la nueva es de la empresa del
    // evento; si no, gana la primera que llegó.
    if (out.has(doc) && r.empresa_id !== empresaPreferida) continue
    out.set(doc, { nombre: (r.nombre ?? '').trim(), apellido: r.apellido.trim() })
  }

  return out
}

/**
 * Contador de la puerta: presentes / total del evento.
 *
 * Las anuladas no entran en el total — no son gente que pueda llegar, y
 * dejarlas ahí haría que el contador nunca cierre.
 */
export async function contarEvento(
  admin: SupabaseClient,
  empresaId: string,
  eventoId: string,
): Promise<ConteoCheckin> {
  const base = () =>
    admin
      .from('entradas_remoto')
      .select('token', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('evento_id', eventoId)
      .eq('estado', 'valida')

  const [totalRes, presentesRes] = await Promise.all([
    base(),
    base().not('asistio_at', 'is', null),
  ])

  if (totalRes.error) {
    throw new Error(`Error contando entradas: ${totalRes.error.message}`)
  }
  if (presentesRes.error) {
    throw new Error(`Error contando presentes: ${presentesRes.error.message}`)
  }

  return {
    total: totalRes.count ?? 0,
    presentes: presentesRes.count ?? 0,
  }
}
