import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * El proxy corre SÓLO en lo que necesita sesión de Supabase: `/`, /login,
     * /empresa, el grupo (app) y /api/admin + /api/checkin. Todo lo demás se
     * excluye acá, en el matcher, para que una request pública no pague dos
     * invocaciones de función (proxy + handler) ni el bundle del middleware:
     *
     * - _next/static, _next/image, favicon.ico, extensiones estáticas — assets.
     * - manifest.webmanifest, robots.txt, sitemap.xml — los pide el navegador
     *   solo, en TODAS las páginas (el manifest lo inyecta app/manifest.ts).
     *   Sin esta exclusión, cada visita anónima a /e/{slug} pedía el manifest,
     *   recibía un 307 a /login y el HTML del login como "manifest".
     * - api/cron — se autentica con CRON_SECRET; un redirect a /login lo rompe.
     * - t/, b/, api/tracking, api/events, api/health, api/bajas — pixel,
     *   clicks y bajas de los mails (los abre el destinatario, sin sesión) y
     *   los endpoints que consume el desktop con x-api-key. `api/events` no
     *   captura `api/eventos`: divergen en la 's'.
     * - e/, a/, c/, p/, v, v/, mesa, mesa/ y sus api/ — las rutas públicas de
     *   eventos, entradas QR, certificados, postulación, votación y mesa. Son
     *   las mismas de PUBLIC_SIN_SESION en lib/supabase/middleware.ts (que
     *   queda como segunda línea de defensa por si estas listas divergen).
     *   `v$` y `mesa$` cubren la ruta exacta sin capturar otras que empiecen
     *   igual; `e/` no captura /empresa y `c/` no captura /carga, /checkin ni
     *   /configuracion porque la barra es parte del prefijo. El Cache-Control
     *   de estas rutas NO depende del proxy: las páginas lo fijan en
     *   next.config.ts (headers) y los handlers en su _comun.ts.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|api/cron|api/tracking|api/events|api/health|api/bajas|api/eventos/|api/votacion/|api/mesa/|api/postulacion/|api/certificados/|t/|b/|e/|a/|c/|p/|v$|v/|mesa$|mesa/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|woff2?)$).*)',
  ],
}
