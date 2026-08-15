/**
 * Terminal de mesa: la llave, la sesión del dispositivo y el pase del votante.
 * SOLO server-side.
 *
 * ⚠️ No importar desde un Client Component: firma con un secreto del servidor y
 * arrastra el cliente admin.
 *
 * Tres piezas, y cada una resuelve una cosa distinta:
 *
 *  1. **La llave** (`abrir_kiosco`) — la genera el desktop, la tipea el operador
 *     UNA vez al montar la tablet y el votante no la ve nunca. Sin llave la
 *     terminal se declararía sola con un parámetro en la URL, y entonces 200
 *     votos legítimos desde la IP del club serían indistinguibles de alguien
 *     probando códigos: el tope por IP trancaría la mesa a mitad del acto.
 *
 *  2. **La sesión** — una cookie httpOnly FIRMADA con `{ eleccion_id, terminal,
 *     huella }`. Firmada y no sólo httpOnly porque esta cookie compra algo: que
 *     el tope se cuente por terminal en vez de por IP. Una cookie que el cliente
 *     pudiera escribir sería exactamente el parámetro en la URL que la llave
 *     vino a evitar. La llave NO va adentro; va su huella, que es lo único que
 *     permite darse cuenta después de que el desktop la regeneró.
 *
 *  3. **El pase** — un sobre firmado y corto que ata el token de un votante a
 *     ESTA terminal y a ESTA elección. Se emite al canjear el código y viaja en
 *     memoria del browser hasta que la persona emite o se va. Evita que
 *     `validar` y `emitir` tengan que volver a preguntarle a la base de qué
 *     elección era el token en cada llamada, y hace imposible mandar a esta
 *     terminal un token que ella misma no canjeó.
 *
 * Contrato: docs/supabase/46_voto_kiosco.sql del repo desktop.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatosTerminal, ErrorKiosco } from '@/lib/kiosco-types'

export const COOKIE_KIOSCO = 'kiosco_sesion'

/** La sesión de la tablet dura una jornada electoral y no más. */
const HORAS_SESION = 12

/**
 * El pase de un votante. Generoso para quien lee la boleta despacio —el timeout
 * de inactividad de 90 segundos corta mucho antes— y corto igual: es un permiso
 * para emitir un voto puntual, no una credencial.
 */
const MINUTOS_PASE = 20

// ── Firma ───────────────────────────────────────────────────────────────────

/**
 * El secreto con el que se firman la cookie y el pase.
 *
 * Se DERIVA de la service key en vez de pedir una variable de entorno nueva, y
 * es a propósito: una terminal que no se puede montar porque falta configurar
 * algo en Vercel es una terminal que no existe la noche del acto. `KIOSCO_
 * COOKIE_SECRET` está por si alguna vez se quiere rotar sin tocar la service
 * key; mientras no exista, esto funciona solo.
 *
 * Rotar cualquiera de las dos invalida las sesiones abiertas: la tablet pide la
 * llave de nuevo, que es lo correcto.
 */
function secreto(): Buffer {
  const propio = process.env.KIOSCO_COOKIE_SECRET
  if (propio && propio.length >= 16) return Buffer.from(propio, 'utf8')

  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!service) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY no configurada · la terminal de mesa no puede firmar su sesión',
    )
  }
  return createHmac('sha256', service).update('kiosco-cookie-v1').digest()
}

/** `payload.firma`, las dos partes en base64url. */
function firmar(payload: object, ttlMs: number): string {
  const cuerpo = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }), 'utf8')
  const firma = createHmac('sha256', secreto()).update(cuerpo).digest()
  return `${cuerpo.toString('base64url')}.${firma.toString('base64url')}`
}

/** Devuelve el contenido si la firma cierra y no venció. `null` en todo lo demás. */
function abrir<T>(sobre: unknown): T | null {
  if (typeof sobre !== 'string' || sobre === '') return null
  const [c, f] = sobre.split('.')
  if (!c || !f) return null

  let cuerpo: Buffer
  let firma: Buffer
  try {
    cuerpo = Buffer.from(c, 'base64url')
    firma = Buffer.from(f, 'base64url')
  } catch {
    return null
  }

  const esperada = createHmac('sha256', secreto()).update(cuerpo).digest()
  // `timingSafeEqual` exige el mismo largo: comparar antes evita la excepción.
  if (firma.length !== esperada.length || !timingSafeEqual(firma, esperada)) return null

  let d: unknown
  try {
    d = JSON.parse(cuerpo.toString('utf8'))
  } catch {
    return null
  }
  if (!d || typeof d !== 'object') return null
  const exp = (d as { exp?: unknown }).exp
  if (typeof exp !== 'number' || Date.now() > exp) return null
  return d as T
}

