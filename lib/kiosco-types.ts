/**
 * Tipos y mensajes de la terminal de mesa (`/v/mesa`).
 *
 * Este archivo NO importa nada de servidor: lo usan por igual el Server
 * Component de la terminal, los route handlers y los componentes cliente. La
 * firma de la sesión y las llamadas a Supabase viven en `lib/kiosco.ts`.
 *
 * Contrato: docs/supabase/46_voto_kiosco.sql del repo desktop.
 *
 * Los errores de credencial siguen siendo los de la votación de siempre: acá
 * sólo se agregan los que son propios del modo mesa, y se reescriben los pocos
 * que hablarían de links o de mails a alguien que está frente a una tablet.
 *
 * Qué es la terminal, en una línea: la tablet que se deja en el local para que
 * la persona marque su boleta sola. El operador la identifica con la cédula
 * física contra el padrón del desktop y le entrega el código impreso; el voto
 * entra por el mismo camino que uno de casa y lo único que lo distingue es el
 * nombre de la terminal, que el acta cuenta aparte.
 */

import {
  mensajeDeError,
  type ErrorVotacion,
  type MensajeVotacion,
} from '@/lib/elecciones-types'

// ── Lo que devuelve `abrir_kiosco` ──────────────────────────────────────────

/**
 * Los datos de la elección que atiende una llave. Se muestran ANTES de montar:
 * montar la terminal en la elección equivocada se descubre tarde y mal.
 */
export interface DatosTerminal {
  eleccion_id: string
  nombre: string
  fecha_apertura: string
  fecha_cierre: string
  estado: string
}

/** Lo que la pantalla de la terminal necesita saber de sí misma. */
export interface InfoTerminal {
  eleccion_id: string
  /** Nombre de la elección, para que el operador vea dónde está montado. */
  eleccion: string
  /** Nombre que el operador le puso a esta terminal. Es lo que va al acta. */
  terminal: string
}

// ── Errores propios del modo mesa ───────────────────────────────────────────

/**
 * Los códigos que NO vienen de la votación: los pone esta ruta. Los errores de
 * credencial (`digitos_incorrectos`, `ya_voto`, `bloqueado`…) siguen siendo los
 * de siempre y los traduce `mensajeDeError` de `lib/elecciones-types.ts`.
 */
export type ErrorKiosco =
  /** La llave no existe, es de otra elección, o el desktop la regeneró. */
  | 'codigo_invalido'
  /** La base de la web no tiene `46_voto_kiosco.sql` aplicado. */
  | 'kiosco_no_disponible'
  /** No hay terminal montada en este dispositivo, o dejó de estarlo. */
  | 'sesion_invalida'
  /** El código de credencial es válido pero de OTRA elección. */
  | 'otra_eleccion'
  /** El nombre de la terminal vino vacío o imposible. */
  | 'terminal_invalida'
  /** El pase del votante venció: alguien dejó la pantalla abierta. */
  | 'pase_vencido'

export interface MensajeKiosco {
  titulo: string
  detalle: string
}

/**
 * Mensajes del modo mesa. Los lee el OPERADOR, no el votante: por eso dicen qué
 * hacer —regenerar la llave, aplicar el SQL— en vez de disculparse.
 *
 * `codigo_invalido` es deliberadamente uno solo para tres causas distintas
 * (no existe / es de otra elección / fue regenerada). Distinguirlas convertiría
 * la pantalla en un oráculo para adivinar llaves.
 */
export function mensajeKiosco(error: ErrorKiosco | string): MensajeKiosco {
  switch (error) {
    case 'codigo_invalido':
      return {
        titulo: 'La llave no sirve',
        detalle:
          'Puede estar mal tipeada, ser de otra elección o haberla regenerado desde el ' +
          'sistema. Sacá una nueva en Elecciones → Credenciales → Terminal de mesa.',
      }
    case 'kiosco_no_disponible':
      return {
        titulo: 'La terminal todavía no está habilitada en el servidor',
        detalle:
          'Falta aplicar 46_voto_kiosco.sql en la base de la web. Hasta que se aplique, ' +
          'la tablet no puede montarse.',
      }
    case 'sesion_invalida':
      return {
        titulo: 'Esta terminal se cerró',
        detalle:
          'La cerraron o regeneraron la llave desde el sistema. Para seguir atendiendo, ' +
          'volvé a montarla con la llave nueva.',
      }
    case 'otra_eleccion':
      return {
        titulo: 'Ese código es de otra elección',
        detalle:
          'Esta terminal está montada para una elección distinta. Fijate que sea la ' +
          'credencial correcta antes de volver a probar.',
      }
    case 'terminal_invalida':
      return {
        titulo: 'Falta el nombre de la terminal',
        detalle: 'Poné cómo se llama esta mesa: es lo que después se imprime en el acta.',
      }
    default:
      return {
        titulo: 'No pudimos completar la operación',
        detalle: 'Volvé a probar en un momento.',
      }
  }
}

