/**
 * Tipos de la asistencia por QR (modelo PUENTE con el desktop).
 * Sin imports server-only: seguro de importar desde Client Components.
 * Coinciden con docs/supabase/34_asistencia_qr.sql (repo desktop).
 */

/**
 * Snapshot de una entrada tal como lo devuelven `buscar_entrada` /
 * `marcar_asistencia_entrada`. El desktop es dueño del alta y del estado: la
 * web sólo escribe `asistio_at` / `asistio_por` / `asistio_origen`.
 */
export interface EntradaRemota {
  id: string
  token: string
  empresa_id: string
  evento_id: string
  evento_nombre: string
  evento_fecha: string | null
  evento_lugar: string | null
  nombre_completo: string
  documento: string | null
  categoria_nombre: string | null
  rol_nombre: string | null
  numero: string | null
  estado: 'valida' | 'anulada'
  asistio_at: string | null
  asistio_por: string | null
  asistio_origen: 'web' | 'desktop' | null
  emitida_at: string | null
  /** Traza de la última desmarca. Ver supabase/desmarcar_asistencia.sql. */
  desmarcada_at?: string | null
  desmarcada_por?: string | null
}

/**
 * Veredicto de los RPCs.
 *
 *   valida        la entrada se puede usar (sólo lo devuelve `buscar_entrada`)
 *   ok            se marcó la asistencia ahora, primera vez
 *   ya_presente   ya estaba marcada — se muestra la hora del PRIMER ingreso
 *   anulada       la inscripción se dio de baja: no se marca
 *   no_encontrada token inexistente (o de otra empresa: ver más abajo)
 */
export type ResultadoEntrada =
  | 'valida'
  | 'ok'
  | 'ya_presente'
  | 'anulada'
  | 'no_encontrada'

/**
 * Resultado extra que agrega la WEB, no el SQL: la entrada existe y es de esta
 * empresa, pero pertenece a OTRO evento del que se está controlando en la
 * puerta. No se marca nada — casi siempre significa que el operador eligió mal
 * el evento, o que la persona vino con el QR de otra fecha.
 */
export type ResultadoCheckin = ResultadoEntrada | 'otro_evento'

export interface BuscarEntradaResult {
  resultado: ResultadoEntrada
  entrada?: EntradaRemota
}

export interface MarcarEntradaResult {
  resultado: ResultadoEntrada
  entrada?: EntradaRemota
}

/**
 * Rol dentro del evento. El catálogo lo define el desktop (`roles_evento`), que
 * arranca con Asistente / Expositor / Organización y es editable por empresa.
 *
 * `Asistente` es el rol por defecto allá: una inscripción sin rol asignado ES
 * un asistente. Por eso el bucket de asistentes incluye también las entradas con
 * `rol_nombre` nulo — si no, la mayoría de la gente desaparecería de la lista.
 */
export const ROL_ASISTENTE = 'Asistente'

/** Valor del filtro que muestra todos los roles. */
export const ROL_TODOS = '__todos__'

export function esAsistente(rolNombre: string | null | undefined): boolean {
  return !rolNombre || rolNombre === ROL_ASISTENTE
}

/** Rol presente en un evento, con cuántas entradas tiene. */
export interface RolEvento {
  nombre: string
  total: number
}

/** Evento con QRs emitidos, tal como lo lista el selector de /checkin. */
export interface EventoCheckin {
  evento_id: string
  evento_nombre: string
  evento_fecha: string | null
  evento_lugar: string | null
  /** Entradas válidas (las anuladas no cuentan). */
  total: number
  /** Entradas válidas con asistencia marcada, sea desde la web o el desktop. */
  presentes: number
  /**
   * Roles presentes en el evento, para los filtros del control manual. Sale de
   * acá y no del endpoint de la lista para no reescanear el evento entero en
   * cada tecla de la búsqueda.
   */
  roles: RolEvento[]
}

/** Cómo se ordena y se muestra el nombre en el control manual. */
export type OrdenLista = 'nombre' | 'apellido'

