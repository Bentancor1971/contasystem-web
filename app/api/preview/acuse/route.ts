/**
 * POST /api/preview/acuse — vista previa del acuse de inscripción, SIN enviar.
 *
 * Lo pide el desktop (Eventos → Mails automáticos) para revisar el mail que la
 * web le manda a quien se inscribe antes de publicar el evento. Devuelve el
 * asunto y el HTML armados con el MISMO camino que el envío real
 * (`prepararAcuse` + `componerInscripcionEmail`): plantilla propia, modo solo
 * sorteo, número de sorteo con ceros y marca de la empresa incluidos.
 *
 * Auth: `x-api-key` de la empresa (la misma del tracking). El desktop llega por
 * el comando Rust `post_web_api`, cuya whitelist anti-SSRF nombra este path.
 * El evento tiene que ser de la empresa de la key o compartir su padrón.
 *
 * El evento se lee de `eventos_remoto`: es el de la última sincronización. Lo
 * que se editó en el desktop y no se subió todavía no aparece.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { empresaPorApiKey } from '@/lib/tracking'
import { loadEventoWebConfig } from '@/lib/evento-web-config'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { loadEmpresaBranding } from '@/lib/empresa-branding'
import { prepararAcuse, origenPublico } from '@/lib/evento-acuse'
import { componerInscripcionEmail } from '@/lib/mailer'
import { esSoloSorteo, type EventoRemoto, type ModalidadInscripcion } from '@/lib/eventos-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'Cache-Control': 'no-store' }

interface PersonaPreview {
  nombre?: string
  apellido?: string
  documento?: string
  categoria_nombre?: string | null
  tipo_participante?: 'socio' | 'no_socio'
  importe?: number
  moneda_codigo?: string | null
  lleva_transporte?: boolean
  transporte_importe?: number
  lleva_alimentacion?: boolean
  alimentacion_importe?: number
  alimentacion_tipo?: string | null
  numero?: string | null
  /** Ausente = se simula el primero del rango si la persona puede participar; null = no participa. */
  numero_sorteo?: number | null
  referencia_transferencia?: string | null
}

interface BodyPreview {
  evento_id?: string
  modalidad?: ModalidadInscripcion
  /** Copia del acuse de una inscripción ya confirmada (la que se reenvía). */
  confirmada?: boolean
  persona?: PersonaPreview
}

function error(status: number, mensaje: string) {
  return NextResponse.json({ ok: false, error: mensaje }, { status, headers: SIN_CACHE })
}

/** Padrón de una empresa según empresa_padron_remoto (ella misma si no hay fila). */
async function padronDe(admin: SupabaseClient, empresaId: string): Promise<string> {
  const { data } = await admin
    .from('empresa_padron_remoto')
    .select('padron_empresa_id')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  return ((data?.padron_empresa_id as string | null) ?? '').trim() || empresaId
}

