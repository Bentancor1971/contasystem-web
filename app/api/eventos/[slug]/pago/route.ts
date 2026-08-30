/**
 * POST /api/eventos/[slug]/pago
 *   body: { documento, referencia, numero? }
 *
 * Endpoint PÚBLICO. Registra la DECLARACIÓN de pago por transferencia de una
 * inscripción ya existente (típicamente una reserva). No confirma nada: deja
 * una fila 'pendiente' en pagos_evento_remoto para que el desktop la concilie.
 *
 * Va a una tabla aparte a propósito: la inscripción original puede estar ya
 * 'importado' y el desktop no la vuelve a bajar (ver docs/supabase/28_pagos_evento.sql).
 */

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEventoRemotoBySlug, maskMail } from '@/lib/eventos'
import { loadEventoWebConfig } from '@/lib/evento-web-config'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
import { enviarAcuseInscripcion } from '@/lib/evento-acuse'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import type { EstadoInscripcionRemota, ModalidadInscripcion } from '@/lib/eventos-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  documento?: unknown
  referencia?: unknown
  /**
   * N° de inscripción (INS-xxxx) de SU acuse. Sólo se exige cuando ya hay una
   * declaración pendiente para esta inscripción (ver E10 más abajo): la cédula
   * sola es un dato semipúblico y no alcanza para probar que quien pide el
   * cambio es la misma persona.
   */
  numero?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const MAX_REF = 80

