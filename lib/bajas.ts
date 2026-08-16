/**
 * Bajas de comunicación (opt-out) de los mails que manda ContaSystem desktop.
 *
 * Va al lado de `lib/tracking.ts` y comparte toda su infraestructura: el mismo
 * `empresas_api_keys`, el mismo `{slug}_{historial_id}` público, el mismo
 * Supabase. La tabla la crea `docs/supabase/55_bajas_comunicacion.sql` del repo
 * desktop. Diseño completo en `docs/opt-out-propuesta.md` de ese repo.
 *
 * Por qué existe: hasta agosto de 2026 la única forma que tenía un destinatario
 * de dejar de recibir era el botón "Spam" — que es justamente la señal que
 * decide si los próximos mails, los de todos los demás, entran a la bandeja.
 *
 * Igual que el tracking, esto está DUPLICADO en el deploy aparte
 * `atri-tracking`: los mails ya enviados llevan la URL horneada en el HTML, así
 * que aquel host tiene que seguir respondiendo. Si cambiás la forma de la
 * respuesta de `/api/bajas`, cambiala en los dos.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { clientIp } from '@/lib/rate-limit'
import { empresaPorApiKey, empresaPorSlug, hashHex, parseTrackingId } from '@/lib/tracking'

const SIN_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
} as const

/** Cuántas bajas por página. Mismo contrato que `/api/tracking/events`. */
const PAGINA = 500

// ─── Endpoint público: la página de baja ───

/**
 * GET /b/{slug}_{historial_id} — la página de confirmación. **No escribe nada.**
 *
 * Ese "no escribe nada" es el punto entero del endpoint. Los escáneres antispam
 * corporativos abren todos los links de un mail antes de entregarlo; en este
 * mismo sistema ya se sabe de primera mano, porque Barracuda, Mimecast y
 * Proofpoint están en `BOT_UA_PATTERNS` del desktop por inflar las aperturas.
 * Un link de baja que ejecutara con un GET daría de baja a media lista sola.
 * Es también la razón de que el one-click de Gmail (RFC 8058) sea POST.
 */
