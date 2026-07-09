/**
 * Helpers server-only del módulo de eventos (modelo PUENTE con el desktop).
 *
 * Lee las tablas *_remoto que el desktop pushea (eventos_remoto,
 * evento_categorias_remoto, categorias_socio_remoto, socios_cuotas_remoto) y
 * escribe/lee inscripciones_evento_remoto. Reciben el admin client por parámetro.
 * NO importar desde Client Components (usar lib/eventos-types.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CategoriaEvento,
  EventoPublico,
  EventoRemoto,
  ResolucionParticipante,
  TipoParticipante,
} from '@/lib/eventos-types'
import { normalizeDocumento } from '@/lib/documento'

/** Estados de inscripción que ocupan cupo. */
const ESTADOS_OCUPAN = ['pendiente', 'importado']

/** Trae el evento por slug (no anulado), o null. */
export async function loadEventoRemotoBySlug(
  admin: SupabaseClient,
  slug: string,
): Promise<EventoRemoto | null> {
  const { data, error } = await admin
    .from('eventos_remoto')
    .select('*')
    .eq('slug', slug)
    .neq('estado', 'anulado')
    .maybeSingle()

  if (error) throw new Error(`Error consultando evento: ${error.message}`)
  return (data as EventoRemoto | null) ?? null
}

/** Categorías del evento agrupadas (una fila por categoría, con precio socio y no_socio). */
export async function loadCategoriasEvento(
  admin: SupabaseClient,
  eventoId: string,
): Promise<CategoriaEvento[]> {
  const { data, error } = await admin
    .from('evento_categorias_remoto')
    .select('categoria_id, categoria_nombre, tipo_participante, importe')
    .eq('evento_id', eventoId)

  if (error) throw new Error(`Error consultando categorías: ${error.message}`)

  const porCat = new Map<string, CategoriaEvento>()
  for (const r of (data ?? []) as {
    categoria_id: string
    categoria_nombre: string
    tipo_participante: TipoParticipante
    importe: number | string
  }[]) {
    let c = porCat.get(r.categoria_id)
    if (!c) {
      c = { categoria_id: r.categoria_id, nombre: r.categoria_nombre, precio_socio: null, precio_no_socio: null }
      porCat.set(r.categoria_id, c)
    }
    if (r.tipo_participante === 'socio') c.precio_socio = Number(r.importe)
    else c.precio_no_socio = Number(r.importe)
  }
  return [...porCat.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Cuántas inscripciones ocupan cupo en el evento. */
export async function contarInscriptos(
  admin: SupabaseClient,
  eventoId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('inscripciones_evento_remoto')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .in('estado', ESTADOS_OCUPAN)
  if (error) throw new Error(`Error contando inscriptos: ${error.message}`)
  return count ?? 0
}

/** Arma el payload público. Devuelve null si el slug no existe. */
export async function loadEventoPublico(
  admin: SupabaseClient,
  slug: string,
): Promise<EventoPublico | null> {
  const ev = await loadEventoRemotoBySlug(admin, slug)
  if (!ev) return null

  const [categorias, inscriptos] = await Promise.all([
    loadCategoriasEvento(admin, ev.id),
    ev.cupo_maximo != null ? contarInscriptos(admin, ev.id) : Promise.resolve(0),
  ])

  const cupoCompleto = ev.cupo_maximo != null && inscriptos >= ev.cupo_maximo
  let motivo: string | null = null
  if (ev.estado !== 'abierto') motivo = 'Las inscripciones están cerradas'
  else if (cupoCompleto) motivo = 'Se completó el cupo del evento'

  return {
    slug: ev.slug,
    nombre: ev.nombre,
    descripcion: ev.descripcion,
    lugar: ev.lugar,
    fecha: ev.fecha_inicio,
    moneda_codigo: ev.moneda_codigo,
    tipo: ev.tipo,
    umbral_cuotas_no_socio: ev.umbral_cuotas_no_socio,
    abierto: motivo == null,
    motivo_cerrado: motivo,
    texto_antes: ev.texto_antes,
    texto_despues: ev.texto_despues,
    categorias,
  }
}

/**
 * Resuelve la cédula contra el registro del evento y decide el tipo de
 * participante aplicando la regla de cuotas:
 *   - socio con cuotas_pendientes < umbral → 'socio'
 *   - socio con cuotas_pendientes >= umbral → 'no_socio'
 *   - no encontrado → 'no_socio'
 *
 * `documento` en socios_datos está en texto plano (dígitos); se matchea directo.
 * Las cuotas salen de socios_cuotas_remoto, keyed por el documento_hash del socio.
 */
export async function resolverParticipante(
  admin: SupabaseClient,
  evento: EventoRemoto,
  documento: string,
): Promise<ResolucionParticipante> {
  const doc = normalizeDocumento(documento)
  const vacio: ResolucionParticipante = {
    encontrado: false,
    socio_id: null,
    nombre: '',
    apellido: '',
    mail: '',
    cuotas_pendientes: null,
    tipo_participante: 'no_socio',
  }
  if (doc.length < 6) return vacio

  const { data: socio, error } = await admin
    .from('socios_datos')
    .select('id, nombre, apellido, mail, documento_hash')
    .eq('empresa_id', evento.empresa_id)
    .eq('documento', doc)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Error buscando socio: ${error.message}`)
  if (!socio) return vacio

  // Cuotas pendientes (0 si no hay fila). Key: empresa + documento_hash del socio.
  const { data: cuotasRow } = await admin
    .from('socios_cuotas_remoto')
    .select('cuotas_pendientes')
    .eq('empresa_id', evento.empresa_id)
    .eq('documento_hash', (socio.documento_hash as string) ?? '')
    .maybeSingle()

  const cuotas = Number(cuotasRow?.cuotas_pendientes ?? 0)
  const tipo: TipoParticipante =
    cuotas >= evento.umbral_cuotas_no_socio ? 'no_socio' : 'socio'

  return {
    encontrado: true,
    socio_id: socio.id as string,
    nombre: (socio.nombre as string | null) ?? '',
    apellido: (socio.apellido as string | null) ?? '',
    mail: (socio.mail as string | null) ?? '',
    cuotas_pendientes: cuotas,
    tipo_participante: tipo,
  }
}

/** Precio de una categoría para un tipo de participante (o null si no está definido). */
export async function precioCategoria(
  admin: SupabaseClient,
  eventoId: string,
  categoriaId: string,
  tipo: TipoParticipante,
): Promise<{ importe: number; categoria_nombre: string } | null> {
  const { data, error } = await admin
    .from('evento_categorias_remoto')
    .select('importe, categoria_nombre')
    .eq('evento_id', eventoId)
    .eq('categoria_id', categoriaId)
    .eq('tipo_participante', tipo)
    .maybeSingle()
  if (error) throw new Error(`Error consultando precio: ${error.message}`)
  if (!data) return null
  return { importe: Number(data.importe), categoria_nombre: data.categoria_nombre as string }
}