/** Estados de inscripción para los que declarar un pago nuevo tiene sentido. */
const ESTADOS_CON_PAGO_PENDIENTE = new Set(['pendiente', 'importado'])

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

    // E20/E10: el importe nunca lo manda la UI — si viene, es un body armado a
    // mano (o un bug), y aceptarlo dejaba pisar la referencia real de alguien
    // con un importe inventado. Se rechaza en vez de ignorarlo en silencio.
    if ('importe' in (body as Record<string, unknown>)) {
      return NextResponse.json(
        { error: 'No corresponde declarar un importe: se calcula con tu inscripción.' },
        { status: 400 },
      )
    }

    const documento = str(body.documento)
    const referencia = str(body.referencia)
    const numeroDeclarado = str(body.numero)

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

    const admin = createAdminClient()

    // Tope por IP: el 404/200 de acá es un oráculo de asistencia.
    if (!(await permitido(admin, req, LIMITES.pago))) {
      return NextResponse.json(RESPUESTA_429, { status: 429 })
    }

    const evento = await loadEventoRemotoBySlug(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }
    // `loadEventoRemotoBySlug` ya filtra 'anulado' (da 404 antes de llegar acá);
    // esto es sólo defensa en profundidad si ese filtro cambiara algún día. A
    // propósito NO se exige 'abierto': declarar el pago de una preinscripción
    // que ya se hizo tiene que seguir andando con el evento cerrado (U3) — quien
    // ya tiene lugar reservado no pierde el derecho a pagarlo.
    if (evento.estado === 'anulado') {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }

    const documentoHash = hashDocumento(documento)
    const { data: insc, error: inscErr } = await admin
      .from('inscripciones_evento_remoto')
      .select('id, numero, estado, modalidad, importe, lleva_transporte, transporte_importe, lleva_alimentacion, alimentacion_importe, moneda_codigo, nombre, apellido, mail, categoria_nombre, tipo_participante, alimentacion_tipo, numero_sorteo')
      .eq('evento_id', evento.id)
      .eq('documento_hash', documentoHash)
      .neq('estado', 'anulado')
      .limit(1)
      .maybeSingle()

    if (inscErr) {
      console.error('[pago] error buscando la inscripción:', inscErr)
      return NextResponse.json(
        { error: 'No se pudo buscar tu inscripción. Reintentá en unos segundos.' },
        { status: 503 },
      )
    }
    if (!insc) {
      return NextResponse.json(
        { error: 'No encontramos una inscripción con esa cédula en este evento' },
        { status: 404 },
      )
    }

    // E10/E1: sólo tiene sentido declarar un pago NUEVO para una reserva que
    // sigue sin resolverse. Una inscripción que ya declaró pago al inscribirse
    // (modalidad 'pago_transferencia'), que la organización ya confirmó
    // ('confirmado') o rechazó ('rechazado') no acepta otra declaración acá.
    const modalidadInsc = (insc.modalidad as ModalidadInscripcion | null) ?? 'reserva'
    const estadoInsc = (insc.estado as EstadoInscripcionRemota | null) ?? 'pendiente'
    if (modalidadInsc !== 'reserva' || !ESTADOS_CON_PAGO_PENDIENTE.has(estadoInsc)) {
      const motivo =
        estadoInsc === 'confirmado'
          ? 'Tu inscripción ya está confirmada por la organización. No tenés que registrar ningún pago.'
          : estadoInsc === 'rechazado'
            ? 'La organización rechazó esta inscripción. Comunicate con ellos para regularizar tu situación.'
            : 'Ya declaraste el pago de esta inscripción. La organización lo va a verificar contra el movimiento bancario.'
      return NextResponse.json({ error: motivo }, { status: 409 })
    }

    // La moneda del pago es SIEMPRE la de la inscripción: acá no se elige nada.
    // Se paga en la moneda del precio, y el desktop bloquea la conciliación si
    // el pago declarado no coincide con la inscripción.
    const monedaPago = (insc.moneda_codigo as string | null) ?? evento.moneda_codigo

    const filaNueva = {
      inscripcion_id: insc.id as string,
      evento_id: evento.id,
      empresa_id: evento.empresa_id,
      documento_hash: documentoHash,
      referencia,
      importe_declarado: null,
      moneda_codigo: monedaPago,
      estado: 'pendiente',
    }

    // E10: siempre se intenta INSERTAR (nunca un SELECT-luego-decido: esa
    // ventana es justo la carrera que dejaba pisar la declaración de un
    // tercero). `idx_pagos_evento_remoto_una_pendiente` (28_pagos_evento.sql)
    // es quien de verdad decide si ya había una pendiente.
    let actualizado = false
    const { error: insertErr } = await admin.from('pagos_evento_remoto').insert(filaNueva)
    if (insertErr) {
      if (insertErr.code === '23505') {
        // Ya había una declaración pendiente para esta inscripción. Actualizarla
        // exige probar que quien pide el cambio conoce el N° de SU inscripción
        // (viene en su acuse/mail) — la cédula sola es un dato semipúblico y
        // cualquiera que la supiera podía hasta ahora borrar la referencia real
        // con una inventada.
        if (!insc.numero || numeroDeclarado !== insc.numero) {
          return NextResponse.json(
            {
              error:
                'Ya hay una declaración de pago para esta inscripción. Indicá el N° de inscripción de tu acuse para actualizarla.',
            },
            { status: 409 },
          )
        }
        const { error: updateErr } = await admin
          .from('pagos_evento_remoto')
          .update({ referencia, moneda_codigo: monedaPago })
          .eq('inscripcion_id', insc.id)
          .eq('estado', 'pendiente')
        if (updateErr) {
          console.error('[pago] no se pudo actualizar la declaración:', updateErr)
          return NextResponse.json(
            { error: 'No se pudo actualizar tu declaración de pago. Reintentá en unos segundos.' },
            { status: 503 },
          )
        }
        actualizado = true
      } else if (insertErr.code === '42P01') {
        return NextResponse.json(
          { error: 'Falta aplicar la migración 28_pagos_evento.sql en Supabase.' },
          { status: 409 },
        )
      } else {
        console.error('[pago] no se pudo registrar el pago:', insertErr)
        return NextResponse.json(
          { error: 'No se pudo registrar tu declaración de pago. Reintentá en unos segundos.' },
          { status: 503 },
        )
      }
    }

    const total =
      Number(insc.importe) +
      Number(insc.transporte_importe ?? 0) +
      Number(insc.alimentacion_importe ?? 0)

    // ── Acuse por email. Va al mail que la persona dejó en su inscripción: acá
    //    no elige destino, así que esto no sirve para mandarle mails a un
    //    tercero (mismo criterio que /reenviar-acuse). Se arma como PAGO
    //    DECLARADO (con la referencia recién registrada), no como la reserva
    //    original: es lo que la persona acaba de hacer.
    //
    //    `after()` (P1/E9): el SMTP no tiene por qué demorar la respuesta — la
    //    declaración ya quedó guardada. `mail_mask` se resuelve ANTES de
    //    responder con una consulta liviana (¿hay casilla configurada?).
    const destino = ((insc.mail as string | null) ?? '').trim()
    const casillaAcuse = destino ? await loadGmailAccountForEmpresa(admin, evento.empresa_id) : null
    const mailMask = casillaAcuse && destino ? maskMail(destino) : null

    if (destino && casillaAcuse) {
      const cfg = await loadEventoWebConfig(admin, evento.id)
      after(() =>
        enviarAcuseInscripcion(admin, {
          evento,
          cfg,
          destino,
          documento: normalizeDocumento(documento),
          nombre: (insc.nombre as string | null) ?? '',
          apellido: (insc.apellido as string | null) ?? '',
          inscripcion: {
            numero: (insc.numero as string | null) ?? null,
            categoria_nombre: (insc.categoria_nombre as string | null) ?? null,
            tipo_participante: (insc.tipo_participante as 'socio' | 'no_socio') ?? 'no_socio',
            importe: Number(insc.importe ?? 0),
            lleva_transporte: !!insc.lleva_transporte,
            transporte_importe: Number(insc.transporte_importe ?? 0),
            lleva_alimentacion: !!insc.lleva_alimentacion,
            alimentacion_importe: Number(insc.alimentacion_importe ?? 0),
            alimentacion_tipo: (insc.alimentacion_tipo as string | null) ?? null,
            moneda_codigo: monedaPago,
            modalidad: 'pago_transferencia',
            // A propósito sin `estado`: este mail acusa el pago que la persona
            // ACABA de declarar y que todavía hay que conciliar. Aunque la
            // inscripción original ya esté 'importado' (pasa: ver la cabecera de
            // este archivo), la declaración nueva no está verificada, así que no
            // corresponde el comprobante de "inscripción confirmada".
            referencia_transferencia: referencia,
            // El número se asignó al inscribirse; declarar el pago no lo cambia.
            // Se repite en este acuse para que la copia más reciente lo tenga.
            numero_sorteo: insc.numero_sorteo == null ? null : Number(insc.numero_sorteo),
          },
          cambios: [],
        }).then((acuse) => {
          if (!acuse.ok && acuse.motivo === 'error') {
            console.error('[pago] acuse no enviado:', acuse.error)
          }
        }),
      )
    }

    return NextResponse.json({
      ok: true,
      actualizado,
      numero: (insc.numero as string | null) ?? null,
      total,
      moneda_codigo: monedaPago,
      // Mail ENMASCARADO al que VA a salir el acuse (o null si no hay casilla o
      // no hay mail en la inscripción): la UI no promete un envío que no sabe si
      // va a ocurrir, pero tampoco espera al SMTP para contestar.
      mail_mask: mailMask,
    })
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/pago] error:', err)
    return NextResponse.json(
      { error: 'No se pudo registrar tu pago. Reintentá en unos segundos.' },
      { status: 503 },
    )
  }
}