export function handleBajaPagina(id: string): NextResponse {
  const parsed = parseTrackingId(id)
  // Aun con un id roto se devuelve una página, no un 404: un link muerto para
  // alguien que está intentando darse de baja termina en el botón "Spam".
  const html = parsed ? paginaConfirmar(id) : paginaError()
  return new NextResponse(html, {
    status: parsed ? 200 : 400,
    headers: { ...SIN_CACHE, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * POST /b/{slug}_{historial_id} — registra la baja.
 *
 * Sirve a los dos caminos con el mismo código:
 *   - el botón de la página de confirmación (form post con `confirmar=1`)
 *   - el botón nativo del cliente de correo, que postea
 *     `List-Unsubscribe=One-Click` como form-urlencoded (RFC 8058)
 *
 * Nunca guarda una dirección de correo: la fila se ancla en `historial_id` y es
 * el desktop el que resuelve a qué mail corresponde, contra su
 * `historial_mensajes` local. Por eso la página dice "esta dirección" y no la
 * muestra — no la sabe, y es a propósito.
 */
export async function handleBajaRegistrar(id: string, req: Request): Promise<NextResponse> {
  const parsed = parseTrackingId(id)
  if (!parsed) {
    return new NextResponse(paginaError(), {
      status: 400,
      headers: { ...SIN_CACHE, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const esOneClick = await detectarOneClick(req)

  try {
    const admin = createAdminClient()
    const empresa = await empresaPorSlug(admin, parsed.slug)
    if (!empresa) {
      return new NextResponse(paginaError(), {
        status: 404,
        headers: { ...SIN_CACHE, 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    const ok = await registrarBaja(admin, empresa, {
      historialId: parsed.historialId,
      origen: esOneClick ? 'one_click' : 'link',
      req,
    })
    if (!ok) {
      return new NextResponse(paginaError(), {
        status: 500,
        headers: { ...SIN_CACHE, 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
  } catch (err) {
    console.error('[POST /b/[id]] error:', err)
    return new NextResponse(paginaError(), {
      status: 500,
      headers: { ...SIN_CACHE, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // El one-click no le muestra nada a nadie: el cliente de correo espera un 200
  // seco. La página sólo tiene sentido para el otro camino.
  if (esOneClick) {
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE })
  }
  return new NextResponse(paginaHecho(), {
    status: 200,
    headers: { ...SIN_CACHE, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * Escribe la baja. Idempotente por el índice único `(historial_id, categoria)`:
 * un doble clic, o el one-click sumado al botón de la página, son el caso
 * normal y no un error.
 */
async function registrarBaja(
  admin: SupabaseClient,
  empresa: { empresa_slug: string; empresa_id: string },
  datos: { historialId: string; origen: 'link' | 'one_click'; req: Request },
): Promise<boolean> {
  const { error } = await admin.from('bajas_comunicacion').upsert(
    {
      empresa_slug: empresa.empresa_slug,
      empresa_id: empresa.empresa_id,
      historial_id: datos.historialId,
      categoria: 'difusion',
      origen: datos.origen,
      user_agent: datos.req.headers.get('user-agent'),
      ip_hash: hashHex(clientIp(datos.req)),
    },
    { onConflict: 'historial_id,categoria', ignoreDuplicates: true },
  )
  if (error) {
    console.error('[bajas] insert:', error.message)
    return false
  }
  return true
}

/**
 * ¿Vino del cliente de correo o del botón de la página?
 *
 * RFC 8058 manda `List-Unsubscribe=One-Click`; nuestro formulario manda
 * `confirmar=1`. Sin ninguna de las dos marcas se asume one-click: un POST que
 * no salió del formulario no salió de alguien mirando la página.
 */
async function detectarOneClick(req: Request): Promise<boolean> {
  try {
    const texto = await req.text()
    if (texto.includes('confirmar=')) return false
    return true
  } catch {
    return true
  }
}

// ─── Endpoint autenticado que consume el desktop ───

/**
 * GET /api/bajas?since=<ISO> — las bajas para que el desktop las baje.
 *
 * La forma de la respuesta la parsea `src/lib/modules/bajas-sync.ts` del
 * desktop. Cambiarla rompe instalaciones existentes: una app de escritorio no
 * se redeploya.
 *
 * `gte` y no `gt` por el mismo motivo que en `handleEvents`: con `gt` se
 * perdería cualquier fila que comparta el `created_at` exacto del corte de
 * página. El desktop deduplica por `historial_id`, así que repetir una fila es
 * gratis y perder una no.
 */
export async function handleBajas(req: Request): Promise<NextResponse> {
  const admin = createAdminClient()
  const empresa = await empresaPorApiKey(admin, req)
  if (!empresa) {
    return NextResponse.json({ ok: false, error: 'API key no reconocida' }, { status: 401 })
  }

  const since = new URL(req.url).searchParams.get('since')?.trim() || null

  let q = admin
    .from('bajas_comunicacion')
    .select('id, historial_id, categoria, origen, created_at')
    .eq('empresa_id', empresa.empresa_id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PAGINA)

  if (since) q = q.gte('created_at', since)

  const { data, error } = await q
  if (error) {
    console.error('[GET /api/bajas] supabase:', error.message)
    return NextResponse.json({ ok: false, error: 'Error consultando bajas' }, { status: 500 })
  }

  const bajas = data ?? []
  const ultimo = bajas[bajas.length - 1] as { created_at: string } | undefined

  return NextResponse.json(
    {
      ok: true,
      empresa: { slug: empresa.empresa_slug, nombre: empresa.nombre },
      count: bajas.length,
      has_more: bajas.length === PAGINA,
      cursor: ultimo?.created_at ?? null,
      bajas,
    },
    { headers: SIN_CACHE },
  )
}

// ─── Páginas ───
// Sin assets ni dependencias externas: un mail de hoy puede abrirse dentro de
// cinco años y esto tiene que seguir viéndose. Todo inline.

const ESTILO = `
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2933}
  .wrap{max-width:520px;margin:0 auto;padding:48px 20px}
  .card{background:#fff;border-radius:14px;padding:36px 32px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  h1{margin:0 0 14px;font-size:21px;line-height:1.3}
  p{margin:0 0 14px;font-size:15px;line-height:1.6;color:#52606d}
  .btn{display:inline-block;width:100%;padding:13px 20px;border:0;border-radius:9px;
       background:#0b3b5e;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .btn:hover{background:#09304c}
  .nota{margin:22px 0 0;font-size:13px;color:#7b8794}
  .ok{width:46px;height:46px;border-radius:50%;background:#e6f4ea;color:#137333;
      display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 0 18px}
`

function pagina(cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Baja de comunicaciones</title>
<style>${ESTILO}</style>
</head>
<body><div class="wrap"><div class="card">${cuerpo}</div></div></body>
</html>`
}

/** Escapa el id para meterlo en el `action` del formulario. */
function escapeAttr(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paginaConfirmar(id: string): string {
  return pagina(`
    <h1>¿Querés dejar de recibir estos correos?</h1>
    <p>
      Si confirmás, esta dirección deja de recibir novedades, invitaciones a
      eventos y difusión.
    </p>
    <form method="post" action="/b/${escapeAttr(encodeURIComponent(id))}">
      <input type="hidden" name="confirmar" value="1">
      <button class="btn" type="submit">Sí, darme de baja</button>
    </form>
    <p class="nota">
      Vas a seguir recibiendo lo que hace a tu vínculo con la asociación:
      recibos, avisos de cuota y las comunicaciones de las elecciones.
      Si tampoco querés recibir eso, escribinos y lo damos de baja a mano.
    </p>
  `)
}

function paginaHecho(): string {
  return pagina(`
    <div class="ok">✓</div>
    <h1>Listo, te dimos de baja</h1>
    <p>
      Esta dirección no va a recibir más novedades ni difusión. El cambio puede
      tardar unas horas en aplicarse a envíos ya preparados.
    </p>
    <p class="nota">
      Si te arrepentís o te diste de baja por error, escribinos y te volvemos a
      anotar. Podés cerrar esta ventana.
    </p>
  `)
}

function paginaError(): string {
  return pagina(`
    <h1>No pudimos procesar el pedido</h1>
    <p>
      El enlace no es válido o venció. Escribinos respondiendo el correo que
      recibiste y te damos de baja a mano.
    </p>
  `)
}
