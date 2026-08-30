/**
 * Tracking de apertura y clicks de los emails que manda ContaSystem desktop.
 *
 * Las tablas (`empresas_api_keys`, `tracking_events`) ya viven en este mismo
 * proyecto Supabase — las creó `docs/supabase/03_atri_tracking.sql` del repo
 * desktop, que originalmente servía al deploy aparte `atri-tracking`. Acá se
 * reimplementan los cuatro endpoints sobre la web, para no sostener dos deploys
 * ni pasear links de un cliente por los mails de otro.
 *
 * OJO: `atri-tracking` NO se puede apagar todavía. Los mails ya enviados tienen
 * su URL horneada en el HTML, así que cada apertura futura de un recibo viejo
 * le sigue pegando a ese host. Esto es una segunda instalación, no un reemplazo.
 *
 * Todo va con service_role: las dos tablas tienen RLS sin policies.
 */

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { clientIp } from '@/lib/rate-limit'

export interface EmpresaTracking {
  empresa_slug: string
  empresa_id: string
  nombre: string
}

export type TipoEvento = 'open' | 'click'

/** GIF transparente de 1×1 (43 bytes). Lo que devuelve el pixel de apertura. */
const PIXEL_GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Cabeceras anti-caché del pixel.
 *
 * No son decorativas: si Gmail o un proxy corporativo cachean el GIF, la segunda
 * apertura del mismo mail no vuelve a pegarle al server y la métrica se pierde
 * en silencio. Es el modo de fallar más caro que tiene este endpoint.
 */
const SIN_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
} as const

export function respuestaPixel(): NextResponse {
  const bytes = Buffer.from(PIXEL_GIF_B64, 'base64')
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: { ...SIN_CACHE, 'Content-Type': 'image/gif', 'Content-Length': String(bytes.length) },
  })
}

/**
 * Parte el identificador público `{slug}_{historial_id}` que arma el desktop
 * (ver `buildPixelUrl` / `buildClickUrl` en `src/lib/modules/tracking.ts`).
 *
 * Corta por el ÚLTIMO guión bajo, no por el primero: el historial_id es un UUID
 * y los UUID no tienen `_`, así que de este lado el corte es seguro aunque
 * mañana algún slug lleve uno. Al revés no: cortar por el primero rompería.
 */
export function parseTrackingId(raw: string): { slug: string; historialId: string } | null {
  const valor = decodeURIComponent(raw || '').trim()
  const corte = valor.lastIndexOf('_')
  if (corte <= 0 || corte === valor.length - 1) return null
  return { slug: valor.slice(0, corte), historialId: valor.slice(corte + 1) }
}

/** SHA-256 hex, el mismo formato que guarda `empresas_api_keys.api_key_hash`. */
export function hashHex(valor: string): string {
  return createHash('sha256').update(valor).digest('hex')
}

/**
 * Cache en memoria de slug → empresa. Son 3-4 filas que cambian casi nunca
 * (se da de alta una empresa por año, con suerte), y cada pixel/click pagaba
 * un round-trip a Supabase sólo para resolverla. En serverless el cache es por
 * instancia: el primer hit de una instancia fría paga la consulta, el resto no.
 * El TTL corto para el negativo evita que un slug recién dado de alta quede
 * "inexistente" media hora en las instancias calientes.
 */
const TTL_SLUG_MS = 5 * 60_000
const TTL_SLUG_NEGATIVO_MS = 60_000
const cacheSlug = new Map<string, { empresa: EmpresaTracking | null; hasta: number }>()

