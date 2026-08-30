/**
 * Acceso a las RPC de la mesa del local. SOLO server-side (service_role).
 *
 * ⚠️ No importar desde un Client Component: arrastra el cliente admin.
 *
 * Todas las funciones de `47_mesa_presencial.sql` y `51_mesa_boleta.sql` son
 * SECURITY DEFINER con EXECUTE revocado a PUBLIC/anon/authenticated: sólo corren
 * con la service key, desde acá. El browser nunca habla con Supabase.
 *
 * Este módulo no decide nada: la sesión, el bloqueo por intentos, quién puede
 * cerrar la urna y la carrera entre dos mesas que marcan a la misma persona se
 * resuelven en Postgres. Acá sólo se tipa la respuesta y se normalizan formas.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ControlMesa,
  ErrorMesa,
  FilaRecuento,
  PapeletaMesa,
  PersonaPadron,
  RespuestaBoleta,
  RespuestaControl,
  RespuestaLogin,
  RespuestaMarca,
  RespuestaPadronRpc,
} from '@/lib/mesa-types'

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

function persona(v: Record<string, unknown>): PersonaPadron {
  return {
    habilitado_id: String(v.habilitado_id),
    documento: texto(v.documento),
    nombre_completo: String(v.nombre_completo ?? ''),
    categoria: texto(v.categoria),
    estado_registro: texto(v.estado_registro),
    habilitado: v.habilitado !== false,
    motivo_inhabilitacion: texto(v.motivo_inhabilitacion),
    voto_emitido_at: texto(v.voto_emitido_at),
    voto_origen: texto(v.voto_origen),
    mesa_id: texto(v.mesa_id),
    row_updated_at: String(v.row_updated_at ?? ''),
  }
}

function papeleta(v: Record<string, unknown>): PapeletaMesa {
  return {
    id: String(v.id),
    orden: entero(v.orden, 0),
    titulo: String(v.titulo ?? ''),
    tipo: String(v.tipo ?? 'cargo'),
    permite_blanco: v.permite_blanco !== false,
    opciones: Array.isArray(v.opciones)
      ? v.opciones
          .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
          .map((o) => ({
            id: String(o.id),
            numero: texto(o.numero),
            titulo: String(o.titulo ?? ''),
            lema: texto(o.lema),
          }))
      : [],
  }
}

function control(d: Record<string, unknown>): ControlMesa {
  const sobres = d.sobres_en_urna
  return {
    ok: true,
    mesa: String(d.mesa ?? ''),
    marcas: entero(d.marcas, 0),
    sobres_en_urna: sobres === null || sobres === undefined ? null : entero(sobres, 0),
    recuento: entero(d.recuento, 0),
    cerrada_at: texto(d.cerrada_at),
    recuento_cargado_at: texto(d.recuento_cargado_at),
    difiere: d.difiere === true,
  }
}

// ── Entrar ──────────────────────────────────────────────────────────────────

/**
 * Devuelve la sesión aparte del resto: el UUID va a una cookie httpOnly y no
 * tiene por qué pasar por ningún componente. Separarlo en el tipo es lo que
 * hace difícil mandarlo al browser por descuido.
 */
export async function mesaLogin(
  admin: SupabaseClient,
  codigo: string,
  pin: string,
): Promise<{ sesion: string; datos: RespuestaLogin } | { sesion: null; datos: ErrorMesa }> {
  const d = await llamar(admin, 'mesa_login', { p_codigo: codigo, p_pin: pin })
  if (d.ok !== true) return { sesion: null, datos: d as unknown as ErrorMesa }

  const sesion = typeof d.sesion === 'string' ? d.sesion : ''
  // Sin sesión no hay nada que guardar en la cookie, y el resto de las
  // pantallas no funcionaría. Se trata como fallo antes de dejar entrar.
  if (!sesion) throw new ErrorRpc('mesa_login: ok sin sesion')

  const m = (d.mesa ?? {}) as Record<string, unknown>
  const e = (d.eleccion ?? {}) as Record<string, unknown>

  return {
    sesion,
    datos: {
      ok: true,
      es_presidente: d.es_presidente === true,
      mesa: {
        id: String(m.id ?? ''),
        nombre: String(m.nombre ?? ''),
        sede: texto(m.sede),
        tramo_desde: texto(m.tramo_desde),
        tramo_hasta: texto(m.tramo_hasta),
      },
      eleccion: {
        id: String(e.id ?? ''),
        nombre: String(e.nombre ?? ''),
        estado: String(e.estado ?? ''),
        fecha_apertura: String(e.fecha_apertura ?? ''),
        fecha_cierre: String(e.fecha_cierre ?? ''),
        instructivo: texto(e.instructivo),
      },
    },
  }
}

// ── El padrón, completo o por delta ─────────────────────────────────────────

/**
 * `desde` es el `hasta` de la respuesta anterior, que sale del reloj del
 * SERVIDOR. No usar el del dispositivo: uno atrasado se perdería cambios para
 * siempre.
 */
