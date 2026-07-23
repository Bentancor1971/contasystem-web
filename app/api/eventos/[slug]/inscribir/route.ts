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
  contarConTransporte,
  contarInscriptos,
  loadEventoRemotoBySlug,
  nombreCategoriaSocio,
  parseOpcionesAlimentacion,
  precioCategoria,
  precioMaximoCategoria,
  proximoNumeroSorteo,
  resolverParticipante,
} from '@/lib/eventos'
import { ALIMENTACION_SIN_RESTRICCION, elegibleParaSorteo } from '@/lib/eventos-types'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'
import { esCedulaUruguayaValida } from '@/lib/cedula'
import { loadEventoWebConfig } from '@/lib/evento-web-config'
import { enviarAcuseInscripcion, origenPublico } from '@/lib/evento-acuse'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import type { CambioDato } from '@/lib/recibo-evento-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  documento?: unknown
  nombre?: unknown
  apellido?: unknown
  mail?: unknown
  telefono?: unknown
  categoria_id?: unknown
  /** Categoría escrita a mano por el participante cuando elige "Otros". */
  categoria_otros?: unknown
  lleva_transporte?: unknown
  /** Referencia de transferencia, si la persona ya transfirió al inscribirse. */
  referencia_transferencia?: unknown
  lleva_alimentacion?: unknown
  /** Tipo de alimentación elegido (de las opciones o "Otros" a mano). */
  alimentacion_tipo?: unknown
  /** Opt-in al sorteo del evento. La elegibilidad se re-decide server-side. */
  participa_sorteo?: unknown
  modalidad?: unknown
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
    let nombre = str(body.nombre)
    let apellido = str(body.apellido)
    let mail = str(body.mail)
    let telefono = str(body.telefono)
    const categoriaId = str(body.categoria_id)
    const categoriaOtros = str(body.categoria_otros)
    // Modalidad: reserva de cupo (default) o pago declarado por transferencia.
    // Sólo tiene sentido "pago_transferencia" si el evento tiene datos de depósito.
    const modalidad =
      body.modalidad === 'pago_transferencia' ? 'pago_transferencia' : 'reserva'

    if (normalizeDocumento(documento).length < 6) {
      return NextResponse.json({ error: 'Ingresá una cédula válida' }, { status: 400 })
    }
    // El nombre se exige más abajo, DESPUÉS de resolver la cédula: si es un socio
    // en la base, se completa desde su ficha y no hace falta que lo re-escriba.
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return NextResponse.json({ error: 'El email no es válido' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Tope por IP: el 409 "ya está inscripta" es un oráculo de asistencia.
    if (!(await permitido(admin, req, LIMITES.inscribir))) {
      return NextResponse.json(RESPUESTA_429, { status: 429 })
    }

    const evento = await loadEventoRemotoBySlug(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }
    if (evento.estado !== 'abierto') {
      return NextResponse.json({ error: 'Las inscripciones están cerradas' }, { status: 409 })
    }

    // Config web del evento. NO se confía en el cliente: los campos ocultos se
    // descartan y los obligatorios se exigen acá.
    const cfg = await loadEventoWebConfig(admin, evento.id)
    if (!cfg.mostrar_apellido) apellido = ''
    if (!cfg.mostrar_email) mail = ''
    if (!cfg.mostrar_telefono) telefono = ''
    // Los obligatorios NO se exigen todavía: un socio deja apellido/email/teléfono
    // vacíos a propósito (en el formulario ve el dato enmascarado de su ficha) y
    // los completamos más abajo desde esa ficha. Exigirlos acá —antes de resolver
    // la cédula— rechazaría a un socio cuyo dato ya tenemos. Se validan después
    // del relleno, igual que el nombre.

    // En eventos con costo la categoría define el precio: siempre se exige.
    const categoriaVisible = evento.tipo === 'con_costo' || cfg.mostrar_categoria
    // "Otros" = categoría libre escrita por el participante (sin categoria_id).
    const esOtros = !categoriaId && categoriaOtros.length > 0 && cfg.permitir_categoria_otros
    if (categoriaOtros && !cfg.permitir_categoria_otros) {
      return NextResponse.json(
        { error: 'Este evento no admite categorías libres' },
        { status: 400 },
      )
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

    // Cédula válida: se exige SÓLO a quien no está en el padrón. A los que ya
    // están se los deja pasar aunque su documento no verifique (hay documentos
    // históricos que no cumplen el DV; ver lib/cedula). Así atajamos el error de
    // tipeo del que se registra por primera vez sin dejar afuera a un socio.
    if (!part.encontrado && !esCedulaUruguayaValida(documento)) {
      return NextResponse.json(
        {
          error:
            'La cédula no es válida. Revisá el número; si tu documento no es una cédula uruguaya, escribinos.',
        },
        { status: 400 },
      )
    }

    // El formulario ya no pre-rellena los datos del socio (el lookup público no
    // los entrega, ver ResolucionPublica). Por eso un campo vacío significa "no
    // lo escribió", NO "borralo": lo completamos desde la ficha para no
    // proponerle al contador un cambio que le vacíe datos al socio. El nombre
    // también: un socio verificado no necesita re-escribirlo.
    if (part.encontrado) {
      if (!nombre) nombre = part.nombre
      if (!apellido) apellido = part.apellido
      if (!mail) mail = part.mail
      if (!telefono) telefono = part.telefono
    }

    // Recién ahora exigimos los datos obligatorios: para un socio ya vienen de la
    // ficha (completados arriba); para alguien que no está en la base, siguen
    // siendo obligatorios y hay que escribirlos.
    if (!nombre) {
      return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })
    }
    if (cfg.mostrar_apellido && cfg.apellido_obligatorio && !apellido) {
      return NextResponse.json({ error: 'El apellido es obligatorio' }, { status: 400 })
    }
    if (cfg.mostrar_email && cfg.email_obligatorio && !mail) {
      return NextResponse.json({ error: 'El email es obligatorio' }, { status: 400 })
    }
    // Teléfono: obligatorio para todos cuando el campo se muestra. Si es un socio
    // con teléfono en la ficha ya se completó arriba; si no lo tenemos, hay que
    // pedirlo sí o sí (es un dato de contacto que queremos siempre).
    if (cfg.mostrar_telefono && !telefono) {
      return NextResponse.json({ error: 'El teléfono es obligatorio' }, { status: 400 })
    }

    // Categoría (obligatoria): predefinida del catálogo o libre ("Otros").
    //   - con costo: la categoría fija el importe. "Otros" toma la tarifa más
    //     alta del evento como referencia (categoría no prevista).
    //   - sin costo: la categoría es sólo clasificación; el importe es 0.
    let importe = 0
    let categoriaNombre: string | null = null
    let categoriaIdFinal: string | null = categoriaId || null

    if (categoriaVisible && !categoriaId && !esOtros) {
      return NextResponse.json({ error: 'Elegí una categoría' }, { status: 400 })
    }

    if (!categoriaVisible) {
      // Categoría oculta por config (sólo posible en eventos sin costo).
      categoriaIdFinal = null
    } else if (evento.tipo === 'con_costo') {
      if (esOtros) {
        const max = await precioMaximoCategoria(admin, evento.id, part.tipo_participante)
        if (max == null) {
          return NextResponse.json(
            { error: 'El evento no tiene tarifas definidas para tu tipo de participante' },
            { status: 400 },
          )
        }
        importe = max
        categoriaNombre = categoriaOtros
        categoriaIdFinal = null
      } else {
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
    } else {
      // Sin costo: sólo clasificación (importe 0).
      if (esOtros) {
        categoriaNombre = categoriaOtros
        categoriaIdFinal = null
      } else {
        const nombre = await nombreCategoriaSocio(admin, evento.empresa_id, categoriaId)
        if (!nombre) {
          return NextResponse.json({ error: 'Categoría no válida' }, { status: 400 })
        }
        categoriaNombre = nombre
        categoriaIdFinal = categoriaId
      }
    }

    // Transporte (opcional): si el evento lo ofrece y la persona lo pidió.
    // El costo (si aplica) es diferenciado socio/no_socio.
    let llevaTransporte = false
    let transporteImporte = 0
    if (evento.transporte_disponible && cfg.mostrar_transporte && body.lleva_transporte === true) {
      // Cupo de transporte: si tiene tope y ya se llenó, se rechaza (la persona
      // puede reintentar sin transporte). Mismo criterio que el cupo del evento.
      if (evento.transporte_cupo_maximo != null) {
        const conTransporte = await contarConTransporte(admin, evento.id)
        if (conTransporte >= evento.transporte_cupo_maximo) {
          return NextResponse.json(
            { error: 'Se completó el cupo de transporte' },
            { status: 409 },
          )
        }
      }
      llevaTransporte = true
      if (evento.transporte_con_costo) {
        transporteImporte =
          part.tipo_participante === 'socio'
            ? Number(evento.transporte_importe_socio)
            : Number(evento.transporte_importe_no_socio)
      }
    }

    // Alimentación (opcional): espejo de transporte + tipo elegido. El tipo NO es
    // obligatorio: si el evento ofrece opciones y la persona no eligió ninguna,
    // vale el default ("Sin restricción", el mismo que el form trae preseleccionado).
    let llevaAlimentacion = false
    let alimentacionImporte = 0
    let alimentacionTipo: string | null = null
    if (evento.alimentacion_disponible && cfg.mostrar_alimentacion && body.lleva_alimentacion === true) {
      llevaAlimentacion = true
      const opciones = parseOpcionesAlimentacion(evento.alimentacion_opciones)
      const tipoElegido = str(body.alimentacion_tipo)
      alimentacionTipo =
        tipoElegido || (opciones.length > 0 ? ALIMENTACION_SIN_RESTRICCION : null)
      if (evento.alimentacion_con_costo) {
        alimentacionImporte =
          part.tipo_participante === 'socio'
            ? Number(evento.alimentacion_importe_socio)
            : Number(evento.alimentacion_importe_no_socio)
      }
    }

    // Sorteo (opcional, opt-in): sólo si el evento lo tiene, la config web no lo
    // oculta, la persona lo pidió y es elegible. La elegibilidad se re-decide acá
    // contra el tipo de participante resuelto server-side: el flag del body no se
    // confía (mismo criterio que el importe).
    //
    // El número NO se asigna todavía: se resuelve junto al insert, porque dos
    // inscripciones simultáneas pueden calcular el mismo y hay que reintentar.
    const participaSorteo =
      body.participa_sorteo === true &&
      elegibleParaSorteo(
        {
          disponible: !!evento.sorteo_disponible && cfg.mostrar_sorteo,
          // Default TRUE si viene null (eventos previos a la migración 31).
          solo_socios: evento.sorteo_solo_socios !== false,
        },
        part.tipo_participante,
      )

    // Modalidad efectiva: "pago_transferencia" (= "pago realizado") sólo si el
    // evento habilita esa modalidad, la config web la permite, publica datos de
    // depósito y hay algo para pagar; si no, es una preinscripción (reserva de
    // cupo).
    const totalAPagar = importe + transporteImporte + alimentacionImporte
    const modalidadFinal =
      modalidad === 'pago_transferencia' &&
      evento.permitir_pago_realizado &&
      cfg.permitir_pago_transferencia &&
      !!evento.datos_deposito &&
      totalAPagar > 0
        ? 'pago_transferencia'
        : 'reserva'

    // "Pago realizado" exige la referencia de la transferencia declarada.
    const referencia =
      modalidadFinal === 'pago_transferencia'
        ? str(body.referencia_transferencia).slice(0, 80)
        : ''
    if (modalidadFinal === 'pago_transferencia' && !referencia) {
      return NextResponse.json(
        { error: 'Ingresá la referencia de la transferencia' },
        { status: 400 },
      )
    }
    // 'pagado' = declaró pago al inscribirse (pendiente de que el operador lo
    // confirme). 'pendiente' = preinscripción. Ver docs/supabase/29.
    const estadoInicial = modalidadFinal === 'pago_transferencia' ? 'pagado' : 'pendiente'

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

    const filaBase = {
      evento_id: evento.id,
      empresa_id: evento.empresa_id,
      categoria_id: categoriaIdFinal,
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
      lleva_alimentacion: llevaAlimentacion,
      alimentacion_importe: alimentacionImporte,
      alimentacion_tipo: alimentacionTipo,
      modalidad: modalidadFinal,
      // Sólo tiene sentido si efectivamente declaró pago por transferencia.
      referencia_transferencia: referencia || null,
      estado: estadoInicial,
    }
    const COLUMNAS_INSERTADAS =
      'numero, importe, moneda_codigo, categoria_nombre, tipo_participante, lleva_transporte, transporte_importe, lleva_alimentacion, alimentacion_importe, alimentacion_tipo, modalidad, participa_sorteo, numero_sorteo'

    // Desde la migración 31 hay DOS índices únicos sobre esta tabla y ambos
    // devuelven 23505: el de (evento_id, documento_hash) —cédula repetida, error
    // definitivo— y el del número de sorteo —colisión transitoria entre dos
    // inscripciones simultáneas, que se arregla recalculando—. Hay que
    // distinguirlos por nombre: tratar la colisión de número como "ya inscripta"
    // le mentiría a alguien que se está inscribiendo por primera vez.
    const IDX_SORTEO = 'uq_inscripciones_evento_sorteo_numero'
    const MAX_INTENTOS = 5

    let inserted: Record<string, unknown> | null = null
    let colisionSorteo = false
    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
      // Se recalcula en cada vuelta: si perdimos la carrera, el máximo cambió.
      // null = el rango se agotó; la inscripción sigue, pero sin número.
      const numero = participaSorteo ? await proximoNumeroSorteo(admin, evento) : null
      // Invariante que consume el desktop: participa_sorteo ⟺ numero_sorteo != NULL.
      // Si el rango se agotó, no participa (no habría número que sortearle).
      const { data, error: insErr } = await admin
        .from('inscripciones_evento_remoto')
        .insert({ ...filaBase, participa_sorteo: numero != null, numero_sorteo: numero })
        .select(COLUMNAS_INSERTADAS)
        .single()

      if (!insErr) {
        inserted = data as Record<string, unknown>
        break
      }
      if (insErr.code === '23505' && insErr.message.includes(IDX_SORTEO)) {
        colisionSorteo = true
        continue
      }
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
    if (!inserted) {
      // Sólo se llega acá perdiendo la carrera del número MAX_INTENTOS veces
      // seguidas. Es reintentable, así que no se quema la inscripción.
      console.error('[inscribir] no se pudo asignar número de sorteo:', {
        evento: evento.id,
        colisionSorteo,
      })
      return NextResponse.json(
        { error: 'Hay mucha demanda en este momento. Reintentá en unos segundos.' },
        { status: 503 },
      )
    }
    const numeroSorteo =
      inserted.numero_sorteo == null ? null : Number(inserted.numero_sorteo)

    // ── Acuse de inscripción por email (best-effort; no bloquea ni falla la
    //    respuesta). Va al mail ingresado por la persona (que puede diferir del
    //    de la ficha) o, si no puso, al de la ficha. El armado del mail es el
    //    mismo que usa el reenvío de copia (ver lib/evento-acuse).
    const cambios: CambioDato[] = []
    if (part.encontrado) {
      const dif = (campo: string, anterior: string, nuevo: string) => {
        const a = (anterior ?? '').trim()
        const b = (nuevo ?? '').trim()
        if ((a || b) && a.toLowerCase() !== b.toLowerCase()) {
          cambios.push({ campo, anterior: a, nuevo: b })
        }
      }
      dif('Nombre', part.nombre, nombre)
      dif('Apellido', part.apellido, apellido)
      dif('Email', part.mail, mail)
    }
    const acuse = await enviarAcuseInscripcion(admin, {
      evento,
      cfg,
      destino: mail || part.mail || '',
      documento: normalizeDocumento(documento),
      nombre,
      apellido,
      inscripcion: {
        numero: (inserted.numero as string | null) ?? null,
        categoria_nombre: (inserted.categoria_nombre as string | null) ?? null,
        tipo_participante: part.tipo_participante,
        importe: Number(inserted.importe),
        transporte_importe: Number(inserted.transporte_importe),
        alimentacion_importe: Number(inserted.alimentacion_importe),
        alimentacion_tipo: (inserted.alimentacion_tipo as string | null) ?? null,
        moneda_codigo: inserted.moneda_codigo as string,
        modalidad: modalidadFinal,
        referencia_transferencia: referencia || null,
        numero_sorteo: numeroSorteo,
      },
      cambios,
      origen: origenPublico(req),
    })
    if (!acuse.ok && acuse.motivo === 'error') {
      console.error('[inscribir] acuse no enviado:', acuse.error)
    }

    return NextResponse.json({
      ok: true,
      inscripcion: {
        numero: inserted.numero as string | null,
        categoria_nombre: inserted.categoria_nombre as string | null,
        importe: Number(inserted.importe),
        moneda_codigo: inserted.moneda_codigo as string,
        tipo_participante: inserted.tipo_participante as string,
        // No se devuelven `es_socio` ni `cuotas_pendientes`: la UI no los usa y
        // serían un oráculo de padrón/deuda en un endpoint sin autenticación.
        lleva_transporte: !!inserted.lleva_transporte,
        transporte_importe: Number(inserted.transporte_importe),
        lleva_alimentacion: !!inserted.lleva_alimentacion,
        alimentacion_importe: Number(inserted.alimentacion_importe),
        alimentacion_tipo: (inserted.alimentacion_tipo as string | null) ?? null,
        participa_sorteo: !!inserted.participa_sorteo,
        numero_sorteo: numeroSorteo,
        // Pidió sorteo pero no hubo número: el rango se agotó. El form lo avisa.
        sorteo_completo: participaSorteo && numeroSorteo == null,
        total:
          Number(inserted.importe) +
          Number(inserted.transporte_importe) +
          Number(inserted.alimentacion_importe),
        modalidad: (inserted.modalidad as string) ?? 'reserva',
        datos_deposito:
          inserted.modalidad === 'pago_transferencia' ? evento.datos_deposito : null,
      },
    })
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/inscribir] error:', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