export async function empresaPorSlug(
  admin: SupabaseClient,
  slug: string,
): Promise<EmpresaTracking | null> {
  const cacheada = cacheSlug.get(slug)
  if (cacheada && cacheada.hasta > Date.now()) return cacheada.empresa

  const { data, error } = await admin
    .from('empresas_api_keys')
    .select('empresa_slug, empresa_id, nombre')
    .eq('empresa_slug', slug)
    .eq('activo', true)
    .maybeSingle()
  if (error) {
    // Un error de red NO se cachea: el próximo hit vuelve a intentar.
    console.error('[tracking] empresaPorSlug:', error.message)
    return null
  }
  const empresa = (data as EmpresaTracking) ?? null
  cacheSlug.set(slug, {
    empresa,
    hasta: Date.now() + (empresa ? TTL_SLUG_MS : TTL_SLUG_NEGATIVO_MS),
  })
  return empresa
}

/** Resuelve la empresa a partir del header `x-api-key` que manda el desktop. */
export async function empresaPorApiKey(
  admin: SupabaseClient,
  req: Request,
): Promise<EmpresaTracking | null> {
  const key = req.headers.get('x-api-key')?.trim()
  if (!key) return null
  const { data, error } = await admin
    .from('empresas_api_keys')
    .select('empresa_slug, empresa_id, nombre')
    .eq('api_key_hash', hashHex(key))
    .eq('activo', true)
    .maybeSingle()
  if (error) {
    console.error('[tracking] empresaPorApiKey:', error.message)
    return null
  }
  return (data as EmpresaTracking) ?? null
}

/**
 * Sólo se envuelven y se siguen URLs http(s).
 *
 * El endpoint de click es público y el destino viaja en la query, así que sin
 * este filtro el dominio quedaría convertido en un redirector abierto — lo que
 * usa el phishing para que un link propio parezca de un sitio confiable. El
 * desktop ya filtra del lado que envuelve, pero eso no protege a nadie: acá
 * puede llegar cualquiera con cualquier `u`.
 */
