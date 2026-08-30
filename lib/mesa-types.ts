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
  /** 'web' | 'urna' | null */
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
}

export type RespuestaLogin = SesionMesa | ErrorMesa
export type RespuestaPadronRpc = RespuestaPadron | ErrorMesa
export type RespuestaMarca = MarcaOk | ErrorMesa
export type RespuestaControl = ControlMesa | ErrorMesa
export type RespuestaBoleta = BoletaMesa | ErrorMesa

export function esErrorMesa<T extends { ok: true }>(r: T | ErrorMesa): r is ErrorMesa {
  return !('ok' in r) || r.ok !== true
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
  if (p.voto_origen === 'web') return 'por internet'
  if (p.voto_origen === 'urna') {
    return p.mesa_id && p.mesa_id === mesaPropia ? 'en esta mesa' : 'en otra mesa'
  }
  return 'ya registrado'
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
      return {
        titulo: 'La sesión de la mesa venció',
        detalle: 'Volvé a entrar con el código y el PIN.',
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
      return {
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
              }. Escribí una observación para poder cerrar.`
            : 'Escribí una observación para poder cerrar.',
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
