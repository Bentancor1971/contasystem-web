/**
 * Tipos, búsqueda y mensajes de la mesa del local (elecciones, fase 5).
 *
 * Este archivo NO importa nada de servidor: lo usan por igual los Server
 * Components de `/mesa/*`, los route handlers y los componentes cliente. El
 * acceso a Supabase vive en `lib/mesa.ts` (service_role, server-only).
 *
 * Contrato: docs/supabase/47_mesa_presencial.sql y 51_mesa_boleta.sql del repo
 * desktop. Todas las RPC devuelven `{ ok: true, ... }` o `{ error: '<codigo>' }`.
 *
 * ⚠️ La búsqueda del padrón vive acá, y corre EN EL DISPOSITIVO. No existe —y no
 * hay que agregar nunca— un endpoint que reciba una cédula y conteste si esa
 * persona está: sería el oráculo de quién es socio que todo el módulo evita,
 * con un login delante. Ver el pedido en docs/web/elecciones-mesa.md.
 */

// ── Lo que devuelven las RPC ────────────────────────────────────────────────

export interface MesaIdentidad {
  id: string
  nombre: string
  sede: string | null
  tramo_desde: string | null
  tramo_hasta: string | null
}

export interface EleccionDeMesa {
  id: string
  nombre: string
  estado: string
  fecha_apertura: string
  fecha_cierre: string
  instructivo: string | null
}

/** `mesa_login`. Lo que la pantalla necesita saber del puesto. */
export interface SesionMesa {
  ok: true
  /** El UUID sólo lo ve el servidor: vive en una cookie httpOnly. */
  es_presidente: boolean
  mesa: MesaIdentidad
  eleccion: EleccionDeMesa
}

/** Una fila del padrón de mesa. Es la única tabla del módulo que lleva documento. */
export interface PersonaPadron {
  habilitado_id: string
  documento: string | null
  nombre_completo: string
  categoria: string | null
  estado_registro: string | null
  habilitado: boolean
  motivo_inhabilitacion: string | null
  voto_emitido_at: string | null
  /**
   * 'urna' (una mesa del local) | 'web' (por internet) | 'terminal' (la terminal
   * del local, desde 76_) | 'presencial' (la mesa del sistema/desktop) | null
   */
  voto_origen: string | null
  /** Mesa que lo marcó, si votó en urna. */
  mesa_id: string | null
  row_updated_at: string
}

export interface RespuestaPadron {
  ok: true
  /** Reloj del SERVIDOR. Es la única marca de agua válida para pedir el delta. */
  hasta: string
  completo: boolean
  padron: PersonaPadron[]
  /**
   * Desde 61_: si el canal web de esta elección sigue abierto. `false` contra
   * una base sin ese script (`mesa_padron` no lo devuelve, y no mostrar el
   * banner es el comportamiento seguro por defecto).
   */
  canal_web_abierto: boolean
  /**
   * Desde 75_: los dos cierres, en cada consulta (la comisión puede adelantar
   * el del voto por internet en pleno acto). `null` en `fecha_cierre_web` =
   * cierra con la elección. Sin ese script no vienen y la línea no se muestra.
   */
  fecha_cierre: string | null
  fecha_cierre_web: string | null
  /**
   * Desde 78_: desde cuándo se puede marcar en el local (la apertura propia de
   * las mesas o, sin ella, la de la elección). Sin ese script no viene.
   */
  fecha_apertura_mesas: string | null
}

export interface MarcaOk {
  ok: true
  habilitado_id: string
  emitido_at: string
  /**
   * Desde 61_: `mesa_marcar_voto` avisa (no bloquea) cuando el canal web de
   * esta elección sigue abierto al momento de marcar. No es un error: la
   * marca en papel vale igual.
   */
  advertencia?: 'canal_web_abierto'
}

