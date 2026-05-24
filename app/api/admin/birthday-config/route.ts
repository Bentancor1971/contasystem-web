/**
 * GET /api/admin/birthday-config?empresa_id=...
 *
 * Devuelve el estado de la configuración del cron de saludos de cumpleaños
 * para mostrarlo en /configuracion/mails. Solo lectura.
 *
 * La lista de empresas sale del registro (empresas_api_keys), así una
 * empresa nueva aparece sola. Para cada una se informa: nombre, estado de
 * la casilla Gmail (variables de entorno), si tiene plantilla y si está
 * activa para el envío.
 *
 * NUNCA devuelve secretos: ni la App Password ni el valor de CRON_SECRET.
 *
 * Autorización: caller con `puede_ver_config`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertPuedeVerConfig } from '@/lib/birthday-auth'
import {
  TEMPLATE_TABLE,
  loadEmpresasRegistro,
  esTablaInexistente,
} from '@/lib/birthday-template-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cron de Vercel: una corrida diaria a las 11:00 UTC = 08:00 Montevideo
 * (ver vercel.json). En plan Hobby no se permiten crons sub-diarios, así
 * que la hora queda fija en el repo. Si hay que cambiarla, editar
 * vercel.json y HORA_ENVIO_MONTEVIDEO, y hacer redeploy.
 */
const HEARTBEAT_CRON = '0 11 * * *'
const HORA_ENVIO_MONTEVIDEO = 8

interface LogRow {
  socio_id: string
  empresa_id: string | null
  fecha_cumpleanos: string
  status: string
  error_message: string | null
  enviado_en: string
}

export async function GET(req: NextRequest) {
  try {
    const empresaId = req.nextUrl.searchParams.get('empresa_id') ?? ''
    const auth = await assertPuedeVerConfig(empresaId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createAdminClient()
    const cronSecretConfigurado = !!process.env.CRON_SECRET?.trim()
    const horaEnvio = HORA_ENVIO_MONTEVIDEO

    // ── Empresas: registro (nombre) + plantilla / activo / casilla Gmail ──
    const registro = await loadEmpresasRegistro(admin)

    interface DatosEmpresa {
      activo: boolean
      gmailUser: string | null
      fromName: string | null
      appPasswordSet: boolean
    }
    const porEmpresa = new Map<string, DatosEmpresa>()
    let templatesTablaExiste = true

    const { data: tplRows, error: tplErr } = await admin
      .from(TEMPLATE_TABLE)
      .select('empresa_id, activo, gmail_user, gmail_app_password, from_name')

    if (tplErr) {
      if (esTablaInexistente(tplErr)) {
        templatesTablaExiste = false
      } else {
        return NextResponse.json(
          { error: `Error leyendo plantillas: ${tplErr.message}` },
          { status: 500 },
        )
      }
    } else {
      for (const r of (tplRows ?? []) as {
        empresa_id: string
        activo: boolean
        gmail_user: string | null
        gmail_app_password: string | null
        from_name: string | null
      }[]) {
        porEmpresa.set(r.empresa_id, {
          activo: !!r.activo,
          gmailUser: r.gmail_user?.trim() || null,
          fromName: r.from_name?.trim() || null,
          // Nunca se devuelve la App Password — solo si está cargada.
          appPasswordSet: !!r.gmail_app_password?.trim(),
        })
      }
    }

    const empresas = registro.map((e) => {
      const d = porEmpresa.get(e.empresaId)
      const gmailUser = d?.gmailUser ?? null
      const fromName = d?.fromName ?? null
      const appPasswordSet = d?.appPasswordSet ?? false
      const partes = [gmailUser, fromName, appPasswordSet || null].filter(
        Boolean,
      ).length
      const estado =
        partes === 0 ? 'vacia' : partes === 3 ? 'completa' : 'incompleta'
      return {
        empresaId: e.empresaId,
        nombre: e.nombre,
        slug: e.slug,
        activo: d?.activo ?? false,
        tieneTemplate: !!d,
        gmail: { user: gmailUser, fromName, appPasswordSet, estado },
      }
    })

    // ── Logs recientes — la tabla puede no existir todavía ──
    let logsTablaExiste = true
    let recientes: LogRow[] = []
    let totalEnviados: number | null = null

    const { data: logsData, error: logsErr } = await admin
      .from('birthday_email_logs')
      .select('socio_id, empresa_id, fecha_cumpleanos, status, error_message, enviado_en')
      .order('enviado_en', { ascending: false })
      .limit(15)

    if (logsErr) {
      if (esTablaInexistente(logsErr)) {
        logsTablaExiste = false
      } else {
        return NextResponse.json(
          { error: `Error leyendo logs: ${logsErr.message}` },
          { status: 500 },
        )
      }
    } else {
      recientes = (logsData ?? []) as LogRow[]
      const { count } = await admin
        .from('birthday_email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'enviado')
      totalEnviados = count ?? null
    }

    return NextResponse.json({
      cron: { horaEnvio, heartbeat: HEARTBEAT_CRON },
      cronSecretConfigurado,
      templatesTablaExiste,
      empresas,
      logs: { tablaExiste: logsTablaExiste, recientes, totalEnviados },
    })
  } catch (err) {
    console.error('[GET /api/admin/birthday-config] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
