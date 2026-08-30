/**
 * GET /t/open/{slug}_{historial_id}
 *
 * Endpoint PÚBLICO (sin auth): el pixel de apertura que el desktop inyecta al
 * final del HTML de cada mail. Usa service_role (RLS cerrado a anon).
 *
 * Devuelve el GIF pase lo que pase — slug inexistente, base caída, id mal
 * formado—. Un mail con la imagen rota se ve mal en la bandeja del
 * destinatario, y ninguna métrica vale eso.
 *
 * La escritura va con `after()`: el GIF sale primero y el registro corre una
 * vez enviada la respuesta. Antes se esperaban dos viajes a Supabase para
 * devolver 43 bytes.
 */

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { empresaPorSlug, parseTrackingId, registrarEvento, respuestaPixel } from '@/lib/tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
              tipo: 'open',
              req,
            })
          }
        } catch (err) {
          console.error('[GET /t/open/[id]] registro diferido:', err)
        }
      })
    }
  } catch (err) {
    console.error('[GET /t/open/[id]] error:', err)
  }
  return respuestaPixel()
}
