/**
 * Tipos y helpers de la ficha web (/f/[token]): el socio revisa sus datos y
 * PROPONE cambios, que el desktop revisa y aplica (o no) campo por campo.
 * La web nunca escribe socios_datos.
 *
 * Sin imports server-only: esto lo usan la página, el client component
 * (FichaForm) y los route handlers. El acceso a las RPC vive en lib/ficha.ts.
 *
 * Qué se toma prestado de `elecciones-types` y por qué: `tokenValido` es el
 * mismo formato de token personal de todo el repo (base64url, 8-100), y
 * duplicar el regex es la clase de divergencia silenciosa que después nadie
 * encuentra. Ver docs/supabase/66_ficha_web.sql del repo desktop.
 */

import { formatHoraUY } from '@/lib/format'
import { tokenValido } from '@/lib/elecciones-types'

export { tokenValido }

// ── El contrato con la base ─────────────────────────────────────────────────

/**
 * Lista blanca de campos que puede traer una propuesta de cambios. ESPEJO del
 * array `c_campos` de `registrar_ficha_cambio` (66_ficha_web.sql): la exigencia
 * real la aplica la RPC; esta copia existe para que el handler no mande basura
 * y para tipar el formulario.
 *
 * `documento` sólo se acepta si la credencial entró con cédula inválida
 * (modo 'codigo'); con cédula válida la RPC lo descarta.
 */
export const CAMPOS_FICHA = [
  'nombre',
  'apellido',
  'sexo',
  'fecha_nacimiento',
  'generacion',
  'fecha_recibido',
  'telefono',
  'celular',
  'mail',
  'direccion',
  'localidad',
  'categoria_id',
  'forma_pago_id',
  'estado_registro_id',
  'tipo_pago_id',
  'instituto_id',
  'documento',
] as const

/**
 * 'titulo_pdf' NO está en CAMPOS_FICHA a propósito: el valor (el path en
 * Storage) lo inyecta el handler de guardar server-side tras verificar que el
 * archivo existe — lo que mande el browser en ese campo se ignora solo, porque
 * sanearCambios itera esta lista. El desktop sí lo recibe dentro de `cambios`.
 */
export const CAMPO_TITULO = 'titulo_pdf' as const

export type CampoFicha = (typeof CAMPOS_FICHA)[number]

/** Tope de largo por valor. La RPC DESCARTA lo que pase de 200; acá se recorta antes. */
export const MAX_LARGO_VALOR = 200

/** 'cedula' → últimos N dígitos del documento; 'codigo' → el código corto del mail. */
export type ModoFactor = 'cedula' | 'codigo'

/** Rótulos en español de cada campo, compartidos por el formulario y el acuse. */
export const LABELS_CAMPOS: Record<string, string> = {
  documento: 'Documento (cédula)',
  nombre: 'Nombre',
  apellido: 'Apellido',
  sexo: 'Sexo',
  fecha_nacimiento: 'Fecha de nacimiento',
  generacion: 'Generación',
  fecha_recibido: 'Fecha de recibido',
  telefono: 'Teléfono',
  celular: 'Celular',
  mail: 'Email',
  direccion: 'Dirección',
  localidad: 'Localidad',
  categoria_id: 'Categoría',
  forma_pago_id: 'Forma de pago',
  estado_registro_id: 'Estado',
  tipo_pago_id: 'Tipo de pago',
  instituto_id: 'Instituto',
  titulo_pdf: 'Título (PDF)',
}

// ── Configuración de campos (visible / obligatorio) ─────────────────────────

/**
 * Lo que el desktop configuró para el formulario (Ficha en la Web → Campos
 * del formulario), bajado en `ficha_catalogos_remoto.campos`. Un campo
 * ausente es visible y opcional — el default histórico. `titulo_pdf`
 * obligatorio exige subir el PDF (o que ya esté cargado).
 */
export interface CampoConfigFicha {
  visible: boolean
  obligatorio: boolean
}
export type CamposFicha = Partial<Record<string, CampoConfigFicha>>

