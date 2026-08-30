/**
 * GET /t/click/{slug}_{historial_id}?u={destino}
 *
 * Endpoint PÚBLICO (sin auth): el envoltorio de clicks. El desktop reescribe
 * todos los `<a href="http(s)://…">` del mail para que pasen por acá antes de
 * llegar a destino. Usa service_role (RLS cerrado a anon).
 *
 * Prioridad absoluta: que la persona llegue a donde iba. Por eso el registro
 * del click va con `after()` — el 302 sale ya, y la escritura corre una vez
 * enviada la respuesta—; antes el redirect esperaba dos viajes a Supabase (y
 * el arranque en frío de la función encima), o sea que la "prioridad absoluta"
 * era mentira por el orden de las líneas. Si la base falla, se pierde el
 * registro y nada más.
 */

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { empresaPorSlug, esDestinoSeguro, parseTrackingId, registrarEvento } from '@/lib/tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const destino = new URL(req.url).searchParams.get('u') || ''

  // Sin destino válido no hay a dónde mandar a nadie, y seguir un `u` que no sea
  // http(s) convertiría el dominio en un redirector abierto (ver esDestinoSeguro).
  // Un link legítimo siempre trae uno: si llegó hasta acá, lo tocaron a mano.
  if (!esDestinoSeguro(destino)) {
    return NextResponse.json({ error: 'Destino inválido' }, { status: 400 })
  }

  try {
    const { id } = await params
    const parsed = parseTrackingId(id)
    if (parsed) {
      after(async () => {
        try {
          const admin = createAdminClient()
          const empresa = await empresaPorSlug(admin, parsed.slug)
          if (empresa) {
            await registrarEvento(admin, empresa, {
              historialId: parsed.historialId,
              tipo: 'click',
              urlDestino: destino,
              req,
            })
          }
        } catch (err) {
          console.error('[GET /t/click/[id]] registro diferido:', err)
        }
      })
    }
  } catch (err) {
    console.error('[GET /t/click/[id]] error:', err)
  }

  // 302 y no 307/308: es una redirección de navegación, y los permanentes los
  // cachea el navegador —el segundo click del mismo mail no volvería a pasar
  // por acá y se perdería—.
  const res = NextResponse.redirect(destino, 302)
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  return res
}