/**
 * Agrupador del control manual: sube un estado arriba de todo SIN tocar el
 * orden alfabético, que sigue mandando dentro de cada grupo.
 *
 *   'ninguno'     una sola lista alfabética (el default de siempre)
 *   'pendientes'  primero los que faltan marcar — pasar lista buscando ausentes
 *   'presentes'   primero los ya marcados — repasar o corregir lo controlado
 */
export type AgrupacionLista = 'ninguno' | 'pendientes' | 'presentes'

/** Grupo de una fila del control manual. */
export type GrupoEntrada = 'pendiente' | 'presente' | 'anulada'

export function grupoEntrada(e: Pick<EntradaListada, 'estado' | 'asistio_at'>): GrupoEntrada {
  if (e.estado === 'anulada') return 'anulada'
  return e.asistio_at ? 'presente' : 'pendiente'
}

/**
 * Posición del grupo (menor = más arriba). Las anuladas van siempre últimas
 * cuando hay agrupación: no se pueden marcar, así que no compiten por el tope
 * ni con los pendientes ni con los presentes.
 */
export function rangoGrupo(g: GrupoEntrada, agrupar: AgrupacionLista): number {
  if (agrupar === 'ninguno') return 0
  if (g === 'anulada') return 2
  if (agrupar === 'pendientes') return g === 'pendiente' ? 0 : 1
  return g === 'presente' ? 0 : 1
}

/** Contador que devuelve el endpoint de marcado, para refrescar el header. */
export interface ConteoCheckin {
  total: number
  presentes: number
}

/** Fila del control manual de asistencia. */
export interface EntradaListada {
  token: string
  nombre_completo: string
  documento: string | null
  categoria_nombre: string | null
  rol_nombre: string | null
  numero: string | null
  estado: 'valida' | 'anulada'
  asistio_at: string | null
  /** Quién marcó. Se muestra antes de desmarcar: ayuda a decidir si es un error. */
  asistio_por: string | null
  /**
   * Nombre y apellido POR SEPARADO, resueltos contra la ficha del socio por
   * documento (ver `resolverNombres` en lib/entradas).
   *
   * El snapshot de la entrada trae un solo `nombre_completo` armado como
   * "NOMBRE APELLIDO", y partirlo con una heurística se equivoca con los casos
   * más comunes de acá: "MARÍA DEL CARMEN PÉREZ" (nombre compuesto) y "ANA
   * GONZÁLEZ ROSSI" (dos apellidos) se leen igual y no lo son. Cuando la ficha
   * no se puede resolver quedan en null y se usa `nombre_completo` tal cual.
   */
  nombre: string | null
  apellido: string | null
}

/**
 * Cómo se muestra el nombre según el orden elegido. Con 'apellido' arma
 * "APELLIDO, Nombre" — el formato de pasar lista.
 */
export function nombreMostrado(e: EntradaListada, orden: OrdenLista): string {
  if (orden === 'apellido' && e.apellido) {
    return e.nombre ? `${e.apellido}, ${e.nombre}` : e.apellido
  }
  return e.nombre_completo
}

/** Respuesta de POST /api/checkin/marcar. */
export interface MarcarResponse {
  resultado: ResultadoCheckin
  entrada: EntradaRemota | null
  conteo: ConteoCheckin | null
}

/**
 * Veredicto de `desmarcar_asistencia_entrada`.
 *
 *   ok             estaba presente y se dio de baja la asistencia
 *   no_estaba      ya figuraba ausente (doble toque) — no es un error
 *   no_encontrada  token inexistente o de otra empresa
 *   otro_evento    la agrega la web, igual que en el marcado
 */
export type ResultadoDesmarca = 'ok' | 'no_estaba' | 'no_encontrada' | 'otro_evento'

/** Respuesta de POST /api/checkin/desmarcar. */
export interface DesmarcarResponse {
  resultado: ResultadoDesmarca
  entrada: EntradaRemota | null
  conteo: ConteoCheckin | null
}

/** Copy por resultado. Único lugar donde vive el texto que ve el operador. */
export const RESULTADO_TITULO: Record<ResultadoCheckin, string> = {
  valida: 'Entrada válida',
  ok: 'Ingreso registrado',
  ya_presente: 'Ya había ingresado',
  anulada: 'Inscripción anulada',
  no_encontrada: 'QR no reconocido',
  otro_evento: 'Entrada de otro evento',
}