/**
 * El mismo error de votación, dicho para alguien parado frente a una tablet.
 *
 * Los mensajes de `/v/{token}` hablan de links, de mails y de volver a cargar la
 * página: ahí es exactamente lo que hay que decir, porque quien lee está solo en
 * su casa con su celular. Acá no hay link ni mail, y hay un operador a un metro:
 * la salida de casi todo es avisarle a él.
 *
 * Lo que NO se cambia son los mensajes que protegen algo —dígitos, bloqueo, ya
 * votó, cierre del canal web—: esos ya están escritos con el cuidado que
 * necesitan y se reusan tal cual.
 */
export function mensajeEnTerminal(r: ErrorVotacion): MensajeVotacion {
  switch (r.error) {
    case 'codigo_inexistente':
      return {
        titulo: 'Ese código no sirve',
        detalle:
          'Fijate que lo hayas escrito completo, tal cual figura en el papel. Si sigue sin ' +
          'andar, pedile otro al operador de la mesa.',
        terminal: false,
      }

    case 'otra_eleccion': {
      const m = mensajeKiosco('otra_eleccion')
      return { ...m, terminal: false }
    }

    case 'pase_vencido':
      return {
        titulo: 'Pasó demasiado tiempo',
        detalle: 'Por seguridad hay que empezar de nuevo: escribí otra vez tu código.',
        terminal: true,
      }

    case 'sesion_invalida':
      return {
        titulo: 'Esta terminal se cerró',
        detalle: 'Avisale al operador de la mesa.',
        terminal: true,
      }

    case 'no_abierta':
      return {
        titulo: 'La votación todavía no está abierta',
        detalle: 'Avisale al operador de la mesa.',
        terminal: true,
      }

    case 'eleccion_cerrada':
      return {
        titulo: 'La votación está cerrada',
        detalle: 'Ya no se pueden emitir votos. Avisale al operador de la mesa.',
        terminal: true,
      }

    case 'opcion_invalida':
      return {
        titulo: 'Revisá tu selección',
        detalle: 'Alguna de las opciones marcadas ya no existe. Avisale al operador de la mesa.',
        terminal: true,
      }

    default:
      // Sin mail de contacto: en un dispositivo compartido no se ofrece escribir
      // a ningún lado, y la persona tiene al operador ahí mismo.
      return mensajeDeError(r, null)
  }
}

// ── Validación de entrada ───────────────────────────────────────────────────

/** Tope defensivo. La llave son 10 caracteres; se aceptan espacios y guiones. */
const MAX_LLAVE = 40

/**
 * Normaliza la llave como la tipea el operador desde un papel: mayúsculas y sin
 * separadores. El alfabeto no tiene 0/O ni 1/I/L justamente para que no haya
 * que adivinar. Devuelve `null` si no puede ser una llave.
 */
export function llaveNormalizada(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const limpia = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (limpia === '' || limpia.length > MAX_LLAVE) return null
  return limpia
}

/** Tope de la columna `votos_remoto.terminal`, que corta en 60. */
export const MAX_NOMBRE_TERMINAL = 60

/** "Mesa 1". Devuelve `null` si vino vacío o imposible. */
export function nombreTerminalNormalizado(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const limpio = v.replace(/\s+/g, ' ').trim()
  if (limpio === '') return null
  return limpio.slice(0, MAX_NOMBRE_TERMINAL)
}

// ── Las tres reglas del modo mesa, en números ───────────────────────────────
//
// Son las que diferencian la terminal de la misma pantalla abierta en una
// tablet. Viven acá para que el componente no las tenga sueltas y para que
// cambiarlas sea una decisión y no un retoque.

/**
 * Inactividad con datos de una persona en pantalla. Es el riesgo real del
 * kiosco: alguien marca media boleta, se distrae o se va, y el siguiente se
 * encuentra el voto del anterior.
 */
export const INACTIVIDAD_MS = 90_000

/** Cuánto antes del corte se avisa, para que nadie pierda la boleta sin verlo. */
export const AVISO_MS = 20_000

/** Cuánto queda en pantalla la constancia antes de volver sola al inicio. */
export const VUELTA_MS = 20_000
