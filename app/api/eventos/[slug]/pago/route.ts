/**
 * POST /api/eventos/[slug]/pago
 *   body: { documento, referencia, importe? }
 *
 * Endpoint PÚBLICO. Registra la DECLARACIÓN de pago por transferencia de una
 * inscripción ya existente (típicamente una reserva). No confirma nada: deja
 * una fila 'pendiente' en pagos_evento_remoto para que el desktop la concilie.
 *
 * Va a una tabla aparte a propósito: la inscripción original puede estar ya
 * 'importado' y el desktop no la vuelve a bajar (ver docs/supabase/28_pagos_evento.sql).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEventoRemotoBySlug } from '@/lib/eventos'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  documento?: unknown
  referencia?: unknown
  importe?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const MAX_REF = 80

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

    const documento = str(body.documento)
    const referencia = str(body.referencia)
    const importeRaw = body.importe

    if (normalizeDocumento(documento).length < 6) {
      return NextResponse.json({ error: 'Ingresá una cédula válida' }, { status: 400 })
    }
    if (!referencia) {
      return NextResponse.json(
        { error: 'Ingresá la referencia de la transferencia' },
        { status: 400 },
      )
    }
    if (referencia.length > MAX_REF) {
      return NextResponse.json(
        { error: `La referencia admite hasta ${MAX_REF} caracteres` },
        { status: 400 },
      )
    }

    let importeDeclarado: number | null = null
    if (importeRaw != null && importeRaw !== '') {
      const n = typeof importeRaw === 'number' ? importeRaw : Number(importeRaw)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'El importe no es válido' }, { status: 400 })
      }
      importeDeclarado = n
    }

    const admin = createAdminClient()

    // Tope por IP: el 404/200 de acá es un oráculo de asistencia.
    if (!(await permitido(admin, req, LIMITES.pago))) {
      return NextResponse.json(RESPUESTA_429, { status: 429 })
    }

    const evento = await loadEventoRemotoBySlug(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }

    const documentoHash = hashDocumento(documento)
    const { data: insc, error: inscErr } = await admin
      .from('inscripciones_evento_remoto')
      .select('id, numero, importe, transporte_importe, alimentacion_importe, moneda_codigo')
      .eq('evento_id', evento.id)
      .eq('documento_hash', documentoHash)
      .neq('estado', 'anulado')
      .limit(1)
      .maybeSingle()

    if (inscErr) {
      return NextResponse.json(
        { error: `Error buscando la inscripción: ${inscErr.message}` },
        { status: 500 },
      )
    }
    if (!insc) {
      return NextResponse.json(
        { error: 'No encontramos una inscripción con esa cédula en este evento' },
        { status: 404 },
      )
    }

    // Una sola declaración pendiente por inscripción: si ya hay una, se actualiza.
    const { data: yaPendiente } = await admin
      .from('pagos_evento_remoto')
      .select('id')
      .eq('inscripcion_id', insc.id)
      .eq('estado', 'pendiente')
      .limit(1)
      .maybeSingle()

    const fila = {
      inscripcion_id: insc.id as string,
      evento_id: evento.id,
      empresa_id: evento.empresa_id,
      documento_hash: documentoHash,
      referencia,
      importe_declarado: importeDeclarado,
      estado: 'pendiente',
    }

    const { error: saveErr } = yaPendiente
      ? await admin
          .from('pagos_evento_remoto')
          .update({ referencia, importe_declarado: importeDeclarado })
          .eq('id', yaPendiente.id)
      : await admin.from('pagos_evento_remoto').insert(fila)

    if (saveErr) {
      if (saveErr.code === '42P01') {
        return NextResponse.json(
          { error: 'Falta aplicar la migración 28_pagos_evento.sql en Supabase.' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: `No se pudo registrar el pago: ${saveErr.message}` },
        { status: 500 },
      )
    }

    const total =
      Number(insc.importe) +
      Number(insc.transporte_importe ?? 0) +
      Number(insc.alimentacion_importe ?? 0)

    return NextResponse.json({
      ok: true,
      actualizado: !!yaPendiente,
      numero: (insc.numero as string | null) ?? null,
      total,
      moneda_codigo: insc.moneda_codigo as string,
    })
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/pago] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
