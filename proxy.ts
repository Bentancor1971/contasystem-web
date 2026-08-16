import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/cron   (crons: se autentican con CRON_SECRET, no con sesión —
     *               si pasaran por acá, se redirigirían a /login)
     * - t/         (pixel y clicks de los mails: los abre el destinatario, que
     *               nunca tiene sesión. Se excluyen ACÁ y no en PUBLIC_PATHS
     *               —como api/cron, y a diferencia de /e/, /v/ o /p/— porque
     *               updateSession llama a supabase.auth.getUser() ANTES de
     *               mirar si la ruta es pública: cada apertura de mail pagaría
     *               un round-trip de auth para devolver un GIF de 43 bytes.)
     * - api/tracking, api/events, api/health, api/bajas
     *              (los consume el desktop con x-api-key, no con sesión. Los
     *               tres últimos son alias que existen por la whitelist de Rust.
     *               `api/events` no captura `api/eventos`: divergen en la 's'.)
     * - b/         (la página de baja de los mails: la abre el destinatario,
     *               que nunca tiene sesión. Mismo motivo que t/ — y acá pesa
     *               más todavía: si updateSession la redirigiera a /login,
     *               alguien que quiso darse de baja termina en el botón "Spam".)
     * - images/ (public images)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/cron|t/|b/|api/tracking|api/events|api/health|api/bajas|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
