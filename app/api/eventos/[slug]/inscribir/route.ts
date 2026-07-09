/**
 * POST /api/eventos/[slug]/inscribir
 *   body: { documento, nombre, apellido?, mail?, telefono?, categoria_id }
 *
 * Endpoint PÚBLICO. Registra una inscripción en inscripciones_evento_remoto
 * (estado 'pendiente') para que el desktop la concilie. El tipo de participante
 * (socio/no_socio) y el importe se calculan server-side: NO se confía en el cliente.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  contarInscriptos,
  loadEventoRemotoBySlug,
  precioCategoria,
  resolverParticipante,
} from '@/lib/eventos'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  documento?: unknown
  nombre?: unknown
  apellido?: unknown
  mail?: unknown
  telefono?: unknown
  categoria_id?: unknown
  lleva_transporte?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

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
    const nombre = str(body.nombre)
    const apellido = str(body.apellido)
    const mail = str(body.mail)
    const telefono = str(body.telefono)
    const categoriaId = str(body.categoria_id)

    if (normalizeDocumento(documento).length < 6) {
      return NextResponse.json({ error: 'Ingresá una cédula válida' }, { status: 400 })
    }
    if (!nombre) {
      return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })
    }
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return NextResponse.json({ error: 'El email no es válido' }, { status: 400 })
    }

    const admin = createAdminClient()
    const evento = await loadEventoRemotoBySlug(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }
    if (evento.estado !== 'abierto') {
      return NextResponse.json({ error: 'Las inscripciones están cerradas' }, { status: 409 })
    }

    // Cupo global
    if (evento.cupo_maximo != null) {
      const inscriptos = await contarInscriptos(admin, evento.id)
      if (inscriptos >= evento.cupo_maximo) {
        return NextResponse.json({ error: 'Se completó el cupo del evento' }, { status: 409 })
      }
    }

    // Resolver participante (socio/no_socio según cuotas)
    const part = await resolverParticipante(admin, evento, documento)

    // Precio: en eventos con costo, exigimos categoría y precio definido
    let importe = 0
    let categoriaNombre: string | null = null
    if (evento.tipo === 'con_costo') {
      if (!categoriaId) {
        return NextResponse.json({ error: 'Elegí una categoría' }, { status: 400 })
      }
      const precio = await precioCategoria(admin, evento.id, categoriaId, part.tipo_participante)
      if (!precio) {
        return NextResponse.json(
          { error: 'La categoría no tiene precio para tu tipo de participante' },
          { status: 400 },
        )
      }
      importe = precio.importe
      categoriaNombre = precio.categoria_nombre
    }

    // Transporte (opcional): si el evento lo ofrece y la persona lo pidió.
    // El costo (si aplica) es diferenciado socio/no_socio.
    let llevaTransporte = false
    let transporteImporte = 0
    if (evento.transporte_disponible && body.lleva_transporte === true) {
      llevaTransporte = true
      if (evento.transporte_con_costo) {
        transporteImporte =
          part.tipo_participante === 'socio'
            ? Number(evento.transporte_importe_socio)
            : Number(evento.transporte_importe_no_socio)
      }
    }

    // Dedupe explícito + mensaje claro
    const documentoHash = hashDocumento(documento)
    const { data: ya } = await admin
      .from('inscripciones_evento_remoto')
      .select('id')
      .eq('evento_id', evento.id)
      .eq('documento_hash', documentoHash)
      .neq('estado', 'anulado')
      .limit(1)
      .maybeSingle()
    if (ya) {
      return NextResponse.json(
        { error: 'Esta cédula ya está inscripta a este evento' },
        { status: 409 },
      )
    }

    const { data: inserted, error: insErr } = await admin
      .from('inscripciones_evento_remoto')
      .insert({
        evento_id: evento.id,
        empresa_id: evento.empresa_id,
        categoria_id: categoriaId || null,
        categoria_nombre: categoriaNombre,
        tipo_participante: part.tipo_participante,
        socio_id: part.socio_id,
        documento: normalizeDocumento(documento),
        documento_hash: documentoHash,
        nombre,
        apellido: apellido || null,
        mail: mail || null,
        telefono: telefono || null,
        importe,
        moneda_codigo: evento.moneda_codigo,
        cuotas_pendientes: part.cuotas_pendientes,
        lleva_transporte: llevaTransporte,
        transporte_importe: transporteImporte,
        estado: 'pendiente',
      })
      .select('numero, importe, moneda_codigo, categoria_nombre, tipo_participante, lleva_transporte, transporte_importe')
      .single()

    if (insErr) {
      if (insErr.code === '23505') {
        return NextResponse.json(
          { error: 'Esta cédula ya está inscripta a este evento' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: `No se pudo registrar la inscripción: ${insErr.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      inscripcion: {
        numero: inserted.numero as string | null,
        categoria_nombre: inserted.categoria_nombre as string | null,
        importe: Number(inserted.importe),
        moneda_codigo: inserted.moneda_codigo as string,
        tipo_participante: inserted.tipo_participante as string,
        es_socio: part.encontrado,
        cuotas_pendientes: part.cuotas_pendientes,
        lleva_transporte: !!inserted.lleva_transporte,
        transporte_importe: Number(inserted.transporte_importe),
        total: Number(inserted.importe) + Number(inserted.transporte_importe),
      },
    })
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/inscribir] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
