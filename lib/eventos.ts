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
  CategoriaSocioPublica,
  EventoPublico,
  EventoRemoto,
  InscripcionPrevia,
  ResolucionParticipante,
  ResolucionPublica,
  TipoParticipante,
} from '@/lib/eventos-types'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'
import { esCedulaUruguayaValida } from '@/lib/cedula'
import { loadEventoWebConfig } from '@/lib/evento-web-config'

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

/** Catálogo de categorías de socio activas de la empresa (sin precio). */
export async function loadCategoriasSocio(
  admin: SupabaseClient,
  empresaId: string,
): Promise<CategoriaSocioPublica[]> {
  const { data, error } = await admin
    .from('categorias_socio_remoto')
    .select('id, nombre')
    .eq('empresa_id', empresaId)
    .eq('activa', 1)
    .order('nombre')
  if (error) throw new Error(`Error consultando categorías de socio: ${error.message}`)
  return ((data ?? []) as { id: string; nombre: string }[]).map((r) => ({
    id: r.id,
    nombre: r.nombre,
  }))
}

/** Nombre de una categoría de socio del catálogo (o null si no existe en la empresa). */
export async function nombreCategoriaSocio(
  admin: SupabaseClient,
  empresaId: string,
  categoriaId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('categorias_socio_remoto')
    .select('nombre')
    .eq('empresa_id', empresaId)
    .eq('id', categoriaId)
    .maybeSingle()
  if (error) throw new Error(`Error consultando categoría: ${error.message}`)
  return data ? (data.nombre as string) : null
}

/**
 * Precio más alto definido en el evento para un tipo de participante.
 * Sirve de tarifa de referencia cuando la persona elige "Otros" (categoría libre).
 * Devuelve null si el evento no tiene ninguna categoría con precio para ese tipo.
 */