export async function mesaPadron(
  admin: SupabaseClient,
  sesion: string,
  desde?: string | null,
): Promise<RespuestaPadronRpc> {
  const d = await llamar(admin, 'mesa_padron', { p_sesion: sesion, p_desde: desde ?? null })
  if (d.ok !== true) return d as unknown as ErrorMesa

  return {
    ok: true,
    hasta: String(d.hasta ?? ''),
    completo: d.completo === true,
    padron: Array.isArray(d.padron)
      ? d.padron
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map(persona)
      : [],
    // Desde 61_. Sin ese script la clave no viene y queda `false`, que es el
    // valor seguro: no mostrar el banner es preferible a mostrarlo mal.
    canal_web_abierto: d.canal_web_abierto === true,
  }
}

// ── Marcar y desmarcar ──────────────────────────────────────────────────────

export async function mesaMarcarVoto(
  admin: SupabaseClient,
  sesion: string,
  habilitadoId: string,
): Promise<RespuestaMarca> {
  const d = await llamar(admin, 'mesa_marcar_voto', {
    p_sesion: sesion,
    p_habilitado_id: habilitadoId,
  })
  if (d.ok !== true) return d as unknown as ErrorMesa

  const emitido = texto(d.emitido_at)
  // Sin `emitido_at` no hay marca que mostrar. Ante la duda se trata como fallo:
  // una fila que queda marcada en pantalla sin estarlo en la base hace que la
  // persona se vaya sin votar y nadie se entere hasta el escrutinio.
  if (!emitido) throw new ErrorRpc('mesa_marcar_voto: ok sin emitido_at')

  return {
    ok: true,
    habilitado_id: String(d.habilitado_id ?? habilitadoId),
    emitido_at: emitido,
    // Desde 61_: aviso, no error. Sin ese script la clave no viene.
    ...(d.advertencia === 'canal_web_abierto' ? { advertencia: 'canal_web_abierto' as const } : {}),
  }
}

export async function mesaDesmarcarVoto(
  admin: SupabaseClient,
  sesion: string,
  habilitadoId: string,
  motivo: string,
): Promise<{ ok: true } | ErrorMesa> {
  const d = await llamar(admin, 'mesa_desmarcar_voto', {
    p_sesion: sesion,
    p_habilitado_id: habilitadoId,
    p_motivo: motivo,
  })
  if (d.ok !== true) return d as unknown as ErrorMesa
  return { ok: true }
}

// ── Recuento, control y cierre ──────────────────────────────────────────────

export async function mesaBoleta(
  admin: SupabaseClient,
  sesion: string,
): Promise<RespuestaBoleta> {
  const d = await llamar(admin, 'mesa_boleta', { p_sesion: sesion })
  if (d.ok !== true) return d as unknown as ErrorMesa

  return {
    ok: true,
    papeletas: Array.isArray(d.papeletas)
      ? d.papeletas
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map(papeleta)
          .sort((a, b) => a.orden - b.orden)
      : [],
  }
}

/**
 * Lo que esta mesa ya guardó, en el mismo formato que espera `mesa_recuento_
 * guardar`. Existe para que recargar la pantalla no muestre la grilla en cero:
 * el guardado es un set atómico y guardar ceros borraría lo contado.
 */
export async function mesaRecuentoActual(
  admin: SupabaseClient,
  sesion: string,
): Promise<{ ok: true; cargado_at: string | null; filas: FilaRecuento[] } | ErrorMesa> {
  const d = await llamar(admin, 'mesa_recuento_actual', { p_sesion: sesion })
  if (d.ok !== true) return d as unknown as ErrorMesa

  return {
    ok: true,
    cargado_at: texto(d.cargado_at),
    filas: Array.isArray(d.filas)
      ? d.filas
          .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
          .map((f) => ({
            papeleta_id: String(f.papeleta_id),
            opcion_id: texto(f.opcion_id),
            es_blanco: f.es_blanco === true,
            es_anulado: f.es_anulado === true,
            cantidad: entero(f.cantidad, 0),
          }))
      : [],
  }
}

export async function mesaRecuentoGuardar(
  admin: SupabaseClient,
  sesion: string,
  filas: FilaRecuento[],
): Promise<{ ok: true; filas: number } | ErrorMesa> {
  const d = await llamar(admin, 'mesa_recuento_guardar', { p_sesion: sesion, p_rows: filas })
  if (d.ok !== true) return d as unknown as ErrorMesa
  return { ok: true, filas: entero(d.filas, 0) }
}

export async function mesaControl(
  admin: SupabaseClient,
  sesion: string,
): Promise<RespuestaControl> {
  const d = await llamar(admin, 'mesa_control', { p_sesion: sesion })
  if (d.ok !== true) return d as unknown as ErrorMesa
  return control(d)
}

export async function mesaCerrar(
  admin: SupabaseClient,
  sesion: string,
  sobresEnUrna: number,
  observacion: string | null,
): Promise<{ ok: true; marcas: number; sobres: number } | ErrorMesa> {
  const d = await llamar(admin, 'mesa_cerrar', {
    p_sesion: sesion,
    p_sobres_en_urna: sobresEnUrna,
    p_observacion: observacion,
  })
  if (d.ok !== true) return d as unknown as ErrorMesa
  return { ok: true, marcas: entero(d.marcas, 0), sobres: entero(d.sobres, sobresEnUrna) }
}