export function esDestinoSeguro(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Patrones de user-agent que identifican antispam corporativos y bots — NO
 * aperturas ni clicks humanos. Copiados del desktop (`src/lib/modules/
 * tracking.ts`, `BOT_UA_PATTERNS`): mantener las dos listas iguales.
 *
 * IMPORTANTE: NO se filtra GoogleImageProxy/ggpht ni MSOffice, por lo mismo
 * que el desktop: Gmail cachea la imagen tras el primer fetch del proxy y
 * Outlook usa el mismo UA para escanear y para mostrar — filtrarlos dejaría
 * invisible a la mayoría de los destinatarios reales.
 *
 * A diferencia del desktop (que sólo limpiaba opens, y retroactivamente), acá
 * se filtra AL INSERTAR y también para los clicks: un click de Proofpoint /
 * SafeLinks —que abren todos los links de un mail antes de entregarlo— no es
 * una persona y quedaba contado como tal para siempre.
 */
const BOT_UA_PATTERNS: RegExp[] = [
  // Antispam / security scanners corporativos
  /BarracudaCentral/i,
  /Mimecast/i,
  /Proofpoint/i,
  // Bots genéricos
  /(?:^|\s)bot[\s\/]/i,
  /crawler/i,
  /spider/i,
]

function esBot(ua: string | null | undefined): boolean {
  if (!ua) return false
  return BOT_UA_PATTERNS.some((re) => re.test(ua))
}

/**
 * Registra un evento. Nunca lanza: si la escritura falla se logea y se sigue.
 *
 * Es deliberado y aplica a los dos endpoints públicos. Un problema de base no
 * puede dejar un mail con la imagen rota ni —mucho peor— dejar a alguien que
 * hizo click mirando un error en vez de llegar a donde iba. La métrica es lo
 * prescindible de los tres. (Desde P1 los endpoints además la difieren con
 * `after()`: la respuesta sale antes de que esto corra.)
 *
 * `lote_id` queda siempre en NULL: la URL pública sólo trae slug e historial_id.
 * El desktop no lo necesita —agrupa por lote leyendo `historial_mensajes`—, así
 * que la columna existe por el esquema original y no por un dato que falte.
 */
export async function registrarEvento(
  admin: SupabaseClient,
  empresa: EmpresaTracking,
  datos: {
    historialId: string
    tipo: TipoEvento
    urlDestino?: string | null
    req: Request
  },
): Promise<void> {
  try {
    const userAgent = datos.req.headers.get('user-agent')
    if (esBot(userAgent)) return

    const { error } = await admin.from('tracking_events').insert({
      empresa_slug: empresa.empresa_slug,
      empresa_id: empresa.empresa_id,
      historial_id: datos.historialId,
      lote_id: null,
      tipo: datos.tipo,
      url_destino: datos.urlDestino ?? null,
      user_agent: userAgent,
      // Hasheada: alcanza para distinguir aperturas sin guardar de quién.
      ip_hash: hashHex(clientIp(datos.req)),
    })
    if (error) console.error(`[tracking] insert ${datos.tipo}:`, error.message)
  } catch (err) {
    console.error(`[tracking] insert ${datos.tipo}:`, err)
  }
}

// ─── Endpoints autenticados que consume el desktop ───
// Las formas de respuesta las parsea `src/lib/modules/tracking.ts` (interfaces
// `EventsResponse` y el objeto suelto de `testConnection`). Cambiarlas rompe
// clientes ya instalados: el desktop es una app de escritorio, no se redeploya.

/** Cuántos eventos por página. El desktop pagina solo hasta 20 páginas. */
const PAGINA = 500

export async function handleEvents(req: Request): Promise<NextResponse> {
  const admin = createAdminClient()
  const empresa = await empresaPorApiKey(admin, req)
  if (!empresa) {
    return NextResponse.json({ ok: false, error: 'API key no reconocida' }, { status: 401 })
  }

  const since = new URL(req.url).searchParams.get('since')?.trim() || null

  let q = admin
    .from('tracking_events')
    .select('id, historial_id, lote_id, tipo, url_destino, user_agent, created_at')
    .eq('empresa_id', empresa.empresa_id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PAGINA)

  // `gte` y no `gt`, a propósito. El cursor es el `created_at` del último evento
  // de la página: con `gt` se perdería en silencio cualquier evento que comparta
  // ese timestamp exacto y haya quedado del otro lado del corte. Con `gte` el
  // costo es repetir una fila por página, y eso es gratis porque el desktop
  // deduplica por id de evento antes de insertar (`upsertEvento`).
  if (since) q = q.gte('created_at', since)

  const { data, error } = await q
  if (error) {
    console.error('[GET /api/tracking/events] supabase:', error.message)
    return NextResponse.json({ ok: false, error: 'Error consultando eventos' }, { status: 500 })
  }

  const events = data ?? []
  const ultimo = events[events.length - 1] as { created_at: string } | undefined

  return NextResponse.json(
    {
      ok: true,
      empresa: { slug: empresa.empresa_slug, nombre: empresa.nombre },
      count: events.length,
      has_more: events.length === PAGINA,
      cursor: ultimo?.created_at ?? null,
      events,
    },
    { headers: SIN_CACHE },
  )
}

/**
 * Prueba de conexión. Responde 200 SIEMPRE, incluso con una key inválida.
 *
 * No es descuido: `testConnection` del desktop distingue "no llegué al server"
 * (excepción) de "llegué y la key no sirve" (`authenticated: false`), y sólo
 * con el 200 puede mostrar "API key no reconocida" en vez de un error de red
 * crudo. Un 401 acá le empeora el mensaje a quien está configurando.
 */
export async function handleHealth(req: Request): Promise<NextResponse> {
  const admin = createAdminClient()
  const empresa = await empresaPorApiKey(admin, req)
  return NextResponse.json(
    {
      ok: true,
      authenticated: !!empresa,
      empresa: empresa ? { slug: empresa.empresa_slug, nombre: empresa.nombre } : null,
    },
    { headers: SIN_CACHE },
  )
}
