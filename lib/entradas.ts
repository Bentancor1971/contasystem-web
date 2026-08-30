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
  EventoCheckin,
  MarcarEntradaResult,
  MarcarResponse,
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

/**
 * P5: intenta marcar la asistencia con UN viaje, vía la RPC
 * `marcar_asistencia_scoped` (docs/supabase/63_app_web_fixes.sql). Reemplaza
 * la secuencia leerEntradaCruda → marcarAsistencia → contarEvento (3 viajes)
 * del route.
 *
 * Devuelve `undefined` si el RPC no existe todavía (PGRST202/42883): el
 * caller tiene que degradar solo al camino de siempre. Cualquier otro error
 * se propaga — no es un "no está la migración", es una falla real.
 */
export async function marcarAsistenciaScoped(
  admin: SupabaseClient,
  token: string,
  empresaId: string,
  eventoId: string,
  por: string | null,
): Promise<MarcarResponse | undefined> {
  const { data, error } = await admin.rpc('marcar_asistencia_scoped', {
    p_token: token,
    p_empresa_id: empresaId,
    p_evento_id: eventoId,
    p_por: por || null,
  })
  if (error) {
    if (error.code === PGRST_FUNCION_INEXISTENTE || error.code === '42883') {
      console.warn(
        '[entradas] RPC marcar_asistencia_scoped no existe todavía · aplicar 63_app_web_fixes.sql',
      )
      return undefined
    }
    throw new Error(`Error marcando la asistencia: ${error.message}`)
  }
  return (data ?? { resultado: 'no_encontrada', entrada: null, conteo: null }) as MarcarResponse
}

/**
 * Entrada ya emitida por el desktop para una inscripción concreta.
 *
 * `numero` es el número de RECIBO del desktop ('RC-042'), no el de la
 * inscripción ('INS-0011'): son numeraciones distintas. Puede venir null —una
 * entrada emitida sin recibo detrás, como en los registros sin costo—, así que
 * quien lo muestre tiene que tolerar su ausencia.
 */
export interface EntradaEmitida {
  token: string
  numero: string | null
  emitida_at: string | null
}

/**
 * Busca la entrada emitida para (evento, documento), o null si no hay.
 *
 * null NO distingue "el evento no usa QR" de "todavía no la emitieron": el
 * desktop define si el evento emite entradas y la web sólo ve el resultado. Los
 * dos casos se tratan igual —el comprobante sale sin entrada—, así que la
 * ambigüedad no molesta.
 *
 * `documento` va normalizado (sin puntos ni guiones): el desktop pushea la
 * cédula con el mismo criterio que la web guarda en la inscripción.
 *
 * No lanza: si la consulta falla se degrada a null. Este dato ADORNA el
 * comprobante; hacer fallar el envío del mail por él sería peor que mandarlo sin
 * el QR.
 */
export async function buscarEntradaEmitida(
  admin: SupabaseClient,
  eventoId: string,
  documentoNormalizado: string,
): Promise<EntradaEmitida | null> {
  const doc = documentoNormalizado.trim()
  if (!doc) return null

  const { data, error } = await admin
    .from('entradas_remoto')
    .select('token, numero, emitida_at')
    .eq('evento_id', eventoId)
    .eq('documento', doc)
    // Una entrada anulada es un pase que ya no vale: mandarla sería peor que no
    // mandar nada.
    .eq('estado', 'valida')
    // Si el desktop reemitió, vale la última.
    .order('emitida_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn(`[entradas] no se pudo resolver la entrada emitida · ${error.message}`)
    return null
  }
  return data ? (data as EntradaEmitida) : null
}

/** Nombre y apellido separados de una ficha de socio. */
export interface NombrePartido {
  nombre: string
  apellido: string
}

/** Tamaño de tanda para el `.in()` de socios_datos: URLs de PostgREST no aguantan miles de valores en un filtro. */
const RESOLVER_NOMBRES_CHUNK = 200

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
 * P5: filtrado por tenant (la empresa del evento, o su grupo si tiene uno) —
 * antes se buscaba SIN ningún filtro de empresa/grupo sobre `socios_datos`
 * (comentario decía "es la misma persona en otra empresa", pero eso abría un
 * seq scan cross-tenant en cada carga del control manual). Ahora el scope es
 * [empresaPreferida] ∪ (las empresas del mismo grupo, si `grupoId` viene). Los
 * `.in()` se parten de a 200 documentos: con un evento grande la URL de
 * PostgREST podía superar los límites razonables de un GET.
 */
export async function resolverNombres(
  admin: SupabaseClient,
  documentos: string[],
  empresaPreferida: string,
  grupoId?: string | null,
): Promise<Map<string, NombrePartido>> {
  const docs = [...new Set(documentos.filter((d): d is string => Boolean(d?.trim())))]
  const out = new Map<string, NombrePartido>()
  if (docs.length === 0) return out

  // Scope de tenant: la empresa del evento, y si pertenece a un grupo, las
  // demás empresas del grupo (mismo padrón compartido).
  let empresaIds: string[] = [empresaPreferida]
  if (grupoId) {
    const { data: hermanas } = await admin
      .from('empresas_online_remoto')
      .select('empresa_id')
      .eq('grupo_id', grupoId)
    for (const r of (hermanas ?? []) as { empresa_id: string | null }[]) {
      if (r.empresa_id && !empresaIds.includes(r.empresa_id)) empresaIds.push(r.empresa_id)
    }
  }

  const chunks: string[][] = []
  for (let i = 0; i < docs.length; i += RESOLVER_NOMBRES_CHUNK) {
    chunks.push(docs.slice(i, i + RESOLVER_NOMBRES_CHUNK))
  }

  const resultados = await Promise.all(
    chunks.map((chunk) =>
      admin
        .from('socios_datos')
        .select('documento, nombre, apellido, empresa_id')
        .in('documento', chunk)
        .in('empresa_id', empresaIds)
        .is('deleted_at', null),
    ),
  )

  for (const { data, error } of resultados) {
    if (error) {
      // Degradar es correcto acá: sin ficha la lista igual funciona, sólo que
      // muestra el nombre completo sin partir. Romper la puerta por esto sería peor.
      console.warn(`[entradas] no se pudieron resolver los apellidos · ${error.message}`)
      continue
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
  }

  return out
}

/**
 * P5: eventos con QR emitidos + conteo + roles, con GROUP BY en Postgres vía
 * la RPC `checkin_eventos` (63_app_web_fixes.sql), en vez de traer hasta
 * 20.000 filas de `entradas_remoto` y agruparlas en memoria en el route.
 *
 * Devuelve `undefined` si el RPC no existe todavía: el caller degrada al
 * armado en memoria de siempre.
 */
export async function checkinEventosScoped(
  admin: SupabaseClient,
  empresaId: string,
  desdeISO: string,
): Promise<EventoCheckin[] | undefined> {
  const { data, error } = await admin.rpc('checkin_eventos', {
    p_empresa_id: empresaId,
    p_desde: desdeISO,
  })
  if (error) {
    if (error.code === PGRST_FUNCION_INEXISTENTE || error.code === '42883') {
      console.warn(
        '[entradas] RPC checkin_eventos no existe todavía · aplicar 63_app_web_fixes.sql',
      )
      return undefined
    }
    throw new Error(`Error consultando entradas: ${error.message}`)
  }
  return (data ?? []) as EventoCheckin[]
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
