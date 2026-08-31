/**
 * Helpers server-only del módulo de eventos (modelo PUENTE con el desktop).
 *
 * Lee las tablas *_remoto que el desktop pushea (eventos_remoto,
 * evento_categorias_remoto, categorias_socio_remoto, socios_cuotas_remoto,
 * empresa_estados_socio_remoto) y
 * escribe/lee inscripciones_evento_remoto. Reciben el admin client por parámetro.
 * NO importar desde Client Components (usar lib/eventos-types.ts).
 */

import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CategoriaEvento,
  CategoriaSocioPublica,
  ConceptoExtra,
  EventoPublico,
  EventoRemoto,
  EventoWebConfig,
  ExtraPrecio,
  InscripcionPrevia,
  MonedaEvento,
  RegistroPermitido,
  ResolucionParticipante,
  ResolucionPublica,
  TipoParticipante,
} from '@/lib/eventos-types'
import {
  esEstadoSocio,
  esSoloSorteo,
  opcionesConSinRestriccion,
  puedeInscribirse,
} from '@/lib/eventos-types'
import { fechaYaPaso, simboloMoneda } from '@/lib/format'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'
import { esCedulaUruguayaValida } from '@/lib/cedula'
import { esTablaInexistente } from '@/lib/birthday-template-store'
import { loadEventoWebConfig } from '@/lib/evento-web-config'

/**
 * Estados de inscripción que ocupan cupo (evento y transporte).
 * Incluye 'pagado' (pago declarado, a verificar) y 'confirmado' (validado por
 * la organización): reservan lugar igual que la preinscripción. Sólo
 * 'rechazado' y 'anulado' liberan el cupo.
 *
 * ⚠️ Esta misma lista está hardcodeada en el RPC `inscribir_evento_web`
 * (docs/supabase/60_eventos_web_fixes.sql), porque plpgsql no puede importar
 * esta constante: un cambio acá necesita el mismo cambio allá.
 */
export const ESTADOS_OCUPAN = ['pendiente', 'pagado', 'importado', 'confirmado']

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

// ────────────────────────────────────────────────────────────────
// Multimoneda: normalización de lo que manda el desktop.
//
// Las tres columnas nuevas son JSONB y pueden venir vacías si el evento se
// pusheó con un desktop previo a la migración 38. Estas funciones son el ÚNICO
// lugar donde se decide qué pasa en ese caso, para que el resto del código
// pueda asumir que siempre hay al menos una moneda y que los extras con costo
// tienen precio. Ver docs/supabase/38_eventos_multimoneda.sql (repo desktop).
// ────────────────────────────────────────────────────────────────

/**
 * Monedas del evento, la base primero. Nunca devuelve lista vacía: sin datos
 * cae a la moneda base, que es exactamente el comportamiento mono-moneda de
 * siempre (y ahí el formulario no muestra selector).
 */
export function normalizarMonedas(ev: EventoRemoto): MonedaEvento[] {
  const base = ev.moneda_codigo || 'UYU'
  const crudas = Array.isArray(ev.monedas) ? ev.monedas : []
  const monedas: MonedaEvento[] = []
  for (const m of crudas) {
    const codigo = String((m as MonedaEvento)?.codigo ?? '').trim()
    if (!codigo || monedas.some((x) => x.codigo === codigo)) continue
    monedas.push({
      codigo,
      simbolo: String((m as MonedaEvento)?.simbolo ?? '').trim() || simboloMoneda(codigo),
      nombre: String((m as MonedaEvento)?.nombre ?? '').trim() || codigo,
    })
  }
  if (monedas.length === 0) {
    return [{ codigo: base, simbolo: simboloMoneda(base), nombre: base }]
  }
  return monedas
}

/**
 * Precios de los extras por moneda.
 *
 * Compatibilidad: si un concepto está marcado CON COSTO pero no tiene ninguna
 * entrada en `extras_precio` (push viejo), se sintetiza desde las 4 columnas
 * escalares, que siguen llegando con los valores de la moneda base. El chequeo
 * es POR CONCEPTO y no global: un evento nuevo que cobra transporte y regala la
 * alimentación manda entradas sólo del primero, y ahí la ausencia del segundo
 * significa "gratis", no "faltan datos".
 */