/**
 * Huella de la llave con la que se montó esta terminal.
 *
 * La llave NO se guarda en ningún lado del dispositivo, así que sin esto no
 * habría forma de notar que el desktop la regeneró: la sesión seguiría viva con
 * una llave que ya no existe. Con la huella, cada llamada la compara contra la
 * que hay arriba y la terminal se cae sola.
 */
function huellaDe(llave: string): string {
  return createHmac('sha256', secreto())
    .update(`llave:${llave}`)
    .digest('base64url')
    .slice(0, 32)
}

// ── La sesión, en cookie ────────────────────────────────────────────────────

export interface SesionKiosco {
  eleccion_id: string
  /** Nombre de la terminal. Es lo que viaja al voto y de ahí al acta. */
  terminal: string
  /** Nombre de la elección, para dibujar la pantalla sin una consulta extra. */
  eleccion: string
  abierta_at: string
  huella: string
}

function opciones() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: HORAS_SESION * 60 * 60,
  }
}

/** La sesión de la tablet, o `null`. Todo lo de `/api/votacion/mesa` empieza acá. */
export async function leerSesionKiosco(): Promise<SesionKiosco | null> {
  const c = await cookies()
  const d = abrir<Partial<SesionKiosco>>(c.get(COOKIE_KIOSCO)?.value)
  if (!d) return null
  if (
    typeof d.eleccion_id !== 'string' || d.eleccion_id === '' ||
    typeof d.terminal !== 'string' || d.terminal === '' ||
    typeof d.huella !== 'string' || d.huella === ''
  ) {
    return null
  }
  return {
    eleccion_id: d.eleccion_id,
    terminal: d.terminal,
    eleccion: typeof d.eleccion === 'string' ? d.eleccion : '',
    abierta_at: typeof d.abierta_at === 'string' ? d.abierta_at : '',
    huella: d.huella,
  }
}

/** Sólo desde un route handler: un Server Component no puede escribir cookies. */
export async function guardarSesionKiosco(
  datos: DatosTerminal,
  terminal: string,
  llave: string,
): Promise<void> {
  const sesion: SesionKiosco = {
    eleccion_id: datos.eleccion_id,
    terminal,
    eleccion: datos.nombre,
    abierta_at: new Date().toISOString(),
    huella: huellaDe(llave),
  }
  const c = await cookies()
  c.set(COOKIE_KIOSCO, firmar(sesion, HORAS_SESION * 60 * 60 * 1000), opciones())
}

export async function borrarSesionKiosco(): Promise<void> {
  const c = await cookies()
  c.set(COOKIE_KIOSCO, '', { ...opciones(), maxAge: 0 })
}

// ── El pase de un votante ───────────────────────────────────────────────────

interface Pase {
  /** Token de la credencial que se canjeó en ESTA terminal. */
  t: string
  /** Elección a la que pertenece, ya verificada contra la de la sesión. */
  e: string
}

export function firmarPase(token: string, eleccionId: string): string {
  return firmar({ t: token, e: eleccionId }, MINUTOS_PASE * 60 * 1000)
}

/**
 * Devuelve el token del pase, o `null` si la firma no cierra, venció, o es de
 * otra elección que la que atiende esta terminal.
 */
export function leerPase(sobre: unknown, eleccionId: string): string | null {
  const d = abrir<Pase>(sobre)
  if (!d || typeof d.t !== 'string' || d.t === '') return null
  if (d.e !== eleccionId) return null
  return d.t
}

// ── Supabase ────────────────────────────────────────────────────────────────

/** La función no existe: falta aplicar `46_voto_kiosco.sql`. */
function esFuncionInexistente(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return (
    err.code === 'PGRST202' ||
    (err.message ?? '').includes('Could not find the function') ||
    (err.message ?? '').includes('abrir_kiosco')
  )
}

