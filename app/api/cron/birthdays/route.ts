/**
 * GET /api/cron/birthdays
 *
 * Disparado por Vercel Cron una vez por día (ver vercel.json: 12:00 UTC =
 * 09:00 Montevideo). Detecta los socios que cumplen años hoy y les envía un
 * saludo desde la casilla Gmail de su empresa.
 *
 * Seguridad   · exige header  Authorization: Bearer <CRON_SECRET>.
 * Idempotencia· un socio recibe a lo sumo un mail por fecha (tabla
 *               birthday_email_logs, unique socio_id + fecha_cumpleanos).
 * Zona horaria· "hoy" se calcula en America/Montevideo, no en UTC.
 *
 * Respuesta   · { ok, fecha, found, sent, skipped, errors[] }
 *
 * Tabla de personas: `socios_datos` (no `personas`). Campos usados:
 *   id, nombre, apellido, mail, fecha_nacimiento (TEXT ISO), empresa_id (TEXT).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBirthdayEmail, type SendResult } from '@/lib/mailer'
import { loadActiveEmpresas } from '@/lib/birthday-template-store'

// Nodemailer necesita el runtime Node (sockets TCP/TLS), no Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface SocioRow {
  id: string
  nombre: string | null
  apellido: string | null
  mail: string | null
  fecha_nacimiento: string | null
  empresa_id: string | null
}

interface MontevideoToday {
  year: number
  month: number
  day: number
  /** YYYY-MM-DD */
  iso: string
}

/** Fecha de hoy en America/Montevideo (UTC-3, sin horario de verano). */
function getMontevideoToday(): MontevideoToday {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value)

  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { year, month, day, iso }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Extrae mes y día de `fecha_nacimiento` (TEXT ISO). Devuelve null si es inválida. */
function parseBirthMonthDay(raw: string | null): { month: number; day: number } | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { month, day }
}

/**
 * ¿El socio cumple años hoy?
 * Caso 29-feb: en años no bisiestos se lo saluda el 28-feb.
 */
function cumpleHoy(
  birth: { month: number; day: number },
  today: MontevideoToday,
): boolean {
  if (birth.month === today.month && birth.day === today.day) return true

  if (
    birth.month === 2 &&
    birth.day === 29 &&
    today.month === 2 &&
    today.day === 28 &&
    !isLeapYear(today.year)
  ) {
    return true
  }
  return false
}

