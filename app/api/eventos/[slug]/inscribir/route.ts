/**
 * POST /api/eventos/[slug]/inscribir
 *   body: { documento, nombre, apellido?, mail?, telefono?, categoria_id }
 *
 * Endpoint PÚBLICO. Registra una inscripción en inscripciones_evento_remoto
 * (estado 'pendiente') para que el desktop la concilie. El tipo de participante
 * (socio/no_socio) y el importe se calculan server-side: NO se confía en el cliente.
 */

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buscarInscripcionPrevia,
  contarConTransporte,
  contarInscriptos,
  loadEventoRemotoBySlug,
  maskMail,
  nombreCategoriaSocio,
  normalizarDatosDepositoMonedas,
  normalizarExtrasPrecio,
  normalizarMonedas,
  normalizarRegistroPermitido,
  parseOpcionesAlimentacion,
  permitirCategoriaOtros,
  precioCategoria,
  precioMaximoCategoria,
  proximoNumeroSorteo,
  resolverParticipante,
} from '@/lib/eventos'
import {
  ALIMENTACION_SIN_RESTRICCION,
  datosDepositoDe,
  elegibleParaSorteo,
  esMonedaDelEvento,
  esSoloSorteo,
  motivoNoPuedeInscribirse,
  opcionesConSinRestriccion,
  precioExtra,
  puedeInscribirse,
} from '@/lib/eventos-types'
import { hashDocumento, normalizeDocumento } from '@/lib/documento'
import { esCedulaUruguayaValida } from '@/lib/cedula'
import { loadEventoWebConfig } from '@/lib/evento-web-config'
import { loadGmailAccountForEmpresa } from '@/lib/birthday-template-store'
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
  /**
   * Moneda elegida en el formulario. Se valida contra las monedas del evento y,
   * si no es una de ellas, se cae a la base: el importe lo fija el server y
   * tiene que salir de una moneda que el evento realmente publique.
   */
  moneda_codigo?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// Topes de longitud (E20): sólo el cliente los exigía; un POST directo al