export async function POST(req: Request) {
  const admin = createAdminClient()
  const empresa = await empresaPorApiKey(admin, req)
  if (!empresa) return error(401, 'API key no reconocida')

  let body: BodyPreview
  try {
    body = (await req.json()) as BodyPreview
  } catch {
    return error(400, 'Cuerpo inválido')
  }
  const eventoId = (body.evento_id ?? '').trim()
  if (!eventoId) return error(400, 'Falta evento_id')

  try {
    const { data: evRow, error: evErr } = await admin
      .from('eventos_remoto')
      .select('*')
      .eq('id', eventoId)
      .maybeSingle()
    if (evErr) throw new Error(evErr.message)
    const evento = evRow as EventoRemoto | null
    if (!evento) {
      return error(404, 'El evento no está en la web: sincronizá los eventos desde el desktop.')
    }
    if (evento.empresa_id !== empresa.empresa_id) {
      const [a, b] = await Promise.all([padronDe(admin, evento.empresa_id), padronDe(admin, empresa.empresa_id)])
      if (a !== b) return error(403, 'El evento es de otra empresa')
    }

    const [cfg, cuenta, marca] = await Promise.all([
      loadEventoWebConfig(admin, evento.id),
      loadGmailAccountForEmpresa(admin, evento.empresa_id),
      loadEmpresaBranding(admin, evento.empresa_id),
    ])

    const p = body.persona ?? {}
    const tipo = p.tipo_participante === 'no_socio' ? 'no_socio' : 'socio'
    const modalidad: ModalidadInscripcion = body.modalidad === 'pago_transferencia' ? 'pago_transferencia' : 'reserva'

    // Número de sorteo simulado: el primero del rango, con las mismas reglas de
    // elegibilidad que /inscribir (sorteo visible y, si es sólo para socios, socio).
    let numeroSorteo: number | null
    if (p.numero_sorteo !== undefined) {
      numeroSorteo = p.numero_sorteo
    } else {
      const visible = !!evento.sorteo_disponible && cfg.mostrar_sorteo
      const elegible = evento.sorteo_solo_socios === false || tipo === 'socio'
      numeroSorteo = visible && elegible ? Number(evento.sorteo_numero_desde ?? 0) : null
    }

    const avisos: string[] = []
    if (!cuenta) avisos.push('La empresa no tiene casilla Gmail configurada en la web: hoy este mail NO sale.')
    const soloSorteo = esSoloSorteo({
      marcado: evento.solo_sorteo === true,
      tipo: evento.tipo,
      sorteoVisible: !!evento.sorteo_disponible && cfg.mostrar_sorteo,
      transporteVisible: !!evento.transporte_disponible && cfg.mostrar_transporte,
      alimentacionVisible: !!evento.alimentacion_disponible && cfg.mostrar_alimentacion,
    })
    if (soloSorteo) avisos.push('Modo "sólo sorteo": registrarse es participar.')

    const { data, override } = prepararAcuse(
      {
        evento,
        cfg,
        documento: (p.documento ?? '').trim() || '1.234.567-8',
        nombre: (p.nombre ?? '').trim() || 'María',
        apellido: (p.apellido ?? '').trim() || 'Pérez',
        inscripcion: {
          numero: p.numero ?? 'INS-0001',
          categoria_nombre: p.categoria_nombre ?? null,
          tipo_participante: tipo,
          importe: Number(p.importe ?? 0),
          lleva_transporte: !!p.lleva_transporte,
          transporte_importe: Number(p.transporte_importe ?? 0),
          lleva_alimentacion: !!p.lleva_alimentacion,
          alimentacion_importe: Number(p.alimentacion_importe ?? 0),
          alimentacion_tipo: p.alimentacion_tipo ?? null,
          moneda_codigo: (p.moneda_codigo ?? '').trim() || evento.moneda_codigo || 'UYU',
          modalidad,
          estado: body.confirmada ? 'confirmado' : 'pendiente',
          referencia_transferencia: p.referencia_transferencia ?? null,
          numero_sorteo: numeroSorteo,
        },
        origen: origenPublico(req),
      },
      marca?.empresa ?? { nombre: cuenta?.fromName ?? empresa.nombre },
      null,
    )
    if (override.html) avisos.push('Usa la plantilla propia cargada en la web (Configuración → Eventos).')
    if (body.confirmada) {
      avisos.push('Si el evento emite entradas, el bloque con el QR no se muestra en la vista previa.')
    }

    const mail = componerInscripcionEmail(data, override, marca?.branding)
    return NextResponse.json(
      {
        ok: true,
        asunto: mail.subject,
        html: mail.html,
        text: mail.text,
        avisos,
        evento_actualizado: (evRow as Record<string, unknown>).row_updated_at ?? null,
      },
      { headers: SIN_CACHE },
    )
  } catch (err) {
    console.error('[preview/acuse]', err)
    return error(500, err instanceof Error ? err.message : 'Error armando la vista previa')
  }
}
