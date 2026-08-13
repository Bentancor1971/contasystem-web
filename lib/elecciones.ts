/**
 * Acceso a las tres RPC de votación. SOLO server-side (service_role).
 *
 * ⚠️ No importar desde un Client Component: arrastra el cliente admin.
 *
 * Las funciones `buscar_credencial`, `validar_credencial` y `emitir_voto` son
 * SECURITY DEFINER y tienen EXECUTE revocado a PUBLIC/anon/authenticated: sólo
 * corren con la service key, desde acá. Ver docs/supabase/39_elecciones.sql.
 *
 * Toda la validación de verdad (segundo factor, ventana horaria contra el NOW()
 * de Postgres, min/max por papeleta) vive en la base. Este módulo no decide
 * nada: sólo tipa la respuesta y normaliza formas.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ErrorVotacion,
  IntegranteOpcion,
  OpcionPapeleta,
  Papeleta,
  RespuestaEmitir,
  RespuestaEstado,
  RespuestaValidar,
  SeleccionPapeleta,
  TipoPapeleta,
} from '@/lib/elecciones-types'

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
// El JSONB llega tal cual lo armó Postgres. Se normaliza acá para que ni la
// página ni el componente cliente tengan que defenderse de nulls y tipos.

const TIPOS: readonly TipoPapeleta[] = ['lista', 'cargo', 'pregunta', 'multiple']

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function entero(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : def
}

function integrantes(v: unknown): IntegranteOpcion[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ nombre: String(x.nombre ?? '').trim(), cargo: texto(x.cargo) }))
    .filter((x) => x.nombre !== '')
}

function opcion(v: Record<string, unknown>): OpcionPapeleta {
  return {
    id: String(v.id),
    numero: texto(v.numero),
    titulo: String(v.titulo ?? ''),
    lema: texto(v.lema),
    descripcion: texto(v.descripcion),
    imagen_url: texto(v.imagen_url),
    integrantes: integrantes(v.integrantes),
  }
}

function papeleta(v: Record<string, unknown>): Papeleta {
  const tipo = TIPOS.includes(v.tipo as TipoPapeleta) ? (v.tipo as TipoPapeleta) : 'cargo'
  const min = Math.max(0, entero(v.min_selecciones, 1))
  // `max` nunca puede quedar por debajo de `min`: si eso pasara, el control
  // quedaría deshabilitado antes de llegar al mínimo y la papeleta sería
  // imposible de completar desde la pantalla.
  const max = Math.max(min, entero(v.max_selecciones, 1))
  return {
    id: String(v.id),
    orden: entero(v.orden, 0),
    titulo: String(v.titulo ?? ''),
    descripcion: texto(v.descripcion),
    tipo,
    min_selecciones: min,
    max_selecciones: max,
    permite_blanco: v.permite_blanco !== false,
    obligatoria: v.obligatoria !== false,
    opciones: Array.isArray(v.opciones)
      ? v.opciones
          .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
          .map(opcion)
      : [],
  }
}

/**
 * Convierte `credencial_inexistente` en `digitos_incorrectos` antes de que la
 * respuesta salga a la red.
 *
 * Quien tiene un link reenviado y prueba dígitos no tiene que poder distinguir
 * "token válido, dígitos mal" de "token inválido": si pudiera, tendría un
 * oráculo para saber qué credenciales existen. El caso legítimo —el link está
 * roto— ya se resuelve en la portada de `/v/`, antes de pedir dígitos.
 *
 * Se aplica en `validar` y en `emitir`, nunca en la portada.
 */
export function ocultarInexistente<T>(r: T | ErrorVotacion): T | ErrorVotacion {
  if (
    r &&
    typeof r === 'object' &&
    'error' in r &&
    (r as ErrorVotacion).error === 'credencial_inexistente'
  ) {
    return { error: 'digitos_incorrectos' }
  }
  return r
}

// ── Paso 1 · abrir el link ──────────────────────────────────────────────────

export async function buscarCredencial(
  admin: SupabaseClient,
  token: string,
): Promise<RespuestaEstado> {
  const d = await llamar(admin, 'buscar_credencial', { p_token: token })
  if (d.ok !== true) return d as unknown as ErrorVotacion

  const e = (d.eleccion ?? {}) as Record<string, unknown>
  return {
    ok: true,
    eleccion: {
      id: String(e.id),
      nombre: String(e.nombre ?? ''),
      descripcion: texto(e.descripcion),
      instructivo: texto(e.instructivo),
      texto_antes: texto(e.texto_antes),
      texto_despues: texto(e.texto_despues),
      email_contacto: texto(e.email_contacto),
      imagen_url: texto(e.imagen_url),
      fecha_apertura: String(e.fecha_apertura ?? ''),
      fecha_cierre: String(e.fecha_cierre ?? ''),
      estado: e.estado === 'abierta' ? 'abierta' : 'cerrada',
    },
    verificacion_digitos: Math.max(0, entero(d.verificacion_digitos, 0)),
    habilitado: d.habilitado !== false,
    ya_voto: d.ya_voto === true,
    bloqueado: d.bloqueado === true,
    ventana:
      d.ventana === 'abierta' || d.ventana === 'no_abierta' ? d.ventana : 'cerrada',
  }
}

// ── Paso 2 · segundo factor → votante + boleta ──────────────────────────────

export async function validarCredencial(
  admin: SupabaseClient,
  token: string,
  digitos: string,
): Promise<RespuestaValidar> {
  const d = await llamar(admin, 'validar_credencial', {
    p_token: token,
    p_digitos: digitos,
  })
  if (d.ok !== true) return d as unknown as ErrorVotacion

  const papeletas = Array.isArray(d.papeletas)
    ? d.papeletas
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map(papeleta)
        .sort((a, b) => a.orden - b.orden)
    : []

  return { ok: true, votante: String(d.votante ?? ''), papeletas }
}

// ── Paso 3 · emitir ─────────────────────────────────────────────────────────

export async function emitirVoto(
  admin: SupabaseClient,
  token: string,
  digitos: string,
  selecciones: SeleccionPapeleta[],
): Promise<RespuestaEmitir> {
  const d = await llamar(admin, 'emitir_voto', {
    p_token: token,
    p_digitos: digitos,
    p_selecciones: selecciones,
  })
  if (d.ok !== true) return d as unknown as ErrorVotacion

  // Sin `emitido_at` no hay constancia que mostrar, y sin constancia no se le
  // dice a nadie que votó. Ante la duda se trata como fallo.
  const emitido = typeof d.emitido_at === 'string' ? d.emitido_at : ''
  if (!emitido) throw new ErrorRpc('emitir_voto: ok sin emitido_at')

  return { ok: true, voto_id: String(d.voto_id ?? ''), emitido_at: emitido }
}