export async function precioMaximoCategoria(
  admin: SupabaseClient,
  eventoId: string,
  tipo: TipoParticipante,
): Promise<number | null> {
  const { data, error } = await admin
    .from('evento_categorias_remoto')
    .select('importe')
    .eq('evento_id', eventoId)
    .eq('tipo_participante', tipo)
    .order('importe', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Error consultando precio máximo: ${error.message}`)
  return data ? Number(data.importe) : null
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

/** Cuántas inscripciones que ocupan cupo llevan transporte (para su cupo propio). */
export async function contarConTransporte(
  admin: SupabaseClient,
  eventoId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('inscripciones_evento_remoto')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .eq('lleva_transporte', true)
    .in('estado', ESTADOS_OCUPAN)
  if (error) throw new Error(`Error contando transporte: ${error.message}`)
  return count ?? 0
}

/**
 * Traduce la ocupación a una banda cualitativa para el semáforo del form.
 * Devuelve null si el evento no tiene cupo (no se muestra semáforo). NUNCA
 * expone el conteo ni el % exacto — sólo la banda (ver EventoPublico.ocupacion_nivel).
 */
function nivelOcupacion(
  inscriptos: number,
  cupoMaximo: number | null,
): 'baja' | 'media' | 'alta' | null {
  if (cupoMaximo == null || cupoMaximo <= 0) return null
  const pct = inscriptos / cupoMaximo
  if (pct < 0.7) return 'baja'
  if (pct < 0.9) return 'media'
  return 'alta'
}

/** Arma el payload público. Devuelve null si el slug no existe. */
export async function loadEventoPublico(
  admin: SupabaseClient,
  slug: string,
): Promise<EventoPublico | null> {
  const ev = await loadEventoRemotoBySlug(admin, slug)
  if (!ev) return null

  // El cupo de transporte tiene su propio conteo (sólo si hay tope definido).
  const transporteConCupo = ev.transporte_disponible && ev.transporte_cupo_maximo != null
  const [categorias, inscriptos, categoriasSocio, config, transporteInscriptos] = await Promise.all([
    loadCategoriasEvento(admin, ev.id),
    ev.cupo_maximo != null ? contarInscriptos(admin, ev.id) : Promise.resolve(0),
    // Las categorías de socio (clasificación sin precio) sólo se ofrecen como
    // grilla en eventos sin costo; en los con costo la grilla son las categorías
    // con precio (evento_categorias_remoto).
    ev.tipo === 'sin_costo'
      ? loadCategoriasSocio(admin, ev.empresa_id)
      : Promise.resolve([] as CategoriaSocioPublica[]),
    loadEventoWebConfig(admin, ev.id),
    transporteConCupo ? contarConTransporte(admin, ev.id) : Promise.resolve(0),
  ])

  const cupoCompleto = ev.cupo_maximo != null && inscriptos >= ev.cupo_maximo
  const transporteCompleto =
    transporteConCupo && transporteInscriptos >= (ev.transporte_cupo_maximo as number)
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
    ocupacion_nivel: nivelOcupacion(inscriptos, ev.cupo_maximo),
    texto_antes: ev.texto_antes,
    texto_despues: ev.texto_despues,
    datos_deposito: ev.datos_deposito,
    // Default TRUE si la columna viene null (eventos previos a la migración 29).
    permitir_pago_realizado: ev.permitir_pago_realizado !== false,
    permitir_preinscripcion: ev.permitir_preinscripcion !== false,
    categorias,
    categorias_socio: categoriasSocio,
    config,
    transporte: {
      disponible: !!ev.transporte_disponible,
      con_costo: !!ev.transporte_con_costo,
      importe_socio: Number(ev.transporte_importe_socio ?? 0),
      importe_no_socio: Number(ev.transporte_importe_no_socio ?? 0),
      descripcion: ev.transporte_descripcion,
      ocupacion_nivel: transporteConCupo
        ? nivelOcupacion(transporteInscriptos, ev.transporte_cupo_maximo)
        : null,
      completo: transporteCompleto,
    },
    alimentacion: {
      disponible: !!ev.alimentacion_disponible,
      con_costo: !!ev.alimentacion_con_costo,
      importe_socio: Number(ev.alimentacion_importe_socio ?? 0),
      importe_no_socio: Number(ev.alimentacion_importe_no_socio ?? 0),
      descripcion: ev.alimentacion_descripcion,
      opciones: parseOpcionesAlimentacion(ev.alimentacion_opciones),
    },
  }
}

/** Parsea el JSON de opciones de alimentación. Tolera null / texto inválido. */
export function parseOpcionesAlimentacion(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean)
  } catch {
    return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  }
  return []
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
    telefono: '',
    cuotas_pendientes: null,
    tipo_participante: 'no_socio',
    categoria_id: null,
    categoria_nombre: null,
  }
  if (doc.length < 6) return vacio

  const { data: socio, error } = await admin
    .from('socios_datos')
    .select('id, nombre, apellido, mail, telefono, celular, documento_hash')
    .eq('empresa_id', evento.empresa_id)
    .eq('documento', doc)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Error buscando socio: ${error.message}`)
  if (!socio) return vacio

  const docHash = (socio.documento_hash as string) ?? ''

  // Cuotas pendientes + categoría del socio (ambas keyed por empresa + documento_hash).
  const [{ data: cuotasRow }, { data: catRow }] = await Promise.all([
    admin
      .from('socios_cuotas_remoto')
      .select('cuotas_pendientes')
      .eq('empresa_id', evento.empresa_id)
      .eq('documento_hash', docHash)
      .maybeSingle(),
    admin
      .from('socios_categoria_remoto')
      .select('categoria_id, categoria_nombre')
      .eq('empresa_id', evento.empresa_id)
      .eq('documento_hash', docHash)
      .maybeSingle(),
  ])

  const cuotas = Number(cuotasRow?.cuotas_pendientes ?? 0)
  const tipo: TipoParticipante =
    cuotas >= evento.umbral_cuotas_no_socio ? 'no_socio' : 'socio'

  return {
    encontrado: true,
    socio_id: socio.id as string,
    nombre: (socio.nombre as string | null) ?? '',
    apellido: (socio.apellido as string | null) ?? '',
    mail: (socio.mail as string | null) ?? '',
    // Preferimos el celular; si no hay, el teléfono fijo.
    telefono:
      ((socio.celular as string | null) || (socio.telefono as string | null)) ?? '',
    cuotas_pendientes: cuotas,
    tipo_participante: tipo,
    categoria_id: (catRow?.categoria_id as string | null) ?? null,
    categoria_nombre: (catRow?.categoria_nombre as string | null) ?? null,
  }
}

// ────────────────────────────────────────────────────────────────
// Enmascarado para la proyección pública del lookup.
// El dato en claro NUNCA baja al cliente; sólo estas versiones parciales.
// ────────────────────────────────────────────────────────────────

/** "PRUEBA" → "PR•••". Muestra las 2 primeras letras (1 si es muy corto). */
function maskTexto(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  const visibles = s.length <= 2 ? 1 : 2
  return `${s.slice(0, visibles)}•••`
}

