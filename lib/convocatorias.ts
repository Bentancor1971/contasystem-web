/**
 * Acceso a las cuatro RPC de convocatorias. SOLO server-side (service_role).
 *
 * ⚠️ No importar desde un Client Component: arrastra el cliente admin.
 *
 * `buscar_convocatoria`, `validar_invitado`, `registrar_postulacion` y
 * `retirar_postulacion` son SECURITY DEFINER y tienen EXECUTE revocado a
 * PUBLIC/anon/authenticated: sólo corren con la service key, desde acá.
 * Ver docs/supabase/50_convocatorias.sql del repo desktop.
 *
 * Toda la validación de verdad —segundo factor, ventana horaria contra el NOW()
 * de Postgres, bloqueo por deuda— vive en la base. Este módulo no decide nada:
 * sólo tipa la respuesta y normaliza formas.
 *
 * En particular **no calcula nada sobre la deuda**: `puede_postularse` y
 * `advertido` llegan ya resueltos por el desktop con la política aplicada.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DatosPostulacion,
  ErrorPostulacion,
  EstadoLlamado,
  PoliticaDeuda,
  RespuestaEstadoConv,
  RespuestaRegistrar,
  RespuestaRetirar,
  RespuestaValidarInvitado,
  VentanaConvocatoria,
} from '@/lib/convocatorias-types'

/** Si la RPC misma falla (red, SQL), no hay respuesta que interpretar. */
class ErrorRpc extends Error {}

async function llamar(
  admin: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new ErrorRpc(`${fn}: ${error.message}`)
  if (!data || typeof data !== 'object') throw new ErrorRpc(`${fn}: respuesta vacía`)
  return data as Record<string, unknown>
}

// ── Normalizadores ──────────────────────────────────────────────────────────

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function entero(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : def
}