// endpoint no tenía techo. `slice` en vez de rechazar — mismo criterio que
// `referencia`, que ya se recortaba.
const MAX_NOMBRE = 80
const MAX_MAIL = 120
const MAX_TELEFONO = 30
const MAX_CATEGORIA_OTROS = 60
const MAX_ALIMENTACION_OTROS = 60

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
    let nombre = str(body.nombre).slice(0, MAX_NOMBRE)
    let apellido = str(body.apellido).slice(0, MAX_NOMBRE)
    let mail = str(body.mail).slice(0, MAX_MAIL)
    let telefono = str(body.telefono).slice(0, MAX_TELEFONO)
    const categoriaId = str(body.categoria_id)
    const categoriaOtros = str(body.categoria_otros).slice(0, MAX_CATEGORIA_OTROS)
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

    // Moneda de la inscripción. La elige la persona, pero se re-valida acá igual
    // que el importe: si viene una que el evento no publica, manda la base.
    // TODA la inscripción queda en esta moneda —categoría, locomoción y
    // alimentación—: nunca se mezclan, y no se convierte nada (no hay cotización).
    const monedas = normalizarMonedas(evento)
    const monedaBase = monedas[0].codigo
    const monedaPedida = str(body.moneda_codigo)
    const moneda =
      monedaPedida && esMonedaDelEvento(monedas, monedaPedida) ? monedaPedida : monedaBase
    const extrasPrecio = normalizarExtrasPrecio(evento)
    const datosDeposito = datosDepositoDe(
      {
        datos_deposito: evento.datos_deposito,
        datos_deposito_monedas: normalizarDatosDepositoMonedas(evento),
      },
      moneda,
    )

    // P3: estas cuatro consultas dependen sólo de `evento`/`documento`, no entre
    // sí — en serie eran ~4 viajes seguidos por nada. `previa` reemplaza al
    // SELECT de dedupe suelto que había antes del INSERT (ver más abajo): es el
    // mismo criterio (`buscarInscripcionPrevia`, el que ya usa /lookup) resuelto
    // temprano, así el 409 sale antes de completar categoría/transporte/etc.
    const [cfgCruda, inscriptosActuales, part, previa] = await Promise.all([
      loadEventoWebConfig(admin, evento.id),
      evento.cupo_maximo != null ? contarInscriptos(admin, evento.id) : Promise.resolve(0),
      resolverParticipante(admin, evento, documento),
      buscarInscripcionPrevia(admin, evento.id, documento),
    ])

    // Cupo global: chequeo temprano (no atómico) para no seguir armando la
    // inscripción si ya está lleno. El cierre real de la carrera lo hace la RPC
    // `inscribir_evento_web` (o el recuento posterior si todavía no se aplicó
    // el SQL 60_) más abajo, en el INSERT.
    if (evento.cupo_maximo != null && inscriptosActuales >= evento.cupo_maximo) {
      return NextResponse.json({ error: 'Se completó el cupo del evento' }, { status: 409 })
    }

    // Ya inscripta (dedupe temprano, reemplaza al SELECT suelto que había antes
    // del INSERT — el 23505 de idx_inscripciones_evento_remoto_unica sigue
    // siendo la garantía real si dos requests se cruzan en el medio).
    if (previa) {
      return NextResponse.json(
        { error: 'Esta cédula ya está inscripta a este evento' },
        { status: 409 },
      )
    }

    // Config web del evento. NO se confía en el cliente: los campos ocultos se
    // descartan y los obligatorios se exigen acá. `permitir_categoria_otros` es
    // el AND con lo que setea el desktop (E11): cualquiera de los dos lados
    // puede apagar la categoría libre.
    const cfg = { ...cfgCruda, permitir_categoria_otros: permitirCategoriaOtros(evento, cfgCruda) }
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

    // Política de admisión del evento. Se RE-APLICA acá aunque el formulario ya
    // la haya evaluado en /lookup: el cliente no se confía, igual que con el
    // importe y el opt-in al sorteo. Va después del dígito verificador para que
    // un error de tipeo reciba su mensaje específico y no éste.
    const politica = normalizarRegistroPermitido(evento.registro_permitido)
    if (!puedeInscribirse(politica, part.tipo_participante, part.encontrado)) {
      return NextResponse.json(
        { error: motivoNoPuedeInscribirse(politica) },
        { status: 403 },
      )
    }

    // El formulario ya no pre-rellena los datos del socio (el lookup público no
    // los entrega, ver ResolucionPublica). Por eso un campo vacío significa "no
    // lo escribió", NO "borralo": lo completamos desde la ficha para no
    // proponerle al contador un cambio que le vacíe datos al socio. El nombre
    // también: un socio verificado no necesita re-escribirlo.
    if (part.encontrado) {
      if (!nombre) nombre = part.nombre.slice(0, MAX_NOMBRE)
      if (!apellido) apellido = part.apellido.slice(0, MAX_NOMBRE)
      if (!mail) mail = part.mail.slice(0, MAX_MAIL)
      if (!telefono) telefono = part.telefono.slice(0, MAX_TELEFONO)
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
    // Teléfono: obligatorio sólo si el evento lo configuró así (E11 —
    // `telefono_obligatorio` se guardaba y nunca se leía). Si es un socio con
    // teléfono en la ficha ya se completó arriba.
    if (cfg.mostrar_telefono && cfg.telefono_obligatorio && !telefono) {
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
        const max = await precioMaximoCategoria(
          admin,
          evento.id,
          part.tipo_participante,
          moneda,
          monedaBase,
        )
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
        const precio = await precioCategoria(
          admin,
          evento.id,
          categoriaId,
          part.tipo_participante,
          moneda,
          monedaBase,
        )
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
        const nombreCat = await nombreCategoriaSocio(admin, evento.empresa_id, categoriaId)
        if (!nombreCat) {
          return NextResponse.json({ error: 'Categoría no válida' }, { status: 400 })
        }
        categoriaNombre = nombreCat
        categoriaIdFinal = categoriaId
      }
    }

    // Transporte (opcional): si el evento lo ofrece y la persona lo pidió.
    // El costo (si aplica) es diferenciado socio/no_socio.
    let llevaTransporte = false
    let transporteImporte = 0
    if (evento.transporte_disponible && cfg.mostrar_transporte && body.lleva_transporte === true) {
      // Cupo de transporte: si tiene tope y ya se llenó, se rechaza (la persona
      // puede reintentar sin transporte). Mismo criterio que el cupo del evento:
      // chequeo temprano, no atómico — el cierre real lo hace la RPC/recuento.
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
        // Precio de la moneda elegida. Sin entrada para esa moneda el extra va
        // en 0: nunca se cae al precio de otra moneda (no hay conversión).
        transporteImporte =
          precioExtra(extrasPrecio, 'transporte', part.tipo_participante, moneda) ?? 0
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
      // E20: un tipo que coincide con una opción cargada por el desktop pasa tal
      // cual (esas ya tienen su propio tope en el desktop); el texto libre de
      // "Otros" se recorta — el cliente lo limita a 60, un POST directo no.
      if (alimentacionTipo && !opcionesConSinRestriccion(opciones).includes(alimentacionTipo)) {
        alimentacionTipo = alimentacionTipo.slice(0, MAX_ALIMENTACION_OTROS)
      }
      if (evento.alimentacion_con_costo) {
        alimentacionImporte =
          precioExtra(extrasPrecio, 'alimentacion', part.tipo_participante, moneda) ?? 0
      }
    }

    // Sorteo (opcional, opt-in): sólo si el evento lo tiene, la config web no lo
    // oculta, la persona lo pidió y es elegible. La elegibilidad se re-decide acá
    // contra el tipo de participante resuelto server-side: el flag del body no se
    // confía (mismo criterio que el importe).
    //
    // El número NO se asigna todavía: se resuelve junto al insert, porque dos
    // inscripciones simultáneas pueden calcular el mismo y hay que reintentar.
    //
    // En un evento "solo sorteo" el opt-in es implícito: registrarse ES
    // anotarse, y el formulario ya no muestra casilla que tildar. No se confía
    // en el body para eso —se re-decide acá con los mismos flags que usa el
    // form (ver `esSoloSorteo`)—, así que un cliente viejo en caché, que sigue
    // mandando `participa_sorteo: false`, anota igual.
    const soloSorteo = esSoloSorteo({
      slug: evento.slug,
      tipo: evento.tipo,
      sorteoVisible: !!evento.sorteo_disponible && cfg.mostrar_sorteo,
      transporteVisible: !!evento.transporte_disponible && cfg.mostrar_transporte,
      alimentacionVisible: !!evento.alimentacion_disponible && cfg.mostrar_alimentacion,
    })
    const participaSorteo =
      (soloSorteo || body.participa_sorteo === true) &&
      elegibleParaSorteo(
        {
          disponible: !!evento.sorteo_disponible && cfg.mostrar_sorteo,
          // Default TRUE si viene null (eventos previos a la migración 31).
          solo_socios: evento.sorteo_solo_socios !== false,
        },
        part.tipo_participante,
      )

    // Solo sorteo y esta persona no puede participar: no se guarda una fila que
    // no significa nada. Con `registro_permitido = 'socios_al_dia'` —lo normal
    // en un sorteo para socios— ya quedó afuera más arriba con su mensaje
    // propio; esto cubre el evento abierto cuyo sorteo sí es sólo para socios.
    if (soloSorteo && !participaSorteo) {
      return NextResponse.json(
        { error: 'El sorteo es sólo para socios al día.' },
        { status: 403 },
      )
    }

    // Modalidad efectiva: "pago_transferencia" (= "pago realizado") sólo si el
    // evento habilita esa modalidad, la config web la permite, publica datos de
    // depósito PARA ESTA MONEDA y hay algo para pagar; si no, es una
    // preinscripción (reserva de cupo).
    //
    // El total suma tres importes que ya están todos en la moneda elegida: acá
    // nunca se suman monedas distintas.
    const totalAPagar = importe + transporteImporte + alimentacionImporte
    const modalidadFinal =
      modalidad === 'pago_transferencia' &&
      evento.permitir_pago_realizado &&
      cfg.permitir_pago_transferencia &&
      !!datosDeposito &&
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

    const filaBase = {
      evento_id: evento.id,
      empresa_id: evento.empresa_id,
      categoria_id: categoriaIdFinal,
      categoria_nombre: categoriaNombre,
      tipo_participante: part.tipo_participante,
      socio_id: part.socio_id,
      documento: normalizeDocumento(documento),
      documento_hash: hashDocumento(documento),
      nombre,
      apellido: apellido || null,
      mail: mail || null,
      telefono: telefono || null,
      importe,
      // La moneda ELEGIDA, no la del evento: es lo que hace que la inscripción
      // llegue al desktop lista para contabilizar en la moneda correcta.
      moneda_codigo: moneda,
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
      'id, numero, importe, moneda_codigo, categoria_nombre, tipo_participante, lleva_transporte, transporte_importe, lleva_alimentacion, alimentacion_importe, alimentacion_tipo, modalidad, participa_sorteo, numero_sorteo'

    // Desde la migración 31 hay DOS índices únicos sobre esta tabla y ambos
    // devuelven 23505: el de (evento_id, documento_hash) —cédula repetida, error
    // definitivo— y el del número de sorteo —colisión transitoria entre dos
    // inscripciones simultáneas, que se arregla recalculando—. Hay que
    // distinguirlos por nombre: tratar la colisión de número como "ya inscripta"
    // le mentiría a alguien que se está inscribiendo por primera vez.
    const IDX_SORTEO = 'uq_inscripciones_evento_sorteo_numero'
    const MAX_INTENTOS = 5
    // La RPC todavía no aplicada da uno de estos dos códigos (según el cliente
    // de PostgREST la resuelva antes o después de golpear la base).
    const RPC_NO_APLICADA = new Set(['PGRST202', '42883'])

    let inserted: Record<string, unknown> | null = null
    let colisionSorteo = false
    // Se apaga sólo si la RPC no está aplicada (ver docs/supabase/60_
    // eventos_web_fixes.sql): ahí se cae al INSERT directo de siempre + un
    // recuento posterior (ver el bloque de abajo).
    let usarRpc = true

    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
      // Se recalcula en cada vuelta: si perdimos la carrera, el máximo cambió.
      // null = el rango se agotó; la inscripción sigue, pero sin número.
      const numero = participaSorteo ? await proximoNumeroSorteo(admin, evento) : null
      // Solo sorteo y sin número: el registro no dejaría nada. En un evento
      // normal el rango agotado sólo saca del sorteo (la inscripción vale por sí
      // sola); acá se rechaza. La página pública ya cierra el evento en este
      // caso, así que llegar hasta acá es perder la carrera por el último número.
      if (soloSorteo && numero == null) {
        return NextResponse.json(
          { error: 'Se agotaron los números del sorteo' },
          { status: 409 },
        )
      }
      // Invariante que consume el desktop: participa_sorteo ⟺ numero_sorteo != NULL.
      // Si el rango se agotó, no participa (no habría número que sortearle).
      const filaCompleta = { ...filaBase, participa_sorteo: numero != null, numero_sorteo: numero }

      if (usarRpc) {
        // E4/I3: cupo + transporte + INSERT en una sola transacción, serializada
        // por evento (`pg_advisory_xact_lock`) — cierra la carrera de raíz en vez
        // de sólo angostarla. Ver docs/supabase/60_eventos_web_fixes.sql.
        const { data: rpcData, error: rpcErr } = await admin.rpc('inscribir_evento_web', {
          p_row: filaCompleta,
          p_cupo_maximo: evento.cupo_maximo,
          p_transporte_cupo: llevaTransporte ? evento.transporte_cupo_maximo : null,
        })

        if (!rpcErr) {
          const resultado = rpcData as (Record<string, unknown> & { error?: string }) | null
          if (resultado?.error === 'cupo_completo') {
            return NextResponse.json({ error: 'Se completó el cupo del evento' }, { status: 409 })
          }
          if (resultado?.error === 'transporte_completo') {
            return NextResponse.json(
              { error: 'Se completó el cupo de transporte' },
              { status: 409 },
            )
          }
          inserted = resultado
          break
        }

        if (rpcErr.code === '23505' && rpcErr.message.includes(IDX_SORTEO)) {
          colisionSorteo = true
          continue
        }
        if (rpcErr.code === '23505') {
          return NextResponse.json(
            { error: 'Esta cédula ya está inscripta a este evento' },
            { status: 409 },
          )
        }
        if (RPC_NO_APLICADA.has(rpcErr.code ?? '')) {
          usarRpc = false
          console.warn(
            '[inscribir] falta aplicar docs/supabase/60_eventos_web_fixes.sql ' +
              '(RPC inscribir_evento_web no existe todavía): se usa el INSERT directo, ' +
              'sin lock atómico de cupo — el recuento posterior actúa de red de contención.',
          )
          // Sigue en esta misma vuelta, por el camino sin RPC (no `continue`:
          // ya se calculó `numero`, no hace falta recalcularlo).
        } else {
          console.error('[inscribir] error de la RPC inscribir_evento_web:', rpcErr)
          return NextResponse.json(
            { error: 'No se pudo registrar la inscripción. Reintentá en unos segundos.' },
            { status: 500 },
          )
        }
      }

      if (!usarRpc) {
        const { data, error: insErr } = await admin
          .from('inscripciones_evento_remoto')
          .insert(filaCompleta)
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
        console.error('[inscribir] error insertando la inscripción:', insErr)
        return NextResponse.json(
          { error: 'No se pudo registrar la inscripción. Reintentá en unos segundos.' },
          { status: 500 },
        )
      }
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

    // Fallback sin la RPC (E4, versión "recontar y anular"): la ventana entre
    // contar y el INSERT de arriba no estaba cerrada. Se recuenta YA con la fila
    // recién insertada adentro y, si se pasó del cupo, se anula: angosta la
    // carrera en vez de dejarla abierta del todo. Con la RPC aplicada este
    // bloque no corre — el cupo ya quedó garantizado en la misma transacción.
    if (!usarRpc) {
      if (evento.cupo_maximo != null) {
        const actual = await contarInscriptos(admin, evento.id)
        if (actual > evento.cupo_maximo) {
          await admin
            .from('inscripciones_evento_remoto')
            .update({ estado: 'anulado' })
            .eq('id', inserted.id)
          return NextResponse.json({ error: 'Se completó el cupo del evento' }, { status: 409 })
        }
      }
      if (llevaTransporte && evento.transporte_cupo_maximo != null) {
        const actualTransporte = await contarConTransporte(admin, evento.id)
        if (actualTransporte > evento.transporte_cupo_maximo) {
          await admin
            .from('inscripciones_evento_remoto')
            .update({ estado: 'anulado' })
            .eq('id', inserted.id)
          return NextResponse.json(
            { error: 'Se completó el cupo de transporte' },
            { status: 409 },
          )
        }
      }
    }

    const numeroSorteo =
      inserted.numero_sorteo == null ? null : Number(inserted.numero_sorteo)

    // ── Acuse de inscripción por email. Va al mail ingresado por la persona
    //    (que puede diferir del de la ficha) o, si no puso, al de la ficha. El
    //    armado del mail es el mismo que usa el reenvío de copia (lib/evento-acuse).
    //
    //    El envío en sí va con `after()` (P1/E9): el SMTP a Gmail sin pool son
    //    1-3 s que no tienen por qué demorar la respuesta — la inscripción ya
    //    está guardada. `mail_mask` se resuelve ANTES de responder con una
    //    consulta liviana (¿hay casilla configurada?) para que la pantalla diga
    //    la verdad sobre A DÓNDE va a salir el acuse, sin esperar a que salga.
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
      // Teléfono: el desktop lo propone aplicar a la ficha (es el cambio más
      // frecuente), así que el acuse tiene que nombrarlo igual que a los otros.
      dif('Teléfono', part.telefono, telefono)
      // Categoría: sólo si la ficha YA tenía una. Sin categoría previa no hay
      // cambio que avisar —es un dato que se da por primera vez—, y el aviso
      // saldría en cada inscripción de un socio sin categoría en el puente.
      if (part.categoria_nombre && categoriaNombre) {
        dif('Categoría', part.categoria_nombre, categoriaNombre)
      }
    }

    const destinoMail = (mail || part.mail || '').trim()
    const casillaAcuse = destinoMail
      ? await loadGmailAccountForEmpresa(admin, evento.empresa_id)
      : null
    const mailMask = casillaAcuse && destinoMail ? maskMail(destinoMail) : null

    if (destinoMail && casillaAcuse) {
      const origen = origenPublico(req)
      after(() =>
        enviarAcuseInscripcion(admin, {
          evento,
          cfg,
          destino: destinoMail,
          documento: normalizeDocumento(documento),
          nombre,
          apellido,
          inscripcion: {
            numero: (inserted.numero as string | null) ?? null,
            categoria_nombre: (inserted.categoria_nombre as string | null) ?? null,
            tipo_participante: part.tipo_participante,
            importe: Number(inserted.importe),
            lleva_transporte: !!inserted.lleva_transporte,
            transporte_importe: Number(inserted.transporte_importe),
            lleva_alimentacion: !!inserted.lleva_alimentacion,
            alimentacion_importe: Number(inserted.alimentacion_importe),
            alimentacion_tipo: (inserted.alimentacion_tipo as string | null) ?? null,
            moneda_codigo: inserted.moneda_codigo as string,
            modalidad: modalidadFinal,
            // Recién nacida: 'pendiente' o 'pagado', nunca 'importado'/'confirmado'.
            // Va explícito igual para que el acuse del alta y el de la copia se
            // lean del mismo dato.
            estado: estadoInicial,
            referencia_transferencia: referencia || null,
            numero_sorteo: numeroSorteo,
          },
          cambios,
          origen,
        }).then((acuse) => {
          if (!acuse.ok && acuse.motivo === 'error') {
            console.error('[inscribir] acuse no enviado:', acuse.error)
          }
        }),
      )
    }

    return NextResponse.json({
      ok: true,
      mail_mask: mailMask,
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
        // Antes iba al revés (sólo si ya pagó, que es justo cuando no hace
        // falta): una preinscripción sin mail configurado (E9) se quedaba sin
        // saber a dónde transferir. Los datos de cuenta no son secretos —ya
        // viajan en el payload público del evento— así que mandarlos siempre
        // no agrega superficie.
        datos_deposito: datosDeposito,
      },
    })
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/inscribir] error:', err)
    return NextResponse.json(
      { error: 'No se pudo completar la inscripción. Reintentá en unos segundos.' },
      { status: 503 },
    )
  }
}
