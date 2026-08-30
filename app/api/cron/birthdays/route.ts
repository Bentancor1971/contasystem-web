/**
 * GET /api/cron/birthdays
 *
 * Disparado por Vercel Cron DOS veces por día (ver vercel.json: 11:00 y
 * 11:30 UTC = 08:00 y 08:30 Montevideo). Detecta los socios que cumplen años
 * hoy y les envía un saludo desde la casilla Gmail de su empresa. La segunda
 * corrida existe para terminar lo que la primera dejó pendiente por el
 * presupuesto de tiempo (ver `has_more` abajo); si la primera terminó todo,
 * la segunda no reenvía nada (idempotencia).
 *
 * Seguridad   · exige header  Authorization: Bearer <CRON_SECRET>, comparado
 *               en tiempo constante (`secretoValido`).
 * Envío       · en tandas de BATCH_SIZE en paralelo, cortando a los
 *               TIME_BUDGET_MS para no pisar `maxDuration`.
 * Idempotencia· un socio recibe a lo sumo un mail por fecha (tabla
 *               birthday_email_logs, unique socio_id + fecha_cumpleanos).
 * Zona horaria· "hoy" se calcula en America/Montevideo, no en UTC.
 *
 * Respuesta   · { ok, fecha, found, sent, skipped, errors[], has_more } —
 *               `has_more: true` si se cortó por tiempo antes de procesar
 *               todos los candidatos de `found`.
 *
 * Tabla de personas: `socios_datos` (no `personas`). Campos usados:
 *   id, nombre, apellido, mail, fecha_nacimiento (TEXT ISO), empresa_id (TEXT).
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBirthdayEmail, type SendResult } from '@/lib/mailer'
import {
  loadActiveEmpresas,
  esEstadoActivo,
  type ActiveEmpresa,
} from '@/lib/birthday-template-store'

// Nodemailer necesita el runtime Node (sockets TCP/TLS), no Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cuántos mails se mandan EN PARALELO (E23). Antes era un `for` secuencial:
 * con SMTP a Gmail (1-3 s por mail, sin pool — ver lib/mailer.ts) un día con
 * 40 cumpleañeros tardaba más de un minuto y corría el riesgo real de pisar
 * `maxDuration`. 4 a la vez es un compromiso entre velocidad y no gatillar el
 * límite de envíos por segundo de Gmail.
 */
const BATCH_SIZE = 4

/**
 * Presupuesto de tiempo propio, por debajo de `maxDuration` (60 s): si se
 * corta acá en vez de que Vercel mate la función a los 60 s, el resumen sale
 * completo (`has_more`) y el log de Vercel no queda con un request colgado.
 * Lo que quede sin procesar lo termina la SEGUNDA corrida del día
 * (`vercel.json`, 11:30 UTC) — la idempotencia de `birthday_email_logs`
 * (unique socio_id + fecha) hace que no se reenvíe nada de lo ya hecho acá.
 */
const TIME_BUDGET_MS = 45_000

/**
 * Compara el secreto del cron en tiempo constante. Con `!==` la comparación
 * de strings corta apenas difiere el primer byte, así que el tiempo de
 * respuesta filtra de a poco cuántos caracteres iniciales acertó un atacante
 * (timing attack). `timingSafeEqual` exige buffers del mismo largo — con
 * largos distintos ya sabemos que no matchea, sin necesidad de comparar byte
 * a byte (y sin filtrar el largo real: se compara igual contra sí mismo).
 */