/** "bentancor@gmail.com" → "b•••@gmail.com". Deja visible el dominio. */
export function maskMail(v: string): string | null {
  const s = v.trim()
  const at = s.indexOf('@')
  if (at <= 0) return null // sin @ o sin local: no arriesgamos, no mostramos nada
  const local = s.slice(0, at)
  const dominio = s.slice(at) // incluye la "@"
  return `${local.slice(0, 1)}•••${dominio}`
}

/** "099123456" → "•••456". Deja visibles los últimos 3 dígitos. */
function maskTelefono(v: string): string | null {
  const digitos = v.replace(/\D/g, '')
  if (digitos.length < 4) return null // muy corto: no mostramos nada
  return `•••${digitos.slice(-3)}`
}

/**
 * Inscripción vigente de una cédula en un evento, o null si no se inscribió.
 * Mismo criterio de vigencia que el dedupe de POST /inscribir (todo salvo
 * 'anulado'): si acá devuelve algo, ese endpoint devolvería 409.
 */
export async function buscarInscripcionPrevia(
  admin: SupabaseClient,
  eventoId: string,
  documento: string,
): Promise<InscripcionPrevia | null> {
  const { data, error } = await admin
    .from('inscripciones_evento_remoto')
    .select('numero, estado, modalidad, categoria_nombre, importe, transporte_importe, alimentacion_importe, moneda_codigo, referencia_transferencia, mail')
    .eq('evento_id', eventoId)
    .eq('documento_hash', hashDocumento(documento))
    .neq('estado', 'anulado')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Error buscando inscripción previa: ${error.message}`)
  if (!data) return null
  const modalidad = (data.modalidad as InscripcionPrevia['modalidad']) ?? 'reserva'
  return {
    numero: (data.numero as string | null) ?? null,
    estado: data.estado as InscripcionPrevia['estado'],
    modalidad,
    categoria_nombre: (data.categoria_nombre as string | null) ?? null,
    total:
      Number(data.importe ?? 0) +
      Number(data.transporte_importe ?? 0) +
      Number(data.alimentacion_importe ?? 0),
    moneda_codigo: (data.moneda_codigo as string | null) ?? 'UYU',
    referencia_transferencia:
      modalidad === 'pago_transferencia'
        ? ((data.referencia_transferencia as string | null) ?? null)
        : null,
    // Enmascarado: es el destino del reenvío de copia, no un dato para mostrar.
    mail_mask: maskMail(((data.mail as string | null) ?? '').trim()),
  }
}

/**
 * Proyección pública del lookup: lo único que se serializa al navegador.
 * Recorta la resolución interna a tipo + categoría + datos ENMASCARADOS.
 * Ver `ResolucionPublica` para el detalle de por qué cada campo está o no.
 */
export function proyectarResolucionPublica(
  r: ResolucionParticipante,
  opts: { documento: string; inscripcionPrevia?: InscripcionPrevia | null },
): ResolucionPublica {
  const esSocioResuelto = r.encontrado && r.tipo_participante === 'socio'
  return {
    tipo_participante: r.tipo_participante,
    categoria_id: r.categoria_id,
    nombre_mask: esSocioResuelto ? maskTexto(r.nombre) : null,
    apellido_mask: esSocioResuelto ? maskTexto(r.apellido) : null,
    mail_mask: esSocioResuelto ? maskMail(r.mail) : null,
    telefono_mask: esSocioResuelto ? maskTelefono(r.telefono) : null,
    inscripcion_previa: opts.inscripcionPrevia ?? null,
    // El DV sólo se exige a quien no está en el padrón (ver lib/cedula). Se
    // avisa acá para que no complete todo el formulario y recién ahí se entere.
    cedula_invalida: !r.encontrado && !esCedulaUruguayaValida(opts.documento),
  }
}

/** Precio de una categoría para un tipo de participante (o null si no está definido). */
export async function precioCategoria(
  admin: SupabaseClient,
  eventoId: string,
  categoriaId: string,
  tipo: TipoParticipante,
): Promise<{ importe: number; categoria_nombre: string } | null> {
  // Tolerante a duplicados: evento_categorias_remoto no tiene índice único sobre
  // (evento_id, categoria_id, tipo_participante) y el push upserta por id local,
  // así que una categoría recreada en el desktop puede dejar dos filas. Tomamos
  // la más reciente (limit 1) en vez de romper con maybeSingle.
  const { data, error } = await admin
    .from('evento_categorias_remoto')
    .select('importe, categoria_nombre')
    .eq('evento_id', eventoId)
    .eq('categoria_id', categoriaId)
    .eq('tipo_participante', tipo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Error consultando precio: ${error.message}`)
  if (!data) return null
  return { importe: Number(data.importe), categoria_nombre: data.categoria_nombre as string }
}
