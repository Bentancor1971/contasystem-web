/**
 * POST /api/eventos/[slug]/reenviar-acuse   body: { documento }
 *
 * Endpoint PÚBLICO. Reenvía una COPIA del comprobante de una inscripción ya
 * registrada. No recibe ni elige la casilla destino: se manda al mail que quedó
 * guardado en la inscripción (por eso no sirve para exfiltrar datos ni para
 * mandarle mails a un tercero: quien tipea la cédula no controla el destino).
 *
 * La respuesta sólo devuelve el mail ENMASCARADO, nunca en claro.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEventoRemotoBySlug, maskMail } from '@/lib/eventos'
import { loadEventoWebConfig } from '@/lib/evento-web-config'
import { enviarAcuseInscripcion } from '@/lib/evento-acuse'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import type { ModalidadInscripcion } from '@/lib/eventos-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  documento?: unknown
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const documentoRaw = typeof body.documento === 'string' ? body.documento : ''
    const documento = normalizeDocumento(documentoRaw)
    if (documento.length < 6) {
      return NextResponse.json({ error: 'Cédula inválida' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Tope por IP: cada envío es un mail real saliendo de la casilla de la
    // empresa. Sin esto, alguien podría usarlo para bombardear a un inscripto.
    if (!(await permitido(admin, req, LIMITES.reenviarAcuse))) {
      return NextResponse.json(RESPUESTA_429, { status: 429 })
    }

    const evento = await loadEventoRemotoBySlug(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }

    const { data: ins, error } = await admin
      .from('inscripciones_evento_remoto')
      .select('numero, estado, modalidad, categoria_nombre, tipo_participante, nombre, apellido, mail, importe, transporte_importe, alimentacion_importe, alimentacion_tipo, moneda_codigo, referencia_transferencia')
      .eq('evento_id', evento.id)
      .eq('documento_hash', hashDocumento(documentoRaw))
      .neq('estado', 'anulado')
      .limit(1)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: 'No se pudo buscar la inscripción' }, { status: 500 })
    }
    if (!ins) {
      return NextResponse.json(
        { error: 'No encontramos una inscripción con esa cédula' },
        { status: 404 },
      )
    }

    const destino = ((ins.mail as string | null) ?? '').trim()
    if (!destino) {
      return NextResponse.json(
        { error: 'Tu inscripción no tiene un correo registrado. Consultá con la organización.' },
        { status: 409 },
      )
    }

    const cfg = await loadEventoWebConfig(admin, evento.id)
    const acuse = await enviarAcuseInscripcion(admin, {
      evento,
      cfg,
      destino,
      documento,
      nombre: (ins.nombre as string | null) ?? '',
      apellido: (ins.apellido as string | null) ?? '',
      inscripcion: {
        numero: (ins.numero as string | null) ?? null,
        categoria_nombre: (ins.categoria_nombre as string | null) ?? null,
        tipo_participante: (ins.tipo_participante as 'socio' | 'no_socio') ?? 'no_socio',
        importe: Number(ins.importe ?? 0),
        transporte_importe: Number(ins.transporte_importe ?? 0),
        alimentacion_importe: Number(ins.alimentacion_importe ?? 0),
        alimentacion_tipo: (ins.alimentacion_tipo as string | null) ?? null,
        moneda_codigo: (ins.moneda_codigo as string | null) ?? evento.moneda_codigo,
        modalidad: ((ins.modalidad as ModalidadInscripcion | null) ?? 'reserva'),
        referencia_transferencia: (ins.referencia_transferencia as string | null) ?? null,
      },
      // El reenvío es una copia del comprobante: no propone cambios de ficha.
      cambios: [],
    })

    if (!acuse.ok) {
      if (acuse.motivo === 'sin_casilla') {
        return NextResponse.json(
          { error: 'La organización no tiene el envío de mails configurado.' },
          { status: 409 },
        )
      }
      console.error('[reenviar-acuse] falló:', acuse.error)
      return NextResponse.json({ error: 'No se pudo enviar la copia' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, mail_mask: maskMail(destino) })
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/reenviar-acuse] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