function secretoValido(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface SocioRow {
  id: string
  nombre: string | null
  apellido: string | null
  mail: string | null
  fecha_nacimiento: string | null
  empresa_id: string | null
  estado_registro_nombre: string | null
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

/**
 * Patrones `LIKE` para filtrar `fecha_nacimiento` (TEXT ISO `YYYY-MM-DD`) en
 * SQL en vez de traer TODOS los socios con mail de las empresas activas y
 * filtrar mes/día en JS (E23) — con varios miles de socios por empresa, eso
 * era la mayoría de las filas leídas tiradas a la basura en cada corrida.
 * `_` es el comodín de un solo carácter en Postgres, así que
 * `____-MM-DD` matchea el año (4 dígitos, cualquiera) y exige mes/día exactos
 * — un valor con formato distinto o largo distinto no matchea ninguno.
 *
 * Caso 29-feb: en años no bisiestos se saluda el 28-feb, así que ese día
 * también se agrega el patrón del 29-feb (mismo criterio que
 * `admin/socios/route.ts` usa para el filtro por mes).
 */
function patronesCumpleHoy(today: MontevideoToday): string[] {
  const mm = String(today.month).padStart(2, '0')
  const dd = String(today.day).padStart(2, '0')
  const patrones = [`fecha_nacimiento.like.____-${mm}-${dd}`]
  if (today.month === 2 && today.day === 28 && !isLeapYear(today.year)) {
    patrones.push('fecha_nacimiento.like.____-02-29')
  }
  return patrones
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

/**
 * Direcciones que pidieron no recibir, como claves `empresa_id|mail`.
 *
 * El set lo publica el desktop de forma atómica en cada sync: lo que no está en
 * `bajas_mails_remoto` es que no está dado de baja. Por eso una REVOCACIÓN
 * también se propaga sola, sin ningún borrado explícito.
 *
 * `categoria` no se mira: un saludo de cumpleaños es difusión, así que tanto
 * 'difusion' como 'total' lo bloquean.
 *
 * Si la consulta falla se devuelve un set VACÍO y el cron sigue. Es una
 * decisión incómoda y vale explicitarla: cortar el saludo de todos por un error
 * de base es peor que mandarle a alguien que se dio de baja, pero el error
 * queda logeado para que se vea.
 */
async function loadBajas(
  admin: SupabaseClient,
  empresaIds: string[],
): Promise<Set<string>> {
  if (empresaIds.length === 0) return new Set()
  const { data, error } = await admin
    .from('bajas_mails_remoto')
    .select('empresa_id, mail')
    .in('empresa_id', empresaIds)
  if (error) {
    console.error('[cron/birthdays] error consultando bajas:', error.message)
    return new Set()
  }
  return new Set(
    (data ?? []).map((b) => `${b.empresa_id as string}|${(b.mail as string).trim().toLowerCase()}`),
  )
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
  const recibido = req.headers.get('authorization') ?? ''
  if (!secretoValido(recibido, `Bearer ${cronSecret}`)) {
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
    //  - mail no nulo → sin mail no hay nada que hacer
    //  - fecha_nacimiento filtrada en SQL por mes/día de HOY (E23): antes se
    //    traían todos los socios con mail de las empresas activas (miles de
    //    filas en una base grande) para descartar casi todos en JS.
    const { data: sociosData, error: sociosErr } = await admin
      .from('socios_datos')
      .select(
        'id, nombre, apellido, mail, fecha_nacimiento, empresa_id, estado_registro_nombre',
      )
      .in('empresa_id', empresaIds)
      .is('deleted_at', null)
      .not('mail', 'is', null)
      .or(patronesCumpleHoy(today).join(','))

    if (sociosErr) {
      console.error('[cron/birthdays] error consultando socios:', sociosErr.message)
      return NextResponse.json(
        { ok: false, error: `Error consultando socios: ${sociosErr.message}` },
        { status: 500 },
      )
    }

    const cumpleaneros = (sociosData ?? []) as SocioRow[]

    // ── 4b) Bajas: quién pidió no recibir ──────────────────────────────
    // El saludo de cumpleaños es el ÚNICO envío del sistema que no sale del
    // desktop, así que es el único que no pasa por su índice de bajas. El set
    // lo publica el desktop en `bajas_mails_remoto` (ver el opt-out del repo
    // desktop, docs/opt-out-propuesta.md). Sin este filtro, la persona que se
    // dio de baja desde el pie de un mail seguiría recibiendo el saludo — y la
    // única salida que le queda es el botón "Spam".
    //
    // Se compara por dirección normalizada, no por socio: la baja es del mail,
    // porque una casilla puede estar en varias fichas.
    const bajas = await loadBajas(admin, empresaIds)

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

    // ── 6) Enviar y logear, en tandas de BATCH_SIZE en paralelo ────────
    let sent = 0
    let skipped = 0
    const errors: { socio_id: string; mail: string; error: string }[] = []
    const inicio = Date.now()
    let hasMore = false

    /** Procesa un socio: filtros de skip, envío y log. No lanza. */
    async function procesarUno(socio: SocioRow): Promise<void> {
      // Ya saludado hoy (re-ejecución del cron) → no reenviar.
      if (yaEnviados.has(socio.id)) {
        skipped++
        return
      }

      const mail = (socio.mail ?? '').trim()
      const empresaId = socio.empresa_id
      if (!mail || !empresaId) {
        skipped++
        return
      }

      // Pidió no recibir. No se logea como error ni se reintenta: no es una
      // falla, es la decisión de la persona.
      if (bajas.has(`${empresaId}|${mail.toLowerCase()}`)) {
        skipped++
        return
      }

      const data: ActiveEmpresa | undefined = empresasActivas.get(empresaId)
      if (!data) {
        // La empresa dejó de estar activa entre consultas — saltear.
        skipped++
        return
      }

      // Filtro por estado: si la empresa configuró "solo activos" y este
      // socio no está marcado como Activo, no se le manda saludo.
      if (data.soloActivos && !esEstadoActivo(socio.estado_registro_nombre)) {
        skipped++
        return
      }

      let result: SendResult
      if (!data.cuenta) {
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

    for (let i = 0; i < cumpleaneros.length; i += BATCH_SIZE) {
      if (Date.now() - inicio > TIME_BUDGET_MS) {
        // Se corta ACÁ, antes que Vercel mate la función a los 60 s. Lo que
        // queda sin tocar lo recoge la segunda corrida del día (11:30 UTC,
        // ver vercel.json) — es idempotente contra `birthday_email_logs`.
        hasMore = true
        break
      }
      const tanda = cumpleaneros.slice(i, i + BATCH_SIZE)
      // allSettled, no all: un mail que tira una excepción no debe abortar
      // el resto de la tanda (procesarUno ya atrapa los rechazos de Gmail
      // adentro de `result`, pero no descartamos un error inesperado).
      const resultados = await Promise.allSettled(tanda.map(procesarUno))
      for (const r of resultados) {
        if (r.status === 'rejected') {
          console.error('[cron/birthdays] fallo inesperado procesando un socio:', r.reason)
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
      has_more: hasMore,
    }

    console.log(
      `[cron/birthdays] ${today.iso} · encontrados=${cumpleaneros.length} ` +
        `enviados=${sent} salteados=${skipped} errores=${errors.length}` +
        (hasMore ? ' · CORTADO POR TIEMPO (has_more) — lo termina la corrida de las 11:30 UTC' : ''),
    )

    return NextResponse.json(summary)
  } catch (err) {
    console.error('[cron/birthdays] error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