/**
 * Canjea la llave por los datos de la elección que atiende.
 *
 * No distingue "no existe" de "es de otra elección" —eso lo decidió la RPC— y
 * acá se agrega una sola distinción, que es operativa y no un oráculo: si la
 * base todavía no tiene el archivo aplicado, decirlo. Sin eso, la noche del
 * acto una llave correcta se lee como una llave equivocada.
 */
export async function abrirKiosco(
  admin: SupabaseClient,
  llave: string,
): Promise<DatosTerminal | { error: ErrorKiosco }> {
  const { data, error } = await admin.rpc('abrir_kiosco', { p_codigo: llave })

  if (error) {
    if (esFuncionInexistente(error)) return { error: 'kiosco_no_disponible' }
    throw new Error(`abrir_kiosco: ${error.message}`)
  }
  if (!data || typeof data !== 'object') return { error: 'codigo_invalido' }

  const d = data as Record<string, unknown>
  if (d.ok !== true) return { error: 'codigo_invalido' }

  const id = typeof d.eleccion_id === 'string' ? d.eleccion_id : ''
  // Un `ok` sin elección no se puede usar para montar nada, y montar a ciegas
  // es peor que no montar: los votos saldrían sin terminal y el acta los
  // contaría como voto a distancia sin que nadie se entere.
  if (!id) return { error: 'codigo_invalido' }

  return {
    eleccion_id: id,
    nombre: String(d.nombre ?? ''),
    fecha_apertura: String(d.fecha_apertura ?? ''),
    fecha_cierre: String(d.fecha_cierre ?? ''),
    estado: String(d.estado ?? ''),
  }
}

/**
 * ¿La terminal montada sigue habilitada?
 *
 * Se pregunta en cada llamada porque es la única forma de que "Regenerar" y
 * "Cerrar terminal" del desktop tumben una tablet que está en otro edificio. Es
 * un SELECT por clave primaria: al lado de las tres RPC de la votación, no se
 * nota.
 *
 * **Ante un error de transporte deja pasar.** Si la base no contesta, la
 * votación tampoco va a andar y el error va a salir por donde corresponde; lo
 * que no puede pasar es que un parpadeo de red obligue al operador a volver a
 * tipear la llave con la fila esperando. Sólo se cierra la terminal ante una
 * respuesta concreta: la llave cambió, se cerró, o la elección terminó.
 */
export async function terminalVigente(
  admin: SupabaseClient,
  sesion: SesionKiosco,
): Promise<boolean> {
  const { data, error } = await admin
    .from('elecciones_remoto')
    .select('estado, codigo_kiosco')
    .eq('id', sesion.eleccion_id)
    .maybeSingle()

  if (error) {
    console.warn(`[kiosco] no se pudo revalidar la terminal: ${error.message}`)
    return true
  }
  if (!data) return false

  const llave = typeof data.codigo_kiosco === 'string' ? data.codigo_kiosco.trim() : ''
  if (llave === '') return false
  if (huellaDe(llave.toUpperCase()) !== sesion.huella) return false

  // Los mismos estados que acepta `abrir_kiosco`: una elección escrutada o
  // anulada no tiene por qué seguir teniendo una tablet abierta en el local.
  return data.estado === 'padron' || data.estado === 'abierta'
}

/**
 * Marca un voto recién emitido como salido de esta terminal.
 *
 * **Nunca lanza y nunca se le avisa al votante**: el voto ya está emitido y es
 * válido. Lo único que cambia si esto falla es que el acta lo cuenta como voto
 * web. Mostrarle un error a alguien que acaba de votar bien sería el peor
 * intercambio posible.
 */
export async function marcarVotoKiosco(
  admin: SupabaseClient,
  votoId: string,
  terminal: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('marcar_voto_kiosco', {
      p_voto_id: votoId,
      p_terminal: terminal,
    })
    if (error) {
      console.warn(`[kiosco] marcar_voto_kiosco falló (${votoId}): ${error.message}`)
      return false
    }
    return data === true
  } catch (err) {
    console.warn(`[kiosco] marcar_voto_kiosco falló (${votoId}):`, err)
    return false
  }
}