export function normalizarExtrasPrecio(ev: EventoRemoto): ExtraPrecio[] {
  const crudos = Array.isArray(ev.extras_precio) ? ev.extras_precio : []
  const extras: ExtraPrecio[] = []
  for (const e of crudos) {
    const concepto = (e as ExtraPrecio)?.concepto
    const tipo = (e as ExtraPrecio)?.tipo_participante
    const moneda = String((e as ExtraPrecio)?.moneda_codigo ?? '').trim()
    const importe = Number((e as ExtraPrecio)?.importe)
    if (concepto !== 'transporte' && concepto !== 'alimentacion') continue
    if (tipo !== 'socio' && tipo !== 'no_socio') continue
    if (!moneda || !Number.isFinite(importe)) continue
    extras.push({ concepto, tipo_participante: tipo, moneda_codigo: moneda, importe })
  }

  const base = ev.moneda_codigo || 'UYU'
  const completar = (
    concepto: ConceptoExtra,
    conCosto: boolean,
    socio: number,
    noSocio: number,
  ) => {
    if (!conCosto) return
    if (extras.some((x) => x.concepto === concepto)) return
    extras.push(
      { concepto, tipo_participante: 'socio', moneda_codigo: base, importe: Number(socio) || 0 },
      { concepto, tipo_participante: 'no_socio', moneda_codigo: base, importe: Number(noSocio) || 0 },
    )
  }
  completar(
    'transporte',
    !!ev.transporte_disponible && !!ev.transporte_con_costo,
    ev.transporte_importe_socio,
    ev.transporte_importe_no_socio,
  )
  completar(
    'alimentacion',
    !!ev.alimentacion_disponible && !!ev.alimentacion_con_costo,
    ev.alimentacion_importe_socio,
    ev.alimentacion_importe_no_socio,
  )
  return extras
}

/**
 * "Otros" (categoría libre) efectivo: AND de los dos dueños del flag (E11).
 * El desktop lo setea en `eventos_remoto.permitir_categoria_otros` (push,
 * default TRUE si la fila es de antes de la migración 38); la web lo repite en
 * `evento_web_config` para poder apagarlo por evento sin tocar el desktop.
 * Cualquiera de los dos apagándolo alcanza para ocultar la opción: antes de
 * este helper la web sólo miraba su propia config y el toggle del desktop no
 * hacía nada.
 */
export function permitirCategoriaOtros(ev: EventoRemoto, cfg: EventoWebConfig): boolean {
  return cfg.permitir_categoria_otros && ev.permitir_categoria_otros !== false
}

/** Datos de cuenta por moneda, tolerante a un JSONB que no sea un objeto plano. */
export function normalizarDatosDepositoMonedas(ev: EventoRemoto): Record<string, string> {
  const raw = ev.datos_deposito_monedas
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [codigo, texto] of Object.entries(raw)) {
    const t = typeof texto === 'string' ? texto.trim() : ''
    if (codigo && t) out[codigo] = t
  }
  return out
}

/**
 * Categorías del evento: una entrada por categoría Y MONEDA, con el precio
 * socio y no_socio de esa moneda.
 *
 * Desde la migración 38 llegan varias filas con la misma
 * (evento_id, categoria_id, tipo_participante) y distinto `moneda_codigo`, así
 * que la moneda es parte de la clave de agrupación. Quien consuma esta lista
 * TIENE que filtrar por la moneda elegida.
 */