/** `importe_adeudado` es NUMERIC: puede llegar como número o como string. */
function numero(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Cualquier valor desconocido cae en `cerrada`, que es el más restrictivo. */
function ventana(v: unknown): VentanaConvocatoria {
  return v === 'abierta' || v === 'no_abierta' ? v : 'cerrada'
}

/**
 * El estado sólo elige palabras —quién puede anotarse lo sigue decidiendo
 * `ventana`—, pero un valor desconocido cae igual en `cerrada`: si la nube
 * mandara algún día un estado que esta versión de la web no conoce, el peor
 * error posible sería contarlo como abierto.
 *
 * Los cuatro tienen que estar. Con el par `'abierta' | 'cerrada'` que había
 * antes de `52_`, `resuelta` y `anulada` se aplastaban contra `cerrada` acá, y
 * las ramas que `cierreDelLlamado` tiene para ellos nunca se alcanzaban: un
 * llamado anulado seguía diciendo "el plazo cerró el …".
 */
const ESTADOS_LLAMADO: readonly EstadoLlamado[] = ['abierta', 'cerrada', 'resuelta', 'anulada']
function estadoLlamado(v: unknown): EstadoLlamado {
  return ESTADOS_LLAMADO.includes(v as EstadoLlamado) ? (v as EstadoLlamado) : 'cerrada'
}

function politica(v: unknown): PoliticaDeuda {
  return v === 'advertir' || v === 'bloquear' ? v : 'informar'
}

/**
 * Convierte `credencial_inexistente` en `digitos_incorrectos` antes de que la
 * respuesta salga a la red: quien prueba dígitos con un link reenviado no tiene
 * que poder distinguir "token válido, dígitos mal" de "token inválido".
 *
 * Se aplica en validar, registrar y retirar. Nunca en la portada.
 */
export function ocultarInexistente<T>(r: T | ErrorPostulacion): T | ErrorPostulacion {
  if (
    r &&
    typeof r === 'object' &&
    'error' in r &&
    (r as ErrorPostulacion).error === 'credencial_inexistente'
  ) {
    return { error: 'digitos_incorrectos' }
  }
  return r
}

// ── Paso 1 · abrir el link ──────────────────────────────────────────────────

export async function buscarConvocatoria(
  admin: SupabaseClient,
  token: string,
): Promise<RespuestaEstadoConv> {
  const d = await llamar(admin, 'buscar_convocatoria', { p_token: token })
  if (d.ok !== true) return d as unknown as ErrorPostulacion

  const c = (d.convocatoria ?? {}) as Record<string, unknown>
  return {
    ok: true,
    convocatoria: {
      id: String(c.id),
      nombre: String(c.nombre ?? ''),
      descripcion: texto(c.descripcion),
      cargos_descripcion: texto(c.cargos_descripcion),
      instructivo: texto(c.instructivo),
      texto_antes: texto(c.texto_antes),
      texto_despues: texto(c.texto_despues),
      email_contacto: texto(c.email_contacto),
      imagen_url: texto(c.imagen_url),
      fecha_apertura: String(c.fecha_apertura ?? ''),
      fecha_cierre: String(c.fecha_cierre ?? ''),
      estado: estadoLlamado(c.estado),
    },
    verificacion_digitos: Math.max(0, entero(d.verificacion_digitos, 0)),
    ya_postulado: d.ya_postulado === true,
    bloqueado: d.bloqueado === true,
    ventana: ventana(d.ventana),
  }
}

// ── Paso 2 · segundo factor → nombre y situación ────────────────────────────

export async function validarInvitado(
  admin: SupabaseClient,
  token: string,
  digitos: string,
): Promise<RespuestaValidarInvitado> {
  const d = await llamar(admin, 'validar_invitado', {
    p_token: token,
    p_digitos: digitos,
  })
  if (d.ok !== true) return d as unknown as ErrorPostulacion

  return {
    ok: true,
    nombre: String(d.nombre ?? ''),
    // Ante un valor raro se asume que NO puede: la RPC vuelve a decidirlo al
    // registrar, así que equivocarse para el lado restrictivo no deja a nadie
    // afuera de verdad, y para el otro lado mostraría un formulario que rebota.
    puede_postularse: d.puede_postularse === true,
    advertido: d.advertido === true,
    motivo: texto(d.motivo),
    politica_deuda: politica(d.politica_deuda),
    fecha_limite_regularizacion: texto(d.fecha_limite_regularizacion),
    cuotas_pendientes: Math.max(0, entero(d.cuotas_pendientes, 0)),
    importe_adeudado: numero(d.importe_adeudado),
    deuda_actualizada_at: texto(d.deuda_actualizada_at),
  }
}

// ── Paso 3 · anotarse ───────────────────────────────────────────────────────

export async function registrarPostulacion(
  admin: SupabaseClient,
  token: string,
  digitos: string,
  datos: DatosPostulacion,
): Promise<RespuestaRegistrar> {
  const d = await llamar(admin, 'registrar_postulacion', {
    p_token: token,
    p_digitos: digitos,
    p_datos: datos,
  })
  if (d.ok !== true) return d as unknown as ErrorPostulacion

  // Sin `recibida_at` no hay constancia que mostrar, y sin constancia no se le
  // dice a nadie que quedó anotado. Ante la duda se trata como fallo.
  const recibida = typeof d.recibida_at === 'string' ? d.recibida_at : ''
  if (!recibida) throw new ErrorRpc('registrar_postulacion: ok sin recibida_at')

  return {
    ok: true,
    postulacion_id: String(d.postulacion_id ?? ''),
    recibida_at: recibida,
  }
}

// ── Darse de baja ───────────────────────────────────────────────────────────

/**
 * Es lo que hace distinta a una postulación de un voto: se puede deshacer,
 * porque no altera ningún resultado. Sólo mientras el desktop no la haya bajado.
 */
export async function retirarPostulacion(
  admin: SupabaseClient,
  token: string,
  digitos: string,
): Promise<RespuestaRetirar> {
  const d = await llamar(admin, 'retirar_postulacion', {
    p_token: token,
    p_digitos: digitos,
  })
  if (d.ok !== true) return d as unknown as ErrorPostulacion
  return { ok: true }
}