/** Capitaliza el nombre para el saludo (en la base puede venir en MAYÚSCULAS). */
function formatNombre(raw: string | null): string {
  const n = (raw ?? '').trim()
  if (!n) return ''
  return n
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export async function GET(req: NextRequest) {
  // ── 1) Autorización ──────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/birthdays] CRON_SECRET no configurada en el servidor')
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurada en el servidor' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }

  try {
    const today = getMontevideoToday()

    const admin = createAdminClient()

    // ── 2) Empresas activas (plantilla con activo = true) ──────────────
    // La lista de empresas sale de la base, no de variables de entorno:
    // solo se saluda a las que tienen la plantilla marcada como activa.
    // Cada una trae su plantilla y su casilla Gmail.
    const empresasActivas = await loadActiveEmpresas(admin)
    const empresaIds = [...empresasActivas.keys()]

    if (empresaIds.length === 0) {
      console.log(`[cron/birthdays] ${today.iso} · ninguna empresa activa`)
      return NextResponse.json({
        ok: true,
        fecha: today.iso,
        found: 0,
        sent: 0,
        skipped: 0,
        errors: [],
      })
    }

    // ── 3) Traer socios candidatos de esas empresas ────────────────────
    //  - deleted_at IS NULL  → no saludar socios dados de baja
    //  - mail / fecha_nacimiento no nulos → sin esos datos no hay nada que hacer
    const { data: sociosData, error: sociosErr } = await admin
      .from('socios_datos')
      .select('id, nombre, apellido, mail, fecha_nacimiento, empresa_id')
      .in('empresa_id', empresaIds)
      .is('deleted_at', null)
      .not('mail', 'is', null)
      .not('fecha_nacimiento', 'is', null)

    if (sociosErr) {
      console.error('[cron/birthdays] error consultando socios:', sociosErr.message)
      return NextResponse.json(
        { ok: false, error: `Error consultando socios: ${sociosErr.message}` },
        { status: 500 },
      )
    }

    const socios = (sociosData ?? []) as SocioRow[]

    // ── 4) Filtrar los que cumplen años hoy ────────────────────────────
    const cumpleaneros = socios.filter((s) => {
      const bd = parseBirthMonthDay(s.fecha_nacimiento)
      return bd ? cumpleHoy(bd, today) : false
    })

    // ── 5) Idempotencia: socios ya saludados hoy ───────────────────────
    const { data: logsData, error: logsErr } = await admin
      .from('birthday_email_logs')
      .select('socio_id, status')
      .eq('fecha_cumpleanos', today.iso)

    if (logsErr) {
      console.error('[cron/birthdays] error consultando logs:', logsErr.message)
      return NextResponse.json(
        { ok: false, error: `Error consultando logs: ${logsErr.message}` },
        { status: 500 },
      )
    }

    const yaEnviados = new Set(
      (logsData ?? [])
        .filter((l) => l.status === 'enviado')
        .map((l) => l.socio_id as string),
    )

    // ── 6) Enviar y logear ─────────────────────────────────────────────
    let sent = 0
    let skipped = 0
    const errors: { socio_id: string; mail: string; error: string }[] = []

    for (const socio of cumpleaneros) {
      // Ya saludado hoy (re-ejecución del cron) → no reenviar.
      if (yaEnviados.has(socio.id)) {
        skipped++
        continue
      }

      const mail = (socio.mail ?? '').trim()
      const empresaId = socio.empresa_id
      if (!mail || !empresaId) {
        skipped++
        continue
      }

      const data = empresasActivas.get(empresaId)
      let result: SendResult
      if (!data) {
        // La empresa dejó de estar activa entre consultas — saltear.
        skipped++
        continue
      } else if (!data.cuenta) {
        result = {
          ok: false,
          error:
            'La empresa no tiene casilla Gmail configurada (usuario, App Password y nombre del remitente).',
        }
      } else {
        result = await sendBirthdayEmail({
          cuenta: data.cuenta,
          to: mail,
          nombre: formatNombre(socio.nombre),
          plantilla: data.plantilla,
        })
      }

      // upsert: en un reintento (log previo con status 'error') actualiza la fila.
      const { error: logErr } = await admin.from('birthday_email_logs').upsert(
        {
          socio_id: socio.id,
          empresa_id: empresaId,
          fecha_cumpleanos: today.iso,
          status: result.ok ? 'enviado' : 'error',
          error_message: result.ok ? null : result.error,
          enviado_en: new Date().toISOString(),
        },
        { onConflict: 'socio_id,fecha_cumpleanos' },
      )

      if (result.ok) {
        sent++
        if (logErr) {
          // El mail salió pero no pudimos persistir el log: avisamos para no
          // perder trazabilidad (no cuenta como error de envío).
          console.error(
            `[cron/birthdays] mail enviado pero falló el log · socio=${socio.id}: ${logErr.message}`,
          )
        }
      } else {
        errors.push({ socio_id: socio.id, mail, error: result.error })
        if (logErr) {
          console.error(
            `[cron/birthdays] envío fallido y además falló el log · socio=${socio.id}: ${logErr.message}`,
          )
        }
      }
    }

    const summary = {
      ok: true as const,
      fecha: today.iso,
      found: cumpleaneros.length,
      sent,
      skipped,
      errors,
    }

    console.log(
      `[cron/birthdays] ${today.iso} · encontrados=${cumpleaneros.length} ` +
        `enviados=${sent} salteados=${skipped} errores=${errors.length}`,
    )

    return NextResponse.json(summary)
  } catch (err) {
    console.error('[cron/birthdays] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