export interface ControlMesa {
  ok: true
  mesa: string
  /** Personas marcadas por esta mesa. */
  marcas: number
  sobres_en_urna: number | null
  /** Total del recuento cargado (máximo entre papeletas). */
  recuento: number
  cerrada_at: string | null
  recuento_cargado_at: string | null
  difiere: boolean
  /**
   * Desde 76_: estado y cierres de la elección, para avisar en `/mesa/recuento`
   * que la votación sigue abierta. `null` contra una base sin ese script (ahí
   * la base tampoco exige observación para cerrar antes de hora).
   */
  eleccion_estado: string | null
  fecha_cierre: string | null
  fecha_cierre_web: string | null
}

export interface OpcionMesa {
  id: string
  numero: string | null
  titulo: string
  lema: string | null
}

export interface PapeletaMesa {
  id: string
  orden: number
  titulo: string
  tipo: string
  permite_blanco: boolean
  opciones: OpcionMesa[]
}

export interface BoletaMesa {
  ok: true
  papeletas: PapeletaMesa[]
}

/** Una fila del recuento manual. `opcion_id` null = blanco o anulado. */
export interface FilaRecuento {
  papeleta_id: string
  opcion_id: string | null
  es_blanco: boolean
  es_anulado: boolean
  cantidad: number
}

export interface ErrorMesa {
  error: string
  /** `bloqueado` — hasta cuándo. */
  hasta?: string
  /** `mesa_cerrada` */
  cerrada_at?: string
  /** `ya_voto` */
  emitido_at?: string
  voto_origen?: string
  mesa?: string
  /** `no_habilitado` */
  motivo?: string
  /** `requiere_observacion` */
  marcas?: number
  sobres?: number
  recuento?: number
  /** `requiere_observacion_cierre_anticipado` (76_): hasta cuándo se vota. */
  fecha_cierre?: string
  /**
   * `no_abierta` (78_): desde cuándo se puede marcar en el local.
   * `sesion_abierta` (79_): desde cuándo está abierta la otra sesión.
   */
  desde?: string
  /** `sesion_abierta` (79_): cuándo se libera si no se usa. */
  libre_at?: string
}

/**
 * `mesa_actividad` (79_). `vence_at` es cuándo se cierra la sesión si nadie
 * toca la pantalla; `ahora` es el reloj del servidor, para descontar el
 * desfase del dispositivo.
 */
export interface ActividadMesa {
  ok: true
  minutos: number
  vence_at: string
  ahora: string
}

export type RespuestaActividad = ActividadMesa | ErrorMesa

export type RespuestaLogin = SesionMesa | ErrorMesa
export type RespuestaPadronRpc = RespuestaPadron | ErrorMesa
export type RespuestaMarca = MarcaOk | ErrorMesa
export type RespuestaControl = ControlMesa | ErrorMesa
export type RespuestaBoleta = BoletaMesa | ErrorMesa

export function esErrorMesa<T extends { ok: true }>(r: T | ErrorMesa): r is ErrorMesa {
  return !('ok' in r) || r.ok !== true
}

/**
 * Lee la respuesta de una ruta de `/api/mesa/` desde el navegador.
 *
 * Un 5xx o un cuerpo que no es JSON NO es un fallo de la operación: el server
 * pudo haber escrito en la base y caerse después. Se devuelve `sin_respuesta`
 * — "no sabemos si llegó" — para que la pantalla recargue lo que de verdad
 * quedó en vez de afirmar que no se registró. Si se mostrara como fallo, el
 * reintento de una marca que sí entró sale como "ya votó en Mesa 1" y parece
 * fraude.
 */
export async function leerRespuestaMesa<T extends { ok: true }>(res: Response): Promise<T | ErrorMesa> {
  if (res.status >= 500) return { error: 'sin_respuesta' }
  let d: unknown
  try {
    d = await res.json()
  } catch {
    return { error: 'sin_respuesta' }
  }
  if (!d || typeof d !== 'object') return { error: 'sin_respuesta' }
  const o = d as Record<string, unknown>
  if (o.ok === true) return o as unknown as T
  if (typeof o.error === 'string') return o as unknown as ErrorMesa
  return { error: 'sin_respuesta' }
}

