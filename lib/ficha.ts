/**
 * Acceso a las tres RPC de la ficha web + la lectura de socios_datos.
 * SOLO server-side (service_role).
 *
 * ⚠️ No importar desde un Client Component: arrastra el cliente admin.
 *
 * `buscar_credencial_ficha`, `validar_credencial_ficha` y
 * `registrar_ficha_cambio` son SECURITY DEFINER con EXECUTE revocado a
 * PUBLIC/anon/authenticated: sólo corren con la service key, desde acá.
 * Ver docs/supabase/66_ficha_web.sql del repo desktop.
 *
 * Toda la validación de verdad —segundo factor, bloqueo por intentos, lista
 * blanca de campos— vive en la base. Este módulo no decide nada: tipa la
 * respuesta y normaliza formas.
 *
 * Los datos PERSONALES no salen de las RPC: tras validar el factor, el server
 * los lee de socios_datos por `documento` en claro, con el mismo scope de
 * `empresa_padron_remoto` que usan los eventos (ver `buscarSocioEnPadron` en
 * lib/eventos.ts — es deliberadamente la MISMA búsqueda, no una copia).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarSocioEnPadron } from '@/lib/eventos'
import { normalizeDocumento } from '@/lib/documento'
import {
  CAMPOS_FICHA,
  type CampoFicha,
  type CatalogosFicha,
  type ErrorFicha,
  type FichaPersonal,
  type ItemCatalogo,
  type MembresiaFicha,
  type ModoFactor,
} from '@/lib/ficha-types'

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

function textoO(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v.trim() : String(v).trim()
}

function entero(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : def
}

function items(v: unknown): ItemCatalogo[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
    .filter((x): x is Record<string, unknown> => x !== null)
    .map((x) => ({ id: textoO(x.id), nombre: textoO(x.nombre) }))
    .filter((x) => x.id !== '' && x.nombre !== '')
}

function catalogos(v: unknown): CatalogosFicha {
  const c = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    categorias: items(c.categorias),
    formas_pago: items(c.formas_pago),
    estados_registro: items(c.estados_registro),
    tipos_pago: items(c.tipos_pago),
    institutos: items(c.institutos),
  }
}

function membresia(v: unknown): MembresiaFicha {
  const m = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    categoria_id: textoO(m.categoria_id),
    categoria_nombre: textoO(m.categoria_nombre),
    forma_pago_id: textoO(m.forma_pago_id),
    forma_pago_nombre: textoO(m.forma_pago_nombre),
    estado_registro_id: textoO(m.estado_registro_id),
    estado_registro_nombre: textoO(m.estado_registro_nombre),
    tipo_pago_id: textoO(m.tipo_pago_id),
    tipo_pago_nombre: textoO(m.tipo_pago_nombre),
    instituto_id: textoO(m.instituto_id),
    instituto_nombre: textoO(m.instituto_nombre),
    generacion: textoO(m.generacion),
    fecha_recibido: textoO(m.fecha_recibido),
    // Ante un snapshot viejo (sin el campo) se asume que NO aplica: un push
    // desactualizado no puede hacer aparecer la subida de títulos.
    titulo_aplica: m.titulo_aplica === true,
    titulo_cargado: m.titulo_cargado === true,
  }
}

/** La propuesta pendiente, filtrada a la lista blanca. Nada más baja al cliente. */
function cambiosPendientes(v: unknown): Partial<Record<CampoFicha, string>> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Partial<Record<CampoFicha, string>> = {}
  for (const campo of CAMPOS_FICHA) {
    const valor = (v as Record<string, unknown>)[campo]
    if (typeof valor === 'string' && valor.trim() !== '') out[campo] = valor.trim()
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Convierte `credencial_inexistente` en `factor_incorrecto` antes de que la
 * respuesta salga a la red: quien prueba factores con un link reenviado no
 * tiene que poder distinguir "token válido, factor mal" de "token inválido".
 * Se aplica en validar y guardar. Nunca en la portada.
 */
export function ocultarInexistente<T>(r: T | ErrorFicha): T | ErrorFicha {
  if (
    r &&
    typeof r === 'object' &&
    'error' in r &&
    (r as ErrorFicha).error === 'credencial_inexistente'
  ) {
    return { error: 'factor_incorrecto' }
  }
  return r
}

// ── Paso 1 · abrir el link ──────────────────────────────────────────────────

export interface CredencialFicha {
  ok: true
  empresa_id: string
  nombre_visible: string
  modo_factor: ModoFactor
  verificacion_digitos: number
  habilitado: boolean
  bloqueado: boolean
  cambio_pendiente: boolean
}

export async function buscarCredencialFicha(
  admin: SupabaseClient,
  token: string,
): Promise<CredencialFicha | ErrorFicha> {
  const d = await llamar(admin, 'buscar_credencial_ficha', { p_token: token })
  if (d.ok !== true) return d as unknown as ErrorFicha
  return {
    ok: true,
    empresa_id: textoO(d.empresa_id),
    nombre_visible: textoO(d.nombre_visible),
    // Ante un valor raro se asume 'cedula': pedir dígitos de más nunca abre
    // nada que no corresponda, y el hash igual no coincidiría.
    modo_factor: d.modo_factor === 'codigo' ? 'codigo' : 'cedula',
    verificacion_digitos: Math.min(Math.max(entero(d.verificacion_digitos, 4), 1), 12),
    habilitado: d.habilitado === true,
    bloqueado: d.bloqueado === true,
    cambio_pendiente: d.cambio_pendiente === true,
  }
}

// ── Paso 2 · validar el factor ──────────────────────────────────────────────

export interface FichaValidadaServer {
  ok: true
  empresa_id: string
  /** El documento EN CLARO: la llave para leer socios_datos. */
  documento: string
  cedula_valida: boolean
  membresia: MembresiaFicha
  catalogos: CatalogosFicha
  cambios_pendientes: Partial<Record<CampoFicha, string>> | null
}

export async function validarCredencialFicha(
  admin: SupabaseClient,
  token: string,
  factor: string,
): Promise<FichaValidadaServer | ErrorFicha> {
  const d = await llamar(admin, 'validar_credencial_ficha', {
    p_token: token,
    p_factor: factor,
  })
  if (d.ok !== true) return d as unknown as ErrorFicha
  return {
    ok: true,
    empresa_id: textoO(d.empresa_id),
    documento: textoO(d.documento),
    cedula_valida: d.cedula_valida === true,
    membresia: membresia(d.membresia),
    catalogos: catalogos(d.catalogos),
    cambios_pendientes: cambiosPendientes(d.cambios_pendientes),
  }
}

// ── Los datos personales, desde socios_datos ────────────────────────────────

/**
 * Lee la ficha personal por documento en claro, con el scope del padrón
 * (empresa_padron_remoto) — exactamente la búsqueda de `resolverParticipante`,
 * compartida vía `buscarSocioEnPadron`.
 *
 * `encontrada: false` NO corta el flujo: el formulario se muestra vacío y la
 * asociación completa la ficha al validar la propuesta.
 */
export async function leerFichaPersonal(
  admin: SupabaseClient,
  empresaId: string,
  documento: string,
): Promise<{ encontrada: boolean; ficha: FichaPersonal }> {
  const doc = normalizeDocumento(documento)
  const vacia: FichaPersonal = {
    documento,
    nombre: '',
    apellido: '',
    sexo: '',
    fecha_nacimiento: '',
    telefono: '',
    celular: '',
    mail: '',
    direccion: '',
    localidad: '',
  }
  // Sin documento no se busca: `eq('documento', '')` podría matchear filas
  // basura del padrón, y esta llave viene de la credencial, no de la persona.
  if (!doc) return { encontrada: false, ficha: vacia }

  const socio = await buscarSocioEnPadron(
    admin,
    empresaId,
    doc,
    'nombre, apellido, sexo, fecha_nacimiento, telefono, celular, mail, direccion, localidad',
  )
  if (!socio) return { encontrada: false, ficha: vacia }

  // `fecha_nacimiento` es TEXT en socios_datos (ISO, igual que SQLite local):
  // se recorta a YYYY-MM-DD para el <input type="date">, y cualquier cosa que
  // no empiece como fecha ISO se muestra vacía en vez de romper el input.
  const fechaCruda = textoO(socio.fecha_nacimiento)
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(fechaCruda) ? fechaCruda.slice(0, 10) : ''

  return {
    encontrada: true,
    ficha: {
      documento,
      nombre: textoO(socio.nombre),
      apellido: textoO(socio.apellido),
      sexo: textoO(socio.sexo),
      fecha_nacimiento: fecha,
      telefono: textoO(socio.telefono),
      celular: textoO(socio.celular),
      mail: textoO(socio.mail),
      direccion: textoO(socio.direccion),
      localidad: textoO(socio.localidad),
    },
  }
}

// ── El título en PDF (Storage) ──────────────────────────────────────────────

const BUCKET_TITULOS = 'titulos'

/**
 * Path canónico del título de una credencial. Lo arma SIEMPRE el server —
 * nunca se acepta un path del browser—: así el desktop puede confiar en que
 * `cambios.titulo_pdf` apunta dentro de la empresa correcta.
 */
export function pathTitulo(empresaId: string, token: string): string {
  return `${empresaId}/${token}.pdf`
}

/**
 * Emite un signed upload URL para que el browser suba el PDF DIRECTO a
 * Storage: el archivo no pasa por Vercel (límite de body de 4.5 MB) y el
 * bucket mismo impone 10 MB y application/pdf. Se borra el objeto anterior
 * antes porque un signed upload no pisa un objeto existente.
 *
 * El archivo recién "cuenta" cuando `registrar_ficha_cambio` lo encuentra en
 * Storage e inyecta cambios.titulo_pdf — la verificación vive en la RPC, no acá.
 */
export async function crearSubidaTitulo(
  admin: SupabaseClient,
  empresaId: string,
  token: string,
): Promise<{ upload_url: string } | ErrorFicha> {
  const path = pathTitulo(empresaId, token)
  await admin.storage.from(BUCKET_TITULOS).remove([path]).catch(() => undefined)
  const { data, error } = await admin.storage.from(BUCKET_TITULOS).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) {
    console.error('[ficha] crearSubidaTitulo:', error?.message)
    return { error: 'titulo_error' }
  }
  return { upload_url: data.signedUrl }
}

// ── Paso 3 · registrar la propuesta ─────────────────────────────────────────

export async function registrarFichaCambio(
  admin: SupabaseClient,
  token: string,
  factor: string,
  cambios: Record<string, string>,
): Promise<{ ok: true; id: string } | ErrorFicha> {
  const d = await llamar(admin, 'registrar_ficha_cambio', {
    p_token: token,
    p_factor: factor,
    p_cambios: cambios,
  })
  if (d.ok !== true) return d as unknown as ErrorFicha
  return { ok: true, id: textoO(d.id) }
}