/** La config de un campo, con el default cuando el desktop no dijo nada. */
export function configDe(campos: CamposFicha, campo: string): CampoConfigFicha {
  return campos[campo] ?? { visible: true, obligatorio: false }
}

// ── Formas que viajan entre server y client ─────────────────────────────────

export interface ItemCatalogo {
  id: string
  nombre: string
}

/** Catálogos elegibles de la empresa (ficha_catalogos_remoto). Vacío = no editable. */
export interface CatalogosFicha {
  categorias: ItemCatalogo[]
  formas_pago: ItemCatalogo[]
  estados_registro: ItemCatalogo[]
  tipos_pago: ItemCatalogo[]
  institutos: ItemCatalogo[]
}

/**
 * Snapshot de membresía + generación que viaja en la credencial: lo que
 * socios_datos remoto NO tiene. `''` = sin valor.
 */
export interface MembresiaFicha {
  categoria_id: string
  categoria_nombre: string
  forma_pago_id: string
  forma_pago_nombre: string
  estado_registro_id: string
  estado_registro_nombre: string
  tipo_pago_id: string
  tipo_pago_nombre: string
  instituto_id: string
  instituto_nombre: string
  generacion: string
  /** Fecha en que se recibió (ISO o ''). Sólo tiene sentido si titulo_aplica. */
  fecha_recibido: string
  /**
   * false = la categoría es de estudiante: ni "Fecha de recibido" ni la subida
   * del título se muestran (todavía no se recibió).
   */
  titulo_aplica: boolean
  /** true = el desktop ya guarda un título de esta persona (subir reemplaza). */
  titulo_cargado: boolean
}

/** Los datos personales actuales, leídos de socios_datos tras validar el factor. */
export interface FichaPersonal {
  documento: string
  nombre: string
  apellido: string
  sexo: string
  /** ISO date (YYYY-MM-DD) o ''. */
  fecha_nacimiento: string
  telefono: string
  celular: string
  mail: string
  direccion: string
  localidad: string
}

/** Respuesta de POST /api/ficha/[token]/validar. */
export interface FichaValidada {
  ok: true
  cedula_valida: boolean
  /**
   * false = no hay fila en socios_datos para este documento. El formulario se
   * muestra igual, con los personales vacíos: la asociación completa la ficha
   * al validar la propuesta.
   */
  ficha_encontrada: boolean
  ficha: FichaPersonal
  membresia: MembresiaFicha
  catalogos: CatalogosFicha
  /** Qué campos muestra y exige el formulario (configurado en el desktop). */
  campos: CamposFicha
  /** La propuesta pendiente sin bajar, si hay: { campo: valor_nuevo }. */
  cambios_pendientes: Partial<Record<CampoFicha, string>> | null
}

/** Respuesta de POST /api/ficha/[token]/guardar. */
export interface CambioRegistrado {
  ok: true
  id: string
}

/**
 * Error de las RPC (o del handler). `intentos_restantes` acompaña a
 * `factor_incorrecto`; `hasta` a `bloqueado`.
 */
export interface ErrorFicha {
  error: string
  intentos_restantes?: number
  hasta?: string
}

export function esError(r: { error?: unknown } | { ok?: unknown }): r is ErrorFicha {
  return typeof (r as { error?: unknown }).error === 'string'
}

// ── Normalizaciones compartidas client/server ───────────────────────────────

/**
 * Espacios, puntos y guiones afuera. Mismo criterio que `normalizeDocumento`
 * de lib/documento.ts, que no se puede importar acá porque arrastra
 * node:crypto al bundle del browser.
 */
export function limpiarDocumento(documento: string): string {
  return documento.replace(/[\s.\-]/g, '')
}

/**
 * El código del mail, tal como lo hashea el desktop: mayúsculas, sin espacios
 * ni guiones. A diferencia de votación acá NO hay RPC que normalice
 * (`_ficha_factor_ok` hashea el texto crudo), así que la promesa "podés
 * escribirlo con espacios o en minúsculas" se cumple en este lado.
 */
export function limpiarCodigo(codigo: string): string {
  return codigo.replace(/[\s\-]/g, '').toUpperCase()
}