/**
 * La sesión de mesa es el UUID que devuelve `mesa_login`. Una cookie con otra
 * cosa (rota, recortada, de otra versión) se trata como sesión vencida: la RPC
 * espera un `uuid` y con basura Postgres tira un error de tipo, que salía como
 * 500 y la pantalla mostraba "sin conexión" para siempre.
 */
export function sesionMesaValida(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

// ── El recuento que manda la pantalla ───────────────────────────────────────

/** Techos de tamaño. Una boleta real tiene un puñado de papeletas y opciones. */
const MAX_FILAS_RECUENTO = 2000
/** Ningún club tiene una mesa con más votos que esto. Frena el dedo pegado. */
export const MAX_CANTIDAD_RECUENTO = 100000

/**
 * Normaliza las filas de recuento que llegan por body. `null` = vino con una
 * forma que no se puede usar. La usan `/api/mesa/recuento` (guardar) y
 * `/api/mesa/cerrar` (guardar y cerrar en una sola operación, 76_).
 */
export function parseFilasRecuento(v: unknown): FilaRecuento[] | null {
  if (!Array.isArray(v) || v.length > MAX_FILAS_RECUENTO) return null
  const out: FilaRecuento[] = []
  for (const f of v) {
    if (!f || typeof f !== 'object') return null
    const o = f as Record<string, unknown>
    if (!idValido(o.papeleta_id)) return null

    const opcion = o.opcion_id
    if (opcion !== null && opcion !== undefined && !idValido(opcion)) return null

    const n = typeof o.cantidad === 'number' ? o.cantidad : Number(o.cantidad)
    if (!Number.isFinite(n) || n < 0 || n > MAX_CANTIDAD_RECUENTO) return null

    out.push({
      papeleta_id: o.papeleta_id,
      opcion_id: typeof opcion === 'string' ? opcion : null,
      es_blanco: o.es_blanco === true,
      es_anulado: o.es_anulado === true,
      cantidad: Math.trunc(n),
    })
  }
  return out
}

/** Mismo criterio que `mesa_control`: el total de la urna es el máximo entre papeletas. */
export function totalDeFilas(filas: readonly FilaRecuento[]): number {
  const porPapeleta = new Map<string, number>()
  for (const f of filas) porPapeleta.set(f.papeleta_id, (porPapeleta.get(f.papeleta_id) ?? 0) + f.cantidad)
  let max = 0
  for (const t of porPapeleta.values()) max = Math.max(max, t)
  return max
}

// ── Búsqueda: nombre y cédula en el mismo campo ─────────────────────────────

/**
 * Sin acentos y en minúsculas. "Pérez" y "perez" tienen que ser lo mismo: el
 * operador tipea rápido y no va a poner tildes.
 */
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    // Rango de diacríticos combinantes, escapado a propósito: el mismo carácter
    // escrito literal es invisible en un diff y se pierde en cualquier copy-paste.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Sólo los dígitos, de los dos lados de la comparación. La cédula viene tipeada
 * como sale del documento —con puntos, con guion o pelada— y en el padrón está
 * como la cargó la institución. Sin normalizar las dos puntas, la búsqueda
 * falla justo con quien la tiene escrita distinto, que es el caso que más apura
 * en el mostrador.
 */
export function soloDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/** Una persona con sus campos de búsqueda ya normalizados. Se calcula una vez. */
export interface PersonaIndexada extends PersonaPadron {
  _nombre: string
  _doc: string
}

export function indexar(p: PersonaPadron): PersonaIndexada {
  return { ...p, _nombre: normalizarNombre(p.nombre_completo), _doc: soloDigitos(p.documento) }
}

/** Largo mínimo de la consulta. Por debajo no se filtra: sería todo el padrón. */
export const MINIMO_BUSQUEDA = 2

/**
 * Filtra el padrón en memoria. Un solo campo que busca por las dos cosas a la
 * vez, sin selector de "buscar por…" que alguien pueda dejar mal puesto:
 *
 *  · por NOMBRE, por cualquier parte y en cualquier orden — mucha gente dice
 *    primero el apellido, así que "juan perez" tiene que encontrar a
 *    "JUAN CARLOS PEREZ GOMEZ";
 *  · por CÉDULA, por coincidencia parcial — tipear los últimos cuatro o cinco
 *    dígitos alcanza.
 *
 * Los dos criterios se combinan con OR: quien tipea "1234" busca una cédula y
 * quien tipea "perez" busca un apellido, y ninguno de los dos tiene que
 * elegirlo de antemano.
 */
export function buscarEnPadron(
  padron: readonly PersonaIndexada[],
  consulta: string,
): PersonaIndexada[] {
  const q = consulta.trim()
  if (q.length < MINIMO_BUSQUEDA) return []

  const digitos = soloDigitos(q)
  const palabras = normalizarNombre(q)
    .split(' ')
    .filter((t) => t.length > 0 && /[a-z]/.test(t))

  return padron.filter((p) => {
    const porNombre = palabras.length > 0 && palabras.every((t) => p._nombre.includes(t))
    const porDoc = digitos.length >= MINIMO_BUSQUEDA && p._doc !== '' && p._doc.includes(digitos)
    return porNombre || porDoc
  })
}

// ── Estado de una persona en la pantalla ────────────────────────────────────

export type EstadoPersona = 'habilitada' | 'voto' | 'inhabilitada'

export function estadoDe(p: PersonaPadron): EstadoPersona {
  if (p.voto_emitido_at) return 'voto'
  return p.habilitado ? 'habilitada' : 'inhabilitada'
}

/**
 * "por internet" o "en la mesa": lo que el operador necesita leer para resolver
 * en el mostrador a quien viene a votar y ya figura votando.
 */
export function dondeVoto(p: PersonaPadron, mesaPropia: string | null): string {
  if (p.voto_origen === 'urna') {
    return p.mesa_id && p.mesa_id === mesaPropia ? 'en esta mesa' : 'en otra mesa'
  }
  return dondeVotoPorOrigen(p.voto_origen, null)
}

/**
 * Lo mismo, a partir del `voto_origen` que devuelve `mesa_marcar_voto` en un
 * `ya_voto` (con el nombre de la mesa, si fue en urna). Desde 76_ la terminal
 * del local llega como 'terminal' y no como 'web', y la mesa del desktop como
 * 'presencial' — antes la primera se leía "por internet" y la segunda "en otra
 * mesa", y el operador le decía a la persona algo que no había pasado.
 */
export function dondeVotoPorOrigen(origen: string | null | undefined, mesa: string | null | undefined): string {
  switch (origen) {
    case 'web':
      return 'por internet'
    case 'terminal':
      return 'en la terminal del local'
    case 'presencial':
      return 'en la mesa del sistema'
    case 'urna':
      return mesa ? `en ${mesa}` : 'en otra mesa'
    default:
      return 'ya registrado'
  }
}

// ── Mensajes ────────────────────────────────────────────────────────────────

export interface MensajeMesa {
  titulo: string
  detalle: string
}

/** Traduce un error de las RPC de mesa al texto que se ve en el mostrador. */
export function mensajeErrorMesa(r: ErrorMesa): MensajeMesa {
  switch (r.error) {
    case 'codigo_inexistente':
      return {
        titulo: 'Ese código no existe',
        detalle: 'Revisá que esté completo, tal como figura en la planilla de la mesa.',
      }
    case 'pin_incorrecto':
      return {
        titulo: 'El PIN no coincide',
        detalle: 'Después de cinco intentos la mesa queda bloqueada 15 minutos.',
      }
    case 'bloqueado':
      return {
        titulo: 'Mesa bloqueada por intentos fallidos',
        detalle: r.hasta
          ? `Se puede volver a entrar después de las ${horaCorta(r.hasta)}.`
          : 'Esperá 15 minutos y volvé a probar.',
      }
    case 'mesa_inactiva':
      return {
        titulo: 'Esta mesa no está activa',
        detalle: 'La comisión electoral la desactivó desde el sistema.',
      }
    case 'mesa_cerrada':
      return {
        titulo: 'La urna de esta mesa ya se cerró',
        detalle: r.cerrada_at
          ? `Se cerró a las ${horaCorta(r.cerrada_at)} y no se puede reabrir desde acá.`
          : 'No se puede reabrir desde acá.',
      }
    case 'sesion_invalida':
      // `motivo` desde 79_: por qué terminó. Sin él, el "venció" de siempre.
      switch (r.motivo) {
        case 'inactividad':
          return {
            titulo: 'La sesión se cerró por inactividad',
            detalle: 'Volvé a entrar con el código y el PIN. Lo que ya se marcó está guardado.',
          }
        case 'cancelada':
          return {
            titulo: 'La comisión cerró esta sesión',
            detalle: 'Se puede volver a entrar con el mismo código y PIN.',
          }
        case 'bloqueada':
          return {
            titulo: 'La comisión bloqueó la entrada a esta mesa',
            detalle: 'Cuando la habilite, se entra con el mismo código y PIN.',
          }
        default:
          return {
            titulo: 'La sesión de la mesa venció',
            detalle: 'Volvé a entrar con el código y el PIN.',
          }
      }
    case 'sesion_abierta':
      return {
        titulo: 'La mesa ya está abierta en otro dispositivo',
        detalle:
          (r.desde ? `Se entró a las ${horaCorta(r.desde)} con este mismo PIN. ` : 'Hay otra sesión con este mismo PIN. ') +
          (r.libre_at
            ? `Si ese dispositivo no se usa, se libera a las ${horaCorta(r.libre_at)}, o pedile a la comisión que cierre la sesión.`
            : 'Esperá a que se cierre por inactividad o pedile a la comisión que la cierre.'),
      }
    case 'entrada_bloqueada':
      return {
        titulo: 'La comisión bloqueó la entrada a esta mesa',
        detalle: 'Cuando la habilite, se entra con el mismo código y PIN.',
      }
    case 'requiere_presidente':
      return {
        titulo: 'Hace falta el PIN de presidente',
        detalle: 'El recuento y el cierre de la urna sólo se cargan con ese PIN.',
      }
    case 'eleccion_cerrada':
      return {
        titulo: 'La elección está cerrada',
        detalle: 'Ya no se pueden registrar votos.',
      }
    case 'no_abierta':
      return r.desde
        ? {
            titulo: 'La mesa todavía no abrió',
            detalle: `Se pueden marcar votantes desde las ${horaOFecha(r.desde)}.`,
          }
        : {
            titulo: 'La elección todavía no está abierta',
            detalle: 'No se puede registrar ningún voto hasta que la comisión la abra.',
          }
    case 'no_esta_en_padron':
      return {
        titulo: 'Esa persona no está en el padrón',
        detalle: 'Volvé a cargar la pantalla; puede ser un padrón viejo en memoria.',
      }
    case 'no_habilitado':
      return {
        titulo: 'No está habilitada para votar',
        detalle: r.motivo ?? 'Figura inhabilitada en el padrón.',
      }
    case 'no_se_puede_desmarcar':
      return {
        titulo: 'No se puede desmarcar',
        detalle: 'Sólo se deshace lo que marcó esta misma mesa. El resto lo anula la comisión.',
      }
    case 'motivo_requerido':
      return { titulo: 'Falta el motivo', detalle: 'Escribí por qué se desmarca.' }
    case 'falta_recuento':
      return {
        titulo: 'Falta cargar el recuento',
        detalle: 'Antes de cerrar la urna hay que guardar los votos contados.',
      }
    case 'recuento_invalido':
      return {
        titulo: 'Alguno de los números no es válido',
        detalle: 'Tienen que ser enteros entre 0 y 100.000. Revisá las casillas y volvé a guardar.',
      }
    case 'sobres_invalidos':
      return {
        titulo: 'Ese número de sobres no es válido',
        detalle: 'Tiene que ser un entero entre 0 y 100.000.',
      }
    case 'requiere_observacion':
      return {
        titulo: 'La cuenta no cierra',
        detalle:
          typeof r.marcas === 'number' && typeof r.sobres === 'number'
            ? `La mesa marcó ${r.marcas} ${r.marcas === 1 ? 'persona' : 'personas'} y contaste ${r.sobres} ${
                r.sobres === 1 ? 'sobre' : 'sobres'
              }${
                typeof r.recuento === 'number'
                  ? ` y ${r.recuento} ${r.recuento === 1 ? 'voto' : 'votos'} en el recuento`
                  : ''
              }. Escribí una observación para poder cerrar.`
            : 'Escribí una observación para poder cerrar.',
      }
    case 'requiere_observacion_cierre_anticipado':
      return {
        titulo: 'La votación todavía no terminó',
        detalle:
          (r.fecha_cierre
            ? `Se vota hasta las ${horaOFecha(r.fecha_cierre)}. `
            : 'La hora de cierre de la elección todavía no llegó. ') +
          'Para cerrar la urna antes, escribí en la observación por qué.',
      }
    case 'sin_respuesta':
      return {
        titulo: 'No pudimos confirmar la operación',
        detalle: 'Se cortó la conexión. Verificá en la lista antes de volver a intentar.',
      }
    default:
      return {
        titulo: 'No pudimos completar la operación',
        detalle: 'Volvé a probar en un momento.',
      }
  }
}

// ── Fechas ──────────────────────────────────────────────────────────────────

const TZ = 'America/Montevideo'

/** "18:42" en hora de Montevideo. El server corre en UTC. */
export function horaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/** "2026-10-24" del día de ese instante en Montevideo. */
function diaUY(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/**
 * "18:42" si es hoy en Montevideo, "23/10 18:42" si es otro día. Para los
 * cierres: "internet cerró a las 20:00" leído al día siguiente parece de hoy.
 */
export function horaOFecha(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  if (diaUY(d) === diaUY(new Date())) return horaCorta(iso)
  const dm = new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
  }).format(d)
  return `${dm} ${horaCorta(iso)}`
}