export async function loadCategoriasEvento(
  admin: SupabaseClient,
  eventoId: string,
  monedaBase: string,
): Promise<CategoriaEvento[]> {
  const { data, error } = await admin
    .from('evento_categorias_remoto')
    .select('categoria_id, categoria_nombre, tipo_participante, importe, moneda_codigo')
    .eq('evento_id', eventoId)

  if (error) throw new Error(`Error consultando categorías: ${error.message}`)

  const porCat = new Map<string, CategoriaEvento>()
  for (const r of (data ?? []) as {
    categoria_id: string
    categoria_nombre: string
    tipo_participante: TipoParticipante
    importe: number | string
    moneda_codigo: string | null
  }[]) {
    // Fila sin moneda: precio de la base (fila anterior a la migración 38).
    const moneda = r.moneda_codigo || monedaBase
    const clave = `${r.categoria_id}|${moneda}`
    let c = porCat.get(clave)
    if (!c) {
      c = {
        categoria_id: r.categoria_id,
        nombre: r.categoria_nombre,
        moneda_codigo: moneda,
        precio_socio: null,
        precio_no_socio: null,
      }
      porCat.set(clave, c)
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
 * Precio más alto definido en el evento para un tipo de participante EN UNA
 * MONEDA. Sirve de tarifa de referencia cuando la persona elige "Otros"
 * (categoría libre). Devuelve null si el evento no tiene ninguna categoría con
 * precio para ese tipo en esa moneda.
 *
 * El máximo se toma dentro de la moneda: comparar importes de monedas distintas
 * no significa nada (no hay cotización) y devolvería la tarifa equivocada.
 */
export async function precioMaximoCategoria(
  admin: SupabaseClient,
  eventoId: string,
  tipo: TipoParticipante,
  moneda: string,
  monedaBase: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('evento_categorias_remoto')
    .select('importe, moneda_codigo')
    .eq('evento_id', eventoId)
    .eq('tipo_participante', tipo)
  if (error) throw new Error(`Error consultando precio máximo: ${error.message}`)

  let max: number | null = null
  for (const r of (data ?? []) as { importe: number | string; moneda_codigo: string | null }[]) {
    if ((r.moneda_codigo || monedaBase) !== moneda) continue
    const n = Number(r.importe)
    if (Number.isFinite(n) && (max == null || n > max)) max = n
  }
  return max
}

/** Cuántas inscripciones ocupan cupo en el evento. */
export async function contarInscriptos(
  admin: SupabaseClient,
  evento: Pick<EventoRemoto, 'id' | 'ocupados_desktop'>,
): Promise<number> {
  const { count, error } = await admin
    .from('inscripciones_evento_remoto')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id)
    .in('estado', ESTADOS_OCUPAN)
  if (error) throw new Error(`Error contando inscriptos: ${error.message}`)
  // Acá sólo están las inscripciones que nacieron en la WEB. Las cargadas a
  // mano en el desktop ocupan el mismo cupo pero no tienen fila remota: llegan
  // como un contador que publica el push (65_eventos_puente_desktop.sql).
  // Sin ese contador un evento que se llena por los dos lados se sobrevende.
  return (count ?? 0) + (evento.ocupados_desktop ?? 0)
}

/** Cuántas inscripciones que ocupan cupo llevan transporte (para su cupo propio). */
export async function contarConTransporte(
  admin: SupabaseClient,
  evento: Pick<EventoRemoto, 'id' | 'ocupados_desktop_transporte'>,
): Promise<number> {
  const { count, error } = await admin
    .from('inscripciones_evento_remoto')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id)
    .eq('lleva_transporte', true)
    .in('estado', ESTADOS_OCUPAN)
  if (error) throw new Error(`Error contando transporte: ${error.message}`)
  // Mismo criterio que contarInscriptos: se suman los lugares de ómnibus
  // ocupados por inscripciones del desktop.
  return (count ?? 0) + (evento.ocupados_desktop_transporte ?? 0)
}

// ────────────────────────────────────────────────────────────────
// Sorteo: número correlativo por evento.
//
// El número NO se reusa: una inscripción anulada o rechazada conserva el suyo
// (queda quemado). Por eso la asignación es un contador monótono —el mayor
// asignado + 1— y NO una búsqueda de huecos libres: el hueco que deja una
// anulación no vuelve al pool. Se cuentan TODAS las filas del evento, sin
// filtrar por estado (a diferencia de los cupos, que usan ESTADOS_OCUPAN).
// Ver docs/supabase/31_eventos_sorteo.sql en el repo del desktop.
// ────────────────────────────────────────────────────────────────

/** Mayor número de sorteo asignado en el evento, o null si no se asignó ninguno. */
async function maxNumeroSorteo(
  admin: SupabaseClient,
  eventoId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('inscripciones_evento_remoto')
    .select('numero_sorteo')
    .eq('evento_id', eventoId)
    .not('numero_sorteo', 'is', null)
    .order('numero_sorteo', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Error consultando números de sorteo: ${error.message}`)
  return data ? Number(data.numero_sorteo) : null
}

/** Rango de números del evento, o null si está mal configurado (desde > hasta). */
function rangoSorteo(evento: EventoRemoto): { desde: number; hasta: number } | null {
  const desde = Number(evento.sorteo_numero_desde ?? 0)
  const hasta = Number(evento.sorteo_numero_hasta ?? 100)
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde) return null
  return { desde, hasta }
}

/**
 * Próximo número a asignar, o null si el rango se agotó (o está mal configurado).
 *
 * NO es atómico: dos inscripciones simultáneas pueden leer el mismo máximo. La
 * unicidad la garantiza el índice uq_inscripciones_evento_sorteo_numero, y el
 * insert reintenta ante su 23505. Ver POST /api/eventos/[slug]/inscribir.
 */
export async function proximoNumeroSorteo(
  admin: SupabaseClient,
  evento: EventoRemoto,
): Promise<number | null> {
  const rango = rangoSorteo(evento)
  if (!rango) return null
  const max = await maxNumeroSorteo(admin, evento.id)
  // Si el rango se movió después de asignar números, max+1 puede caer por debajo
  // del nuevo `desde`: el arranque manda.
  const proximo = max == null ? rango.desde : Math.max(max + 1, rango.desde)
  return proximo > rango.hasta ? null : proximo
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

/**
 * Arma el payload público. Devuelve null si el slug no existe.
 *
 * Envuelta en `cache()` de React (ver el `export const` al pie del archivo):
 * `/e/{slug}` la llama dos veces en el mismo request —`generateMetadata` para
 * el `<title>` y la página para el cuerpo— y sin dedupe eso son las 6-7
 * consultas de acá DUPLICADAS (P2). `createAdminClient()` devuelve siempre la
 * misma instancia cacheada por proceso (ver lib/supabase/admin.ts), así que el
 * `admin` que llega acá es el mismo objeto en las dos llamadas y `cache()` sí
 * puede dedupelas por (admin, slug).
 */
async function loadEventoPublicoImpl(
  admin: SupabaseClient,
  slug: string,
): Promise<EventoPublico | null> {
  const ev = await loadEventoRemotoBySlug(admin, slug)
  if (!ev) return null

  // Monedas del evento (la base primero). Todo el resto del payload —precios de
  // categoría, extras y datos de cuenta— viaja en TODAS ellas: el formulario
  // cambia de moneda sin volver al servidor.
  const monedas = normalizarMonedas(ev)

  // El cupo de transporte tiene su propio conteo (sólo si hay tope definido).
  const transporteConCupo = ev.transporte_disponible && ev.transporte_cupo_maximo != null
  const [categorias, inscriptos, categoriasSocio, config, transporteInscriptos, sorteoMax] =
    await Promise.all([
      loadCategoriasEvento(admin, ev.id, monedas[0].codigo),
      ev.cupo_maximo != null ? contarInscriptos(admin, ev) : Promise.resolve(0),
      // Las categorías de socio (clasificación sin precio) sólo se ofrecen como
      // grilla en eventos sin costo; en los con costo la grilla son las categorías
      // con precio (evento_categorias_remoto).
      ev.tipo === 'sin_costo'
        ? loadCategoriasSocio(admin, ev.empresa_id)
        : Promise.resolve([] as CategoriaSocioPublica[]),
      loadEventoWebConfig(admin, ev.id),
      transporteConCupo ? contarConTransporte(admin, ev) : Promise.resolve(0),
      ev.sorteo_disponible ? maxNumeroSorteo(admin, ev.id) : Promise.resolve(null),
    ])

  const cupoCompleto = ev.cupo_maximo != null && inscriptos >= ev.cupo_maximo
  const transporteCompleto =
    transporteConCupo && transporteInscriptos >= (ev.transporte_cupo_maximo as number)

  // Sorteo: el rango se consume de corrido (los números se queman), así que lo
  // asignado se deduce del máximo, no de un conteo de filas.
  const rango = ev.sorteo_disponible ? rangoSorteo(ev) : null
  const sorteoAsignados = rango && sorteoMax != null ? sorteoMax - rango.desde + 1 : 0
  const sorteoTotal = rango ? rango.hasta - rango.desde + 1 : 0
  // Rango mal configurado (rango null con sorteo prendido) = sin números que dar.
  const sorteoCompleto = !!ev.sorteo_disponible && (!rango || sorteoAsignados >= sorteoTotal)
  // Evento "solo sorteo": el registro ES la participación (ver `esSoloSorteo`).
  // Se evalúa con la config web ya cargada, igual que en el formulario.
  const soloSorteo = esSoloSorteo({
    slug: ev.slug,
    tipo: ev.tipo,
    sorteoVisible: !!ev.sorteo_disponible && config.mostrar_sorteo,
    transporteVisible: !!ev.transporte_disponible && config.mostrar_transporte,
    alimentacionVisible: !!ev.alimentacion_disponible && config.mostrar_alimentacion,
  })
  /**
   * Por qué no se puede inscribir. Tres noticias distintas, y dos de ellas se
   * contaban con la misma frase: un evento que se hizo el mes pasado se leía
   * igual que uno que cierra inscripciones mañana.
   *
   * `anulado` no aparece acá y no es un olvido: `loadEventoRemotoBySlug` lo
   * filtra, así que un evento anulado da 404 en vez de página. Es lo correcto y
   * no se toca — en `eventos_remoto` ese estado lo escribe también
   * `reconciliar_eventos_online` como soft-delete de todo lo que dejó de venir
   * en el push (un evento devuelto a borrador, una empresa a la que le apagaron
   * `permite_eventos_online`), así que no distingue una cancelación de una
   * despublicación y ningún texto podría afirmar cuál de las dos fue.
   *
   * La fecha pasada sólo cambia las PALABRAS del cierre; no cierra nada por su
   * cuenta. Un evento que sigue `abierto` el día después se deja abierto a
   * propósito: hay organizaciones que anotan gente en la puerta, y el estado lo
   * manda el desktop.
   */
  const yaSeRealizo = fechaYaPaso(ev.fecha_fin ?? ev.fecha_inicio)
  let titulo: string | null = null
  let motivo: string | null = null
  if (ev.estado !== 'abierto') {
    titulo = yaSeRealizo ? 'Este evento ya se realizó' : 'Inscripciones cerradas'
    motivo = yaSeRealizo
      ? 'La fecha ya pasó y no se reciben más inscripciones.'
      : 'Las inscripciones están cerradas'
  } else if (cupoCompleto) {
    titulo = 'Inscripciones cerradas'
    motivo = 'Se completó el cupo del evento'
  } else if (soloSorteo && sorteoCompleto) {
    // Evento que existe sólo para el sorteo y sin números que dar: registrarse
    // ya no deja nada. En un evento normal el rango agotado no cierra nada —la
    // inscripción vale por sí sola y el sorteo era un extra—, pero acá dejarlo
    // abierto sería juntar gente para una rifa sin boletas.
    titulo = 'Sorteo cerrado'
    motivo = 'Se agotaron los números del sorteo y no se reciben más registros.'
  }

  return {
    slug: ev.slug,
    nombre: ev.nombre,
    descripcion: ev.descripcion,
    lugar: ev.lugar,
    fecha: ev.fecha_inicio,
    fecha_fin: ev.fecha_fin,
    // La base es la primera de la lista, no `ev.moneda_codigo`: si el evento
    // publica en otra moneda primero, esa es la que preselecciona el selector.
    moneda_codigo: monedas[0].codigo,
    monedas,
    extras_precio: normalizarExtrasPrecio(ev),
    tipo: ev.tipo,
    umbral_cuotas_no_socio: ev.umbral_cuotas_no_socio,
    abierto: motivo == null,
    titulo_cerrado: titulo,
    motivo_cerrado: motivo,
    ocupacion_nivel: nivelOcupacion(inscriptos, ev.cupo_maximo),
    texto_antes: ev.texto_antes,
    texto_despues: ev.texto_despues,
    datos_deposito: ev.datos_deposito,
    datos_deposito_monedas: normalizarDatosDepositoMonedas(ev),
    // Default TRUE si la columna viene null (eventos previos a la migración 29).
    permitir_pago_realizado: ev.permitir_pago_realizado !== false,
    permitir_preinscripcion: ev.permitir_preinscripcion !== false,
    registro_permitido: normalizarRegistroPermitido(ev.registro_permitido),
    categorias,
    categorias_socio: categoriasSocio,
    // El AND con el flag del desktop se resuelve UNA vez acá: todo lo que lea
    // `evento.config.permitir_categoria_otros` de acá en más (EventoForm,
    // /inscribir) ya recibe el valor efectivo, sin tener que conocer que hay
    // dos dueños.
    config: { ...config, permitir_categoria_otros: permitirCategoriaOtros(ev, config) },
    transporte: {
      disponible: !!ev.transporte_disponible,
      con_costo: !!ev.transporte_con_costo,
      descripcion: ev.transporte_descripcion,
      ocupacion_nivel: transporteConCupo
        ? nivelOcupacion(transporteInscriptos, ev.transporte_cupo_maximo)
        : null,
      completo: transporteCompleto,
    },
    alimentacion: {
      disponible: !!ev.alimentacion_disponible,
      con_costo: !!ev.alimentacion_con_costo,
      descripcion: ev.alimentacion_descripcion,
      opciones: opcionesConSinRestriccion(parseOpcionesAlimentacion(ev.alimentacion_opciones)),
    },
    sorteo: {
      disponible: !!ev.sorteo_disponible,
      // Default TRUE si viene null (eventos previos a la migración 31): el caso
      // conservador es restringir a socios, no abrir el sorteo a todos.
      solo_socios: ev.sorteo_solo_socios !== false,
      descripcion: ev.sorteo_descripcion,
      ocupacion_nivel:
        rango && sorteoMax != null ? nivelOcupacion(sorteoAsignados, sorteoTotal) : null,
      completo: sorteoCompleto,
    },
    solo_sorteo: soloSorteo,
  }
}

/** Ver el comentario de `loadEventoPublicoImpl`: dedupe por request entre
 * `generateMetadata` y la página de `/e/{slug}`. */
export const loadEventoPublico = cache(loadEventoPublicoImpl)

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

// ────────────────────────────────────────────────────────────────
// Caché en memoria de proceso (60 s) para `estadosSocioDeEmpresa` y
// `padronDeEmpresa`: son config de empresa que casi nunca cambia y hoy se
// releen en cada verificación de cédula Y en cada inscripción (P3) — con un
// evento activo son decenas de lecturas idénticas por minuto.
//
// ⚠️ En serverless esto es caché POR INSTANCIA de función, no global: cada
// cold start arranca vacío y dos instancias tibias en paralelo no comparten
// nada entre sí. El ahorro es real igual (una instancia caliente atiende
// muchas verificaciones seguidas del mismo evento), pero no reemplaza un
// caché compartido (Redis, etc.) si el volumen lo pidiera algún día.
// ────────────────────────────────────────────────────────────────
const CACHE_CONFIG_EMPRESA_MS = 60_000

function crearCacheTTL<T>() {
  const mapa = new Map<string, { valor: T; vence: number }>()
  return {
    get(clave: string): { hit: true; valor: T } | { hit: false } {
      const fila = mapa.get(clave)
      if (!fila) return { hit: false }
      if (Date.now() > fila.vence) {
        mapa.delete(clave)
        return { hit: false }
      }
      return { hit: true, valor: fila.valor }
    },
    set(clave: string, valor: T) {
      mapa.set(clave, { valor, vence: Date.now() + CACHE_CONFIG_EMPRESA_MS })
    },
  }
}

const cacheEstadosSocio = crearCacheTTL<string[] | null>()
const cachePadron = crearCacheTTL<{ empresaId: string; grupoId: string | null }>()

/**
 * Estados de registro que cuentan como socio en esta empresa, o `null` si no lo
 * configuró (ahí manda el default de esEstadoSocio: sólo 'Activo*').
 * La tabla la escribe el desktop; ver supabase/empresa_estados_socio_remoto.sql.
 *
 * Si la tabla todavía no existe (migración sin aplicar) devolvemos `null` en vez
 * de romper: el formulario público sigue funcionando con el default.
 */
async function estadosSocioDeEmpresa(
  admin: SupabaseClient,
  empresaId: string,
): Promise<string[] | null> {
  const cacheado = cacheEstadosSocio.get(empresaId)
  if (cacheado.hit) return cacheado.valor

  const { data, error } = await admin
    .from('empresa_estados_socio_remoto')
    .select('estados')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (error) {
    // Tabla/columna que todavía no existe (migración sin aplicar): el default
    // es exactamente el comportamiento de siempre, no un fallo. Cualquier OTRO
    // error (timeout, PostgREST caído) se propaga: tragarlo acá cambiaba tarifa
    // y admisión en silencio (E13) — un error transitorio en un evento de Grupo
    // GREI hacía buscar la ficha en la empresa hija, "no encontrado", y de ahí
    // tarifa de no socio o un 403 "sólo socios al día" sin que nadie se enterara.
    // No se cachea el error: un timeout de un segundo no tiene por qué tapar la
    // config real durante el minuto siguiente.
    if (esTablaInexistente(error)) return null
    throw new Error(`Error leyendo estados de socio de la empresa: ${error.message}`)
  }
  const estados = data?.estados
  const resultado = Array.isArray(estados) ? estados.map((e) => String(e)) : null
  cacheEstadosSocio.set(empresaId, resultado)
  return resultado
}

/**
 * Scope donde vive la FICHA (socios_datos) de los socios de esta empresa.
 *
 * Todo lo demás que publica el desktop —cuotas, categoría por socio, estados de
 * socio— se lee del padrón y se republica bajo la empresa que ORGANIZA, así que
 * se busca por `empresa_id = evento.empresa_id`. La ficha es la excepción:
 * lleva el tenant de la PERSONA (`grupo_id` XOR `empresa_id`), que en un grupo
 * empresarial es la empresa padre o el grupo, nunca la empresa hijo. Buscarla
 * por la empresa del evento devolvía 0 filas y el formulario le contestaba
 * "no estás en la base" a socios que sí están.
 *
 * Devuelve los dos ids porque las fichas de un grupo pueden vivir en cualquiera
 * de los dos tenants, según se haya corrido o no la migración 41 del desktop.
 * Sin fila (o sin la tabla, migración sin aplicar) cae al comportamiento de
 * siempre: la empresa del evento. Ver docs/supabase/58_empresa_padron.sql del
 * repo desktop.
 */
async function padronDeEmpresa(
  admin: SupabaseClient,
  empresaId: string,
): Promise<{ empresaId: string; grupoId: string | null }> {
  const cacheado = cachePadron.get(empresaId)
  if (cacheado.hit) return cacheado.valor

  const propio = { empresaId, grupoId: null }
  const { data, error } = await admin
    .from('empresa_padron_remoto')
    .select('padron_empresa_id, padron_grupo_id')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (error) {
    // Mismo criterio que `estadosSocioDeEmpresa`: sin la tabla (migración 58 sin
    // aplicar) el default es correcto — buscar en la empresa del evento, que es
    // lo que se hacía antes de que existiera el padrón compartido. Cualquier
    // otro error se propaga (sin cachear): tragarlo mandaba a buscar la ficha en
    // el tenant equivocado sin avisar (ver E13).
    if (esTablaInexistente(error)) return propio
    throw new Error(`Error leyendo el padrón de la empresa: ${error.message}`)
  }
  const padronEmpresa = ((data?.padron_empresa_id as string | null) ?? '').trim()
  const resultado = !padronEmpresa
    ? propio
    : {
        empresaId: padronEmpresa,
        grupoId: ((data?.padron_grupo_id as string | null) ?? '').trim() || null,
      }
  cachePadron.set(empresaId, resultado)
  return resultado
}

/**
 * Resuelve la cédula contra el registro del evento y decide el tipo de
 * participante. Se exigen DOS condiciones para la tarifa de socio:
 *   1. el estado de registro de la ficha cuenta como socio (ver esEstadoSocio)
 *   2. cuotas_pendientes < umbral_cuotas_no_socio
 * Si falla cualquiera de las dos → 'no_socio'. No encontrado → 'no_socio'.
 *
 * POR QUÉ EL ESTADO: el push de socios_cuotas_remoto manda SÓLO a los deudores,
 * así que "sin fila" significa "sin cuotas pendientes". Un socio dado de baja y
 * sin deuda no tiene fila, y mirando sólo las cuotas daba "✓ Socio al día".
 *
 * Quien no pasa el filtro SIGUE ESTANDO en el padrón (`encontrado: true`):
 * conserva sus datos enmascarados y puede inscribirse como no socio; lo único
 * que pierde es la tarifa/bonificación de socio.
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
    estado_registro_nombre: null,
    estado_es_socio: false,
    tipo_participante: 'no_socio',
    categoria_id: null,
    categoria_nombre: null,
  }
  if (doc.length < 6) return vacio

  // La ficha se busca en el PADRÓN, que puede no ser la empresa del evento
  // (grupo empresarial: el socio es uno solo y vive en la padre o en el grupo).
  const padron = await padronDeEmpresa(admin, evento.empresa_id)

  let query = admin
    .from('socios_datos')
    .select(
      'id, nombre, apellido, mail, telefono, celular, documento_hash, estado_registro_nombre, grupo_id',
    )
    .eq('documento', doc)
    .is('deleted_at', null)

  query = padron.grupoId
    ? query.or(`empresa_id.eq.${padron.empresaId},grupo_id.eq.${padron.grupoId}`)
    : query.eq('empresa_id', padron.empresaId)

  const { data: socio, error } = await query
    // Si la misma cédula tiene ficha en los dos tenants (grupo y empresa padre)
    // gana la del grupo: es la que dejó la migración 41 y la que edita el
    // desktop desde que el padrón se comparte.
    .order('grupo_id', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Error buscando socio: ${error.message}`)
  if (!socio) return vacio

  const docHash = (socio.documento_hash as string) ?? ''

  // Cuotas pendientes + categoría del socio (ambas keyed por empresa +
  // documento_hash) + qué estados de registro cuentan como socio en la empresa.
  // Acá SÍ va la empresa del evento y no el padrón: el desktop lee estas tres
  // cosas del padrón y las republica bajo la empresa que organiza (ver
  // pushEventosOnline). La ficha de arriba es la única excepción.
  const [{ data: cuotasRow }, { data: catRow }, estadosSocio] = await Promise.all([
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
    estadosSocioDeEmpresa(admin, evento.empresa_id),
  ])

  const cuotas = Number(cuotasRow?.cuotas_pendientes ?? 0)
  const estadoRegistro = (socio.estado_registro_nombre as string | null) ?? null
  const alDia = cuotas < evento.umbral_cuotas_no_socio
  const estadoEsSocio = esEstadoSocio(estadoRegistro, estadosSocio)
  const tipo: TipoParticipante = estadoEsSocio && alDia ? 'socio' : 'no_socio'

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
    estado_registro_nombre: estadoRegistro,
    estado_es_socio: estadoEsSocio,
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

/** "Mario Bentancor" → "Ma••• Be•••". Enmascara cada parte por separado. */
function maskNombreCompleto(nombre: string, apellido: string): string | null {
  const partes = [maskTexto(nombre), maskTexto(apellido)].filter(Boolean)
  return partes.length ? partes.join(' ') : null
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
    .select('numero, estado, modalidad, categoria_nombre, importe, transporte_importe, alimentacion_importe, moneda_codigo, referencia_transferencia, mail, nombre, apellido')
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
    // Enmascarado por parte (nombre y apellido), nunca en claro: este payload lo
    // sirve un endpoint público (ver ResolucionPublica).
    nombre_mask: maskNombreCompleto(
      (data.nombre as string | null) ?? '',
      (data.apellido as string | null) ?? '',
    ),
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
/**
 * Normaliza la política de admisión que viene de la BD. Cualquier valor
 * desconocido (o null, en eventos previos a la migración) cae a 'todos', que es
 * el comportamiento histórico: una columna nueva nunca debe cerrar por accidente
 * un evento que ya estaba abierto.
 */
export function normalizarRegistroPermitido(v: unknown): RegistroPermitido {
  return v === 'padron' || v === 'socios_al_dia' ? v : 'todos'
}

export function proyectarResolucionPublica(
  r: ResolucionParticipante,
  opts: {
    documento: string
    inscripcionPrevia?: InscripcionPrevia | null
    /** Política del evento. Por defecto 'todos' (no restringe). */
    registroPermitido?: RegistroPermitido
  },
): ResolucionPublica {
  // Los masks se entregan a TODO el padrón, no sólo al socio al día: quien tiene
  // cuotas pendientes también tiene ficha y tampoco necesita re-escribir sus
  // datos. El costo de privacidad está documentado en ResolucionPublica.
  const enPadron = r.encontrado
  const politica = opts.registroPermitido ?? 'todos'
  return {
    tipo_participante: r.tipo_participante,
    // Si el estado cuenta como socio y aun así quedó 'no_socio', el único motivo
    // posible es la deuda: `tipo` sale de estado && cuotas (ver resolverParticipante).
    socio_con_deuda: r.estado_es_socio && r.tipo_participante === 'no_socio',
    puede_inscribirse: puedeInscribirse(politica, r.tipo_participante, r.encontrado),
    categoria_id: r.categoria_id,
    nombre_mask: enPadron ? maskTexto(r.nombre) : null,
    apellido_mask: enPadron ? maskTexto(r.apellido) : null,
    mail_mask: enPadron ? maskMail(r.mail) : null,
    telefono_mask: enPadron ? maskTelefono(r.telefono) : null,
    inscripcion_previa: opts.inscripcionPrevia ?? null,
    // El DV sólo se exige a quien no está en el padrón (ver lib/cedula). Se
    // avisa acá para que no complete todo el formulario y recién ahí se entere.
    cedula_invalida: !r.encontrado && !esCedulaUruguayaValida(opts.documento),
  }
}

/**
 * Precio de una categoría para un tipo de participante EN LA MONEDA ELEGIDA
 * (o null si no está definido).
 *
 * Desde la migración 38 hay una fila por moneda, así que filtrar por moneda no
 * es opcional: sin el filtro se tomaría la primera fila que aparezca y podría
 * cobrarse el importe en pesos a quien eligió dólares.
 */
export async function precioCategoria(
  admin: SupabaseClient,
  eventoId: string,
  categoriaId: string,
  tipo: TipoParticipante,
  moneda: string,
  monedaBase: string,
): Promise<{ importe: number; categoria_nombre: string } | null> {
  // Tolerante a duplicados: evento_categorias_remoto no tiene índice único sobre
  // (evento_id, categoria_id, tipo_participante, moneda_codigo) y el push
  // upserta por id local, así que una categoría recreada en el desktop puede
  // dejar dos filas. Se filtra por moneda en memoria —son pocas filas, una por
  // moneda— y se toma la más reciente.
  const { data, error } = await admin
    .from('evento_categorias_remoto')
    .select('importe, categoria_nombre, moneda_codigo')
    .eq('evento_id', eventoId)
    .eq('categoria_id', categoriaId)
    .eq('tipo_participante', tipo)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Error consultando precio: ${error.message}`)

  const fila = ((data ?? []) as {
    importe: number | string
    categoria_nombre: string
    moneda_codigo: string | null
  }[]).find((r) => (r.moneda_codigo || monedaBase) === moneda)
  if (!fila) return null
  return { importe: Number(fila.importe), categoria_nombre: fila.categoria_nombre }
}