// ── Mensajes ────────────────────────────────────────────────────────────────

export interface MensajeFicha {
  titulo: string
  detalle: string
  /** true = no tiene sentido reintentar desde donde estaba: se corta la pantalla. */
  terminal: boolean
}

/**
 * Traduce un error de las RPC al mensaje que ve la persona.
 *
 * Dos criterios heredados de votación/postulación:
 *
 *  · `credencial_inexistente` recibe EL MISMO texto que `factor_incorrecto`:
 *    quien tiene un link reenviado no distingue "token válido, factor mal" de
 *    "token inválido". El caso legítimo —link roto— ya se resolvió en la
 *    portada de `/f/`, antes de pedir el factor.
 *
 *  · `intentos_restantes === 0` se cuenta como bloqueo, no como "te quedan 0
 *    intentos": el intento que agotó el contador YA dejó la credencial
 *    bloqueada, y decir lo otro invita a gastar un toque más para descubrirlo.
 */
export function mensajeDeErrorFicha(r: ErrorFicha, modo: ModoFactor): MensajeFicha {
  switch (r.error) {
    case 'factor_incorrecto':
    case 'credencial_inexistente': {
      if (r.intentos_restantes === 0) {
        return {
          titulo: 'Demasiados intentos',
          detalle:
            'Por seguridad el acceso quedó bloqueado unos minutos. Esperá y volvé a abrir el link.',
          terminal: true,
        }
      }
      const quedan =
        typeof r.intentos_restantes === 'number'
          ? ` Te ${r.intentos_restantes === 1 ? 'queda' : 'quedan'} ${r.intentos_restantes} ${
              r.intentos_restantes === 1 ? 'intento' : 'intentos'
            }.`
          : ''
      return modo === 'cedula'
        ? {
            titulo: 'Los dígitos no coinciden',
            detalle: `Revisá los últimos dígitos de tu documento —contando el dígito verificador— y volvé a probar.${quedan}`,
            terminal: false,
          }
        : {
            titulo: 'El código no coincide',
            detalle: `Revisá que esté completo, tal como figura en el mail.${quedan}`,
            terminal: false,
          }
    }

    case 'bloqueado': {
      const hora = formatHoraUY(r.hasta)
      return {
        titulo: 'Demasiados intentos',
        detalle: hora
          ? `Por seguridad el acceso quedó bloqueado un rato. Probá de nuevo después de las ${hora}.`
          : 'Por seguridad el acceso quedó bloqueado un rato. Esperá unos minutos y volvé a probar.',
        terminal: true,
      }
    }

    case 'no_habilitado':
      return {
        titulo: 'Este link fue dado de baja',
        detalle:
          'Ya no permite editar la ficha. Si creés que es un error, comunicate con tu asociación.',
        terminal: true,
      }

    case 'sin_cambios':
      return {
        titulo: 'No hay cambios para enviar',
        detalle: 'Modificá al menos un campo antes de enviar.',
        terminal: false,
      }

    case 'documento_invalido':
      return {
        titulo: 'La cédula no es válida',
        detalle:
          'Revisá el número completo, con el dígito verificador y sin puntos ni guiones.',
        terminal: false,
      }

    case 'titulo_no_aplica':
      return {
        titulo: 'No hace falta subir título',
        detalle: 'Tu categoría no requiere título registrado. Enviá el resto de los cambios sin el archivo.',
        terminal: false,
      }

    case 'titulo_error':
      return {
        titulo: 'No pudimos preparar la subida del título',
        detalle: 'Volvé a probar en un momento. Los demás cambios no se enviaron todavía.',
        terminal: false,
      }

    case 'cambios_invalidos':
      return {
        titulo: 'No pudimos procesar los cambios',
        detalle: 'Alguno de los datos no tiene un formato válido. Revisá y volvé a probar.',
        terminal: false,
      }

    default:
      return {
        titulo: 'No se pudo completar',
        detalle: 'Volvé a probar en un momento.',
        terminal: false,
      }
  }
}