/**
 * El cierre del voto por internet que vale la pena mostrar. `null` cuando no
 * hay uno propio: sin fecha, o una que no es anterior al de las mesas (el
 * voto por internet nunca sigue abierto después de la elección, así que
 * cierran juntos).
 */
export function cierreWebEfectivo(
  fechaCierre: string | null | undefined,
  fechaCierreWeb: string | null | undefined,
): string | null {
  if (!fechaCierreWeb) return null
  const w = new Date(fechaCierreWeb).getTime()
  if (isNaN(w)) return null
  const m = fechaCierre ? new Date(fechaCierre).getTime() : NaN
  if (!isNaN(m) && w >= m) return null
  return fechaCierreWeb
}

// ── Validación de entrada ───────────────────────────────────────────────────

/**
 * El código se normaliza en el RPC (mayúsculas, sin separadores). Acá sólo se
 * frena lo absurdo, y con manga ancha: quien copia de un papel escribe espacios,
 * guiones y minúsculas, y eso tiene que entrar igual.
 */
export function codigoMesaValido(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && v.length <= 40
}

/** PIN de 6 dígitos. Se aceptan 4 a 10 para no acoplarse al largo que use el desktop. */
export function pinValido(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4,10}$/.test(v.trim())
}

/** Los ids que emite el desktop son texto; se frena el largo y nada más. */
export function idValido(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && v.length <= 100
}
