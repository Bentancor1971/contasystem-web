'use client'

/**
 * Formulario público de inscripción (modelo puente).
 *
 * Flujo: cédula → "Verificar" → resuelve socio + tipo de participante
 * (socio/no_socio según cuotas pendientes) → muestra las categorías con el
 * precio que le corresponde → inscribe. El importe lo fija el server.
 */

import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Loader2, Search, Ticket, Info, X, Landmark, CalendarClock, AlertCircle, Mail, Receipt } from 'lucide-react'
import type {
  EventoPublico,
  InscripcionPrevia,
  ModalidadElegida,
  ModalidadInscripcion,
  ResolucionPublica,
  TipoParticipante,
} from '@/lib/eventos-types'
import { simboloMoneda } from '@/lib/format'
import { RegistrarPago } from './RegistrarPago'

function formatImporte(n: number, moneda: string): string {
  const nf = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${simboloMoneda(moneda)} ${nf.format(n)}`
}

/**
 * Barra de cupo de transporte: banda cualitativa + color, relleno por banda (no
 * el % exacto). Mismo criterio que la barra de cupo del evento en page.tsx.
 */
const BARRA_TRANSPORTE = {
  baja:  { texto: 'Lugares disponibles', fill: '34%', texto_cls: 'text-status-ok',   barra_cls: 'bg-status-ok' },
  media: { texto: 'Últimos lugares',     fill: '70%', texto_cls: 'text-status-warn', barra_cls: 'bg-status-warn' },
  alta:  { texto: 'Casi completo',       fill: '92%', texto_cls: 'text-status-no',   barra_cls: 'bg-status-no' },
} as const

/**
 * Cómo se le explica a la persona una inscripción que YA tiene, según cómo se
 * registró (modalidad) y en qué estado quedó. `pendientePago` decide si además
 * se le muestran los datos de transferencia y el importe a abonar.
 */
function describirInscripcionPrevia(p: InscripcionPrevia): {
  titulo: string
  detalle: string
  pendientePago: boolean
  rechazada: boolean
} {
  if (p.estado === 'rechazado') {
    return {
      titulo: 'Tu inscripción fue rechazada',
      detalle:
        'La organización rechazó esta inscripción. Comunicate con ellos para regularizar tu situación.',
      pendientePago: false,
      rechazada: true,
    }
  }
  if (p.estado === 'importado') {
    return {
      titulo: 'Tu inscripción está confirmada',
      detalle: 'La organización ya confirmó tu inscripción. No tenés que hacer nada más.',
      pendientePago: false,
      rechazada: false,
    }
  }
  if (p.estado === 'pagado' || p.modalidad === 'pago_transferencia') {
    return {
      titulo: 'Ya te inscribiste y declaraste el pago',
      detalle:
        'Registramos tu transferencia. La organización la va a verificar para confirmar tu inscripción.',
      pendientePago: false,
      rechazada: false,
    }
  }
  return {
    titulo: 'Ya tenés una preinscripción',
    detalle:
      'Tu cupo está reservado, pero todavía figura como impago. Para confirmar tu lugar tenés que abonar el importe de abajo.',
    pendientePago: true,
    rechazada: false,
  }
}

/**
 * Dato que ya está en la ficha del socio: se muestra ENMASCARADO y no se edita.
 * Es informativo (para que la persona se reconozca); el server usa el valor real
 * de la ficha al inscribir. Si un dato cambió, lo actualiza la organización.
 */
function DatoDeFicha({ id, valor }: { id: string; valor: string }) {
  return (
    <input
      id={id}
      className="field bg-paper-2 text-ink-2 cursor-not-allowed"
      value={valor}
      readOnly
      tabIndex={-1}
      aria-readonly="true"
    />
  )
}

/** Valor de `categoriaId` cuando el participante elige la opción de categoría libre. */
const OTROS = '__otros__'
/** Valor del select de tipo de alimentación cuando elige "Otros". */
const ALIM_OTROS = '__otros_alim__'

interface Resultado {
  numero: string | null
  categoria_nombre: string | null
  importe: number
  moneda_codigo: string
  tipo_participante: string
  lleva_transporte: boolean
  transporte_importe: number
  lleva_alimentacion: boolean
  alimentacion_importe: number
  alimentacion_tipo: string | null
  total: number
  modalidad: ModalidadInscripcion
  datos_deposito: string | null
}

export function EventoForm({
  evento,
  abrirRegistrarPago = false,
}: {
  evento: EventoPublico
  /** Viene de ?pago=1 (link del mail de preinscripción): arranca en el registro de pago. */
  abrirRegistrarPago?: boolean
}) {
  // Modalidades ofrecidas antes de pedir la cédula. "Pago realizado" sólo tiene
  // sentido si la config web lo permite y hay dónde transferir (datos de
  // depósito cargados). Misma condición que el servidor en /inscribir.
  const pagoRealizadoDisponible =
    evento.permitir_pago_realizado &&
    evento.config.permitir_pago_transferencia &&
    !!evento.datos_deposito
  const preinscripcionDisponible = evento.permitir_preinscripcion
  const modalidadesDisponibles: ModalidadElegida[] = [
    ...(pagoRealizadoDisponible ? (['pago_realizado'] as const) : []),
    ...(preinscripcionDisponible ? (['preinscripcion'] as const) : []),
  ]
  // Tercera opción, que NO es una modalidad de inscripción: el que ya se
  // preinscribió y vuelve sólo a declarar la transferencia. Requiere lo mismo
  // que "pago realizado" salvo la modalidad del evento (ver RegistrarPago).
  const registrarPagoDisponible =
    evento.config.permitir_pago_transferencia && !!evento.datos_deposito
  // Se saltea la pantalla de elección sólo si hay UNA sola cosa para elegir. Con
  // el registro de pago disponible siempre hay al menos dos.
  const modalidadUnica =
    modalidadesDisponibles.length === 1 && !registrarPagoDisponible
      ? modalidadesDisponibles[0]
      : null

  // Lo elegido en esa pantalla: una modalidad de inscripción o el registro de pago.
  // Con ?pago=1 se salta la elección y se entra directo a declarar el pago.
  const [modalidadElegida, setModalidadElegida] = useState<
    ModalidadElegida | 'registrar_pago' | null
  >(abrirRegistrarPago && registrarPagoDisponible ? 'registrar_pago' : modalidadUnica)
  const [documento, setDocumento] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [resuelto, setResuelto] = useState<ResolucionPublica | null>(null)

  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [mail, setMail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [categoriaOtros, setCategoriaOtros] = useState('')
  const [llevaTransporte, setLlevaTransporte] = useState(false)
  const [llevaAlimentacion, setLlevaAlimentacion] = useState(false)
  const [alimentacionTipo, setAlimentacionTipo] = useState('')
  const [alimentacionOtros, setAlimentacionOtros] = useState('')
  const [referenciaTransferencia, setReferenciaTransferencia] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  // Inscripción que esta cédula YA tiene en el evento (detectada al verificar,
  // o al chocar con el 409 si alguien se inscribió mientras completaba el form).
  const [yaInscripto, setYaInscripto] = useState<InscripcionPrevia | null>(null)
  // Reenvío de la copia del comprobante: pide confirmación antes de mandar el mail.
  const [confirmandoCopia, setConfirmandoCopia] = useState(false)
  const [enviandoCopia, setEnviandoCopia] = useState(false)
  const [copiaEnviada, setCopiaEnviada] = useState(false)

  const tipo: TipoParticipante = resuelto?.tipo_participante ?? 'no_socio'
  const conCosto = evento.tipo === 'con_costo'

  // Un socio al día ya tiene sus datos en la ficha: se muestran enmascarados y
  // no hace falta re-escribirlos (el server los completa al inscribir con los
  // datos reales). Cada `*EnFicha` es true sólo si ese dato existe en la ficha.
  const esSocioAlDia = resuelto?.tipo_participante === 'socio'
  const nombreEnFicha = esSocioAlDia && !!resuelto?.nombre_mask
  const apellidoEnFicha = esSocioAlDia && !!resuelto?.apellido_mask
  const mailEnFicha = esSocioAlDia && !!resuelto?.mail_mask
  const telefonoEnFicha = esSocioAlDia && !!resuelto?.telefono_mask

  // Config web del evento. Los flags `mostrar_*` sólo OCULTAN: nunca habilitan
  // algo que el desktop no configuró (transporte/alimentación disponibles).
  const cfg = evento.config
  // En eventos con costo la categoría define el precio: no se puede ocultar.
  const categoriaVisible = conCosto || cfg.mostrar_categoria
  const permitirOtros = cfg.permitir_categoria_otros

  /**
   * Vacía lo que la persona escribió sobre sí misma. Se llama al cambiar de
   * cédula: si no, los datos del inscripto anterior quedan en los campos y el
   * server los toma como escritos (sólo completa desde la ficha lo que viene
   * vacío), guardando la inscripción del nuevo con el mail/teléfono del previo.
   */
  function limpiarDatosPersona() {
    setNombre('')
    setApellido('')
    setMail('')
    setTelefono('')
    setCategoriaId('')
    setCategoriaOtros('')
    setLlevaTransporte(false)
    setLlevaAlimentacion(false)
    setAlimentacionTipo('')
    setAlimentacionOtros('')
    setReferenciaTransferencia('')
  }

  // Vuelve el formulario al estado inicial (útil en modo kiosco, para el siguiente inscripto).
  function cerrarFormulario() {
    setDocumento('')
    setVerificando(false)
    setResuelto(null)
    limpiarDatosPersona()
    setEnviando(false)
    setResultado(null)
    setYaInscripto(null)
    setConfirmandoCopia(false)
    setEnviandoCopia(false)
    setCopiaEnviada(false)
    // Vuelve a la pantalla de elección (o a la única modalidad disponible).
    setModalidadElegida(modalidadUnica)
  }

  // Precio visible por categoría según el tipo de participante resuelto.
  const precioDe = (c: EventoPublico['categorias'][number]): number | null =>
    tipo === 'socio' ? c.precio_socio : c.precio_no_socio

  // Transporte: costo según tipo de participante (0 si sin costo, oculto o no lo pide).
  const transp = evento.transporte
  const transporteVisible = transp.disponible && cfg.mostrar_transporte
  // Si el cupo de transporte está lleno, la opción se bloquea: nunca cuenta.
  const llevaTransporteEfectivo = transporteVisible && llevaTransporte && !transp.completo
  const transporteImporte =
    llevaTransporteEfectivo && transp.con_costo
      ? tipo === 'socio'
        ? transp.importe_socio
        : transp.importe_no_socio
      : 0
  // Alimentación: espejo de transporte. El tipo es una preferencia (no cambia precio).
  const alim = evento.alimentacion
  const alimentacionVisible = alim.disponible && cfg.mostrar_alimentacion
  const alimentacionImporte =
    alimentacionVisible && llevaAlimentacion && alim.con_costo
      ? tipo === 'socio'
        ? alim.importe_socio
        : alim.importe_no_socio
      : 0
  // Opciones de categoría según el tipo de evento:
  //   - con costo: las categorías con precio del evento (tarifa socio/no_socio).
  //   - sin costo: el catálogo de categorías de socio, como clasificación.
  const opcionesCategoria: { id: string; nombre: string; precio: number | null }[] =
    conCosto
      ? evento.categorias.map((c) => ({ id: c.categoria_id, nombre: c.nombre, precio: precioDe(c) }))
      : evento.categorias_socio.map((c) => ({ id: c.id, nombre: c.nombre, precio: null }))

  // Tarifa de referencia para "Otros" (con costo): la más alta disponible para
  // el tipo de participante. null si el evento no tiene ninguna tarifa cargada.
  const preciosDisponibles = evento.categorias
    .map((c) => precioDe(c))
    .filter((p): p is number => p != null)
  const precioMaxOtros = preciosDisponibles.length ? Math.max(...preciosDisponibles) : null

  const esOtros = categoriaId === OTROS
  const categoriaSel = evento.categorias.find((c) => c.categoria_id === categoriaId)
  const categoriaImporte = !conCosto
    ? 0
    : esOtros
      ? precioMaxOtros ?? 0
      : categoriaSel
        ? precioDe(categoriaSel) ?? 0
        : 0
  const total = categoriaImporte + transporteImporte + alimentacionImporte

  if (!evento.abierto) {
    return (
      <div className="card p-8 text-center rise">
        <p className="font-display text-2xl font-medium mb-2">Inscripciones cerradas</p>
        <p className="text-ink-2">{evento.motivo_cerrado}</p>
      </div>
    )
  }

  if (resultado) {
    return (
      <div className="card p-8 rise">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 className="text-status-ok" size={28} />
          <h2 className="font-display text-3xl font-medium">¡Listo!</h2>
        </div>
        <p className="text-ink-2 mb-6">
          {resultado.modalidad === 'pago_transferencia' ? (
            <>Tu inscripción a <strong>{evento.nombre}</strong> quedó registrada. Realizá la transferencia con los datos de abajo para confirmar tu lugar.</>
          ) : (
            <>Reservaste tu cupo para <strong>{evento.nombre}</strong>. Coordiná el pago con la organización para confirmar la inscripción.</>
          )}
        </p>
        <dl className="font-mono text-sm space-y-2 border-t border-line pt-4">
          {resultado.numero && (
            <div className="flex justify-between">
              <dt className="text-ink-3">N° de inscripción</dt>
              <dd className="font-semibold">{resultado.numero}</dd>
            </div>
          )}
          {resultado.categoria_nombre && (
            <div className="flex justify-between">
              <dt className="text-ink-3">Categoría</dt>
              <dd>{resultado.categoria_nombre} · {resultado.tipo_participante === 'socio' ? 'Socio' : 'No socio'}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-3">Inscripción</dt>
            <dd>{formatImporte(resultado.importe, resultado.moneda_codigo)}</dd>
          </div>
          {resultado.lleva_transporte && (
            <div className="flex justify-between">
              <dt className="text-ink-3">Transporte</dt>
              <dd>
                {resultado.transporte_importe > 0
                  ? formatImporte(resultado.transporte_importe, resultado.moneda_codigo)
                  : 'Sin costo'}
              </dd>
            </div>
          )}
          {resultado.lleva_alimentacion && (
            <div className="flex justify-between">
              <dt className="text-ink-3">Alimentación</dt>
              <dd>
                {resultado.alimentacion_tipo ? `${resultado.alimentacion_tipo} · ` : ''}
                {resultado.alimentacion_importe > 0
                  ? formatImporte(resultado.alimentacion_importe, resultado.moneda_codigo)
                  : 'Sin costo'}
              </dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 mt-1">
            <dt className="text-ink-3 font-semibold">Total</dt>
            <dd className="font-semibold">{formatImporte(resultado.total, resultado.moneda_codigo)}</dd>
          </div>
        </dl>

        {resultado.modalidad === 'pago_transferencia' && resultado.datos_deposito && (
          <div className="mt-6 rounded-xl border border-ink bg-paper-2 p-5">
            <p className="flex items-center gap-2 label-mono mb-3">
              <Landmark size={15} /> Datos para la transferencia
            </p>
            <p className="font-mono text-sm text-ink-1 whitespace-pre-line">
              {resultado.datos_deposito}
            </p>
            <dl className="font-mono text-sm space-y-1.5 border-t border-line pt-3 mt-3">
              <div className="flex justify-between">
                <dt className="text-ink-3">Importe a transferir</dt>
                <dd className="font-semibold">{formatImporte(resultado.total, resultado.moneda_codigo)}</dd>
              </div>
              {resultado.numero && (
                <div className="flex justify-between">
                  <dt className="text-ink-3">Referencia</dt>
                  <dd className="font-semibold">{resultado.numero}</dd>
                </div>
              )}
            </dl>
            <p className="text-[12px] text-ink-3 mt-3">
              Indicá la referencia en la transferencia para que podamos identificar tu pago.
            </p>
          </div>
        )}

        {evento.texto_despues && (
          <p className="text-ink-3 text-sm mt-6 whitespace-pre-line">{evento.texto_despues}</p>
        )}
        <button type="button" className="btn-primary w-full mt-6" onClick={cerrarFormulario}>
          <X size={16} />
          Cerrar Formulario
        </button>
      </div>
    )
  }

  // Aviso de "ya estás inscripto": reemplaza al formulario (no hay nada que
  // completar) y le dice CÓMO quedó registrado y si le falta abonar.
  if (yaInscripto) {
    const info = describirInscripcionPrevia(yaInscripto)
    const debeAbonar = info.pendientePago && yaInscripto.total > 0
    return (
      <div className="card p-8 rise">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className={info.rechazada ? 'text-status-no' : 'text-status-warn'} size={28} />
          <h2 className="font-display text-3xl font-medium">{info.titulo}</h2>
        </div>
        <p className="text-ink-2 mb-6">
          Esta cédula ya figura inscripta a <strong>{evento.nombre}</strong>. {info.detalle}
        </p>

        <dl className="font-mono text-sm space-y-2 border-t border-line pt-4">
          {yaInscripto.numero && (
            <div className="flex justify-between">
              <dt className="text-ink-3">N° de inscripción</dt>
              <dd className="font-semibold">{yaInscripto.numero}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Forma de registro</dt>
            <dd className="text-right">
              {yaInscripto.modalidad === 'pago_transferencia'
                ? 'Pago declarado por transferencia'
                : 'Preinscripción (pago después)'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Estado del pago</dt>
            <dd className={`text-right font-semibold ${info.rechazada ? 'text-status-no' : info.pendientePago ? 'text-status-warn' : 'text-status-ok'}`}>
              {yaInscripto.estado === 'importado'
                ? 'Confirmado'
                : yaInscripto.estado === 'rechazado'
                  ? 'Rechazado'
                  : yaInscripto.estado === 'pagado'
                    ? 'A verificar'
                    : 'Pendiente de pago'}
            </dd>
          </div>
          {yaInscripto.categoria_nombre && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-3">Categoría</dt>
              <dd className="text-right">{yaInscripto.categoria_nombre}</dd>
            </div>
          )}
          {yaInscripto.referencia_transferencia && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-3">Referencia declarada</dt>
              <dd className="text-right">{yaInscripto.referencia_transferencia}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 mt-1">
            <dt className="text-ink-3 font-semibold">{debeAbonar ? 'Falta abonar' : 'Total'}</dt>
            <dd className="font-semibold">
              {formatImporte(yaInscripto.total, yaInscripto.moneda_codigo)}
            </dd>
          </div>
        </dl>

        {debeAbonar && (
          evento.datos_deposito ? (
            <div className="mt-6 rounded-xl border border-ink bg-paper-2 p-5">
              <p className="flex items-center gap-2 label-mono mb-3">
                <Landmark size={15} /> Datos para la transferencia
              </p>
              <p className="font-mono text-sm text-ink-1 whitespace-pre-line">
                {evento.datos_deposito}
              </p>
              {yaInscripto.numero && (
                <p className="text-[12px] text-ink-3 mt-3">
                  Indicá la referencia <strong>{yaInscripto.numero}</strong> en la transferencia para
                  que podamos identificar tu pago.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-6 text-sm text-ink-2">
              Coordiná el pago con la organización para confirmar tu inscripción.
            </p>
          )
        )}

        {/* Declarar la transferencia: SÓLO para la preinscripción impaga. Quien ya
            declaró el pago al inscribirse no tiene nada que registrar acá. */}
        {debeAbonar && cfg.permitir_pago_transferencia && (
          <RegistrarPago slug={evento.slug} documento={documento.trim()} />
        )}

        {/* Copia del comprobante: se envía al mail que ya está guardado en la
            inscripción (mostrado enmascarado). No se puede elegir otro destino. */}
        <div className="mt-6 border-t border-line pt-5">
          {!yaInscripto.mail_mask ? (
            <p className="text-sm text-ink-3">
              No tenemos un correo registrado en tu inscripción, así que no podemos enviarte una
              copia. Consultá con la organización.
            </p>
          ) : copiaEnviada ? (
            <p className="flex items-start gap-2 text-sm text-status-ok">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              Te enviamos una copia del registro a <strong>{yaInscripto.mail_mask}</strong>. Puede
              tardar unos minutos; revisá también el correo no deseado.
            </p>
          ) : confirmandoCopia ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">
                Vamos a enviar una copia del registro a <strong>{yaInscripto.mail_mask}</strong>, el
                correo de tu inscripción. ¿Confirmás?
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn-primary flex-1"
                  onClick={enviarCopia}
                  disabled={enviandoCopia}
                >
                  {enviandoCopia ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />}
                  {enviandoCopia ? 'Enviando…' : 'Sí, enviar copia'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setConfirmandoCopia(false)}
                  disabled={enviandoCopia}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirmandoCopia(true)}
            >
              <Mail size={15} />
              Enviarme una copia del registro por mail
            </button>
          )}
        </div>

        <button type="button" className="btn-primary w-full mt-6" onClick={cerrarFormulario}>
          <X size={16} />
          Cerrar Formulario
        </button>
      </div>
    )
  }

  async function enviarCopia() {
    setEnviandoCopia(true)
    try {
      const res = await fetch(`/api/eventos/${evento.slug}/reenviar-acuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: documento.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo enviar la copia')
        return
      }
      setCopiaEnviada(true)
      setConfirmandoCopia(false)
    } catch {
      toast.error('Error de conexión')
    } finally {
      setEnviandoCopia(false)
    }
  }

  async function verificar() {
    const doc = documento.trim()
    if (doc.replace(/[\s.\-]/g, '').length < 6) {
      toast.error('Ingresá una cédula válida')
      return
    }
    setVerificando(true)
    try {
      const res = await fetch(`/api/eventos/${evento.slug}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: doc }),
      })
      const data = (await res.json()) as ResolucionPublica & { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo verificar')
        return
      }
      // Ya inscripto: no hay formulario que completar, se le muestra el aviso
      // con su modalidad y estado de pago.
      if (data.inscripcion_previa) {
        setYaInscripto(data.inscripcion_previa)
        return
      }
      // No está en el padrón y la cédula no verifica: es un error de tipeo. Se
      // le avisa acá y no se le abre el formulario (el server lo rechazaría).
      if (data.cedula_invalida) {
        toast.error('La cédula no es válida. Revisá el número.')
        return
      }
      // Cada verificación arranca de cero: lo que haya en los campos es de la
      // cédula anterior, no de esta persona (ver limpiarDatosPersona).
      limpiarDatosPersona()
      setResuelto(data)
      // Pre-seleccionar la categoría que el socio tiene definida en la BD, si
      // está disponible en el evento (y con costo, con tarifa para su tipo).
      let preseleccion = ''
      if (data.categoria_id) {
        if (conCosto) {
          const c = evento.categorias.find((x) => x.categoria_id === data.categoria_id)
          const precio = c
            ? data.tipo_participante === 'socio'
              ? c.precio_socio
              : c.precio_no_socio
            : null
          if (c && precio != null) preseleccion = data.categoria_id
        } else if (evento.categorias_socio.some((x) => x.id === data.categoria_id)) {
          preseleccion = data.categoria_id
        }
      }
      setCategoriaId(preseleccion)
      // No se pre-rellenan nombre/apellido/mail en claro: el lookup sólo entrega
      // versiones enmascaradas (`*_mask`), que se muestran como placeholder para
      // que el socio se reconozca. Si deja un campo vacío, el server lo completa
      // desde su ficha al inscribir.
      if (data.tipo_participante === 'socio') {
        toast.success('Se aplica la tarifa Socio')
      } else {
        toast('Se aplica la tarifa No socio', { icon: 'ℹ️' })
      }
    } catch {
      toast.error('Error de conexión')
    } finally {
      setVerificando(false)
    }
  }

  /** Re-consulta el lookup para traer el detalle de la inscripción ya existente. */
  async function consultarInscripcionPrevia(): Promise<InscripcionPrevia | null> {
    try {
      const res = await fetch(`/api/eventos/${evento.slug}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: documento.trim() }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as ResolucionPublica
      return data.inscripcion_previa
    } catch {
      return null
    }
  }

  async function enviar(modalidad: ModalidadInscripcion) {
    // Para un socio verificado, un campo vacío se completa desde su ficha: sólo
    // se exige lo que no está en la ficha.
    if (!nombre.trim() && !nombreEnFicha) {
      toast.error('El nombre es obligatorio')
      return
    }
    if (cfg.mostrar_apellido && cfg.apellido_obligatorio && !apellido.trim() && !apellidoEnFicha) {
      toast.error('El apellido es obligatorio')
      return
    }
    if (cfg.mostrar_email && cfg.email_obligatorio && !mail.trim() && !mailEnFicha) {
      toast.error('El email es obligatorio')
      return
    }
    // Teléfono obligatorio para todos (salvo que ya esté en la ficha del socio).
    if (cfg.mostrar_telefono && !telefono.trim() && !telefonoEnFicha) {
      toast.error('El teléfono es obligatorio')
      return
    }
    if (categoriaVisible && !categoriaId) {
      toast.error('Elegí una categoría')
      return
    }
    if (esOtros && !categoriaOtros.trim()) {
      toast.error('Escribí tu categoría')
      return
    }
    // Tipo de alimentación obligatorio si el evento ofrece opciones y se reserva.
    const alimTipoFinal = llevaAlimentacion
      ? alimentacionTipo === ALIM_OTROS
        ? alimentacionOtros.trim()
        : alimentacionTipo
      : ''
    if (alimentacionVisible && llevaAlimentacion && alim.opciones.length > 0 && !alimTipoFinal) {
      toast.error('Elegí el tipo de alimentación')
      return
    }
    // "Pago realizado": la referencia de la transferencia es obligatoria.
    if (modalidad === 'pago_transferencia' && !referenciaTransferencia.trim()) {
      toast.error('Ingresá la referencia de la transferencia')
      return
    }
    setEnviando(true)
    try {
      const res = await fetch(`/api/eventos/${evento.slug}/inscribir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documento: documento.trim(),
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          mail: mail.trim(),
          telefono: telefono.trim(),
          categoria_id: esOtros ? '' : categoriaId,
          categoria_otros: esOtros ? categoriaOtros.trim() : '',
          lleva_transporte: llevaTransporteEfectivo,
          lleva_alimentacion: llevaAlimentacion,
          alimentacion_tipo: alimTipoFinal,
          referencia_transferencia: referenciaTransferencia.trim(),
          modalidad,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // 409 por cédula ya inscripta (se inscribió en otra pestaña / antes de
        // que verificara): mismo aviso que en el paso de verificación, no un
        // toast que se va. Los otros 409 (cupo lleno) sí son un toast.
        if (res.status === 409) {
          const previa = await consultarInscripcionPrevia()
          if (previa) {
            setYaInscripto(previa)
            return
          }
        }
        toast.error(data.error ?? 'No se pudo registrar')
        return
      }
      setResultado(data.inscripcion as Resultado)
    } catch {
      toast.error('Error de conexión')
    } finally {
      setEnviando(false)
    }
  }

  // Ninguna modalidad habilitada: no se puede inscribir por la web.
  if (modalidadesDisponibles.length === 0) {
    return (
      <div className="card p-8 text-center rise">
        <p className="font-display text-2xl font-medium mb-2">Inscripción no disponible</p>
        <p className="text-ink-2">La inscripción online de este evento no está habilitada. Consultá con la organización.</p>
      </div>
    )
  }

  // Pantalla de elección (sólo si hay más de una opción y no se eligió aún).
  if (!modalidadElegida) {
    const opcion = (
      onClick: () => void,
      icono: React.ReactNode,
      titulo: string,
      detalle: string,
    ) => (
      <button
        type="button"
        className="w-full text-left rounded-xl border border-line hover:border-ink transition p-5 flex items-start gap-4"
        onClick={onClick}
      >
        {icono}
        <span>
          <span className="block font-medium text-lg">{titulo}</span>
          <span className="block text-sm text-ink-2 mt-0.5">{detalle}</span>
        </span>
      </button>
    )
    return (
      <div className="rise space-y-5">
        <p className="label-mono">¿Qué querés hacer?</p>
        {pagoRealizadoDisponible &&
          opcion(
            () => setModalidadElegida('pago_realizado'),
            <Landmark size={22} className="mt-0.5 shrink-0" />,
            'Ya realicé el pago',
            'Transferiste y querés registrar el pago. Te vamos a pedir la referencia del comprobante.',
          )}
        {preinscripcionDisponible &&
          opcion(
            () => setModalidadElegida('preinscripcion'),
            <CalendarClock size={22} className="mt-0.5 shrink-0" />,
            'Preinscripción (pago después)',
            'Reservás tu cupo ahora y coordinás el pago con la organización más adelante.',
          )}
        {/* No inscribe: declara la transferencia de una preinscripción ya hecha. */}
        {registrarPagoDisponible &&
          opcion(
            () => setModalidadElegida('registrar_pago'),
            <Receipt size={22} className="mt-0.5 shrink-0" />,
            'Ya me inscribí — sólo registrar mi pago',
            'Te preinscribiste antes y ahora transferiste. Registrá la referencia para que la organización confirme tu lugar.',
          )}
      </div>
    )
  }

  // Registro de pago de una preinscripción previa: no pasa por el formulario de
  // inscripción, sólo pide cédula + referencia.
  if (modalidadElegida === 'registrar_pago') {
    return (
      <RegistrarPago slug={evento.slug} onVolver={() => setModalidadElegida(modalidadUnica)} />
    )
  }

  const esPagoRealizado = modalidadElegida === 'pago_realizado'

  return (
    <div className="rise space-y-8">
      {/* Modalidad elegida (con opción de cambiar si hay más de una) */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper-2 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-mono">
          {esPagoRealizado ? <Landmark size={15} /> : <CalendarClock size={15} />}
          {esPagoRealizado ? 'Ya realicé el pago' : 'Preinscripción (pago después)'}
        </span>
        {/* Hay pantalla de elección a la que volver (no se auto-eligió una única opción). */}
        {modalidadUnica == null && (
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => { setModalidadElegida(null); setResuelto(null) }}
            disabled={enviando}
          >
            Cambiar
          </button>
        )}
      </div>

      {/* Paso 1 — Cédula */}
      <div>
        <label htmlFor="documento" className="label-mono block mb-1">Cédula</label>
        <div className="flex items-end gap-3">
          <input
            id="documento"
            inputMode="numeric"
            className="field"
            placeholder="1.234.567-2"
            value={documento}
            onChange={(e) => {
              setDocumento(e.target.value)
              // Otra cédula = otra persona: se cierra el paso 2 y se descarta lo
              // que hubiera escrito la anterior.
              setResuelto(null)
              limpiarDatosPersona()
            }}
            disabled={verificando}
          />
          <button type="button" className="btn-primary shrink-0" onClick={verificar} disabled={verificando}>
            {verificando ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {verificando ? 'Buscando…' : 'Verificar'}
          </button>
        </div>
      </div>

      {/* Paso 2 — Datos + categoría (tras verificar) */}
      {resuelto && (
        <form
          className="space-y-7"
          onSubmit={(e) => {
            e.preventDefault()
            enviar(esPagoRealizado ? 'pago_transferencia' : 'reserva')
          }}
        >
          {resuelto.tipo_participante === 'socio' ? (
            <p className="text-sm text-status-ok font-mono">✓ Socio al día — Evento con costo bonificado</p>
          ) : (
            /* No socio. Cubre por igual a quien no está en el padrón y al socio con
               cuotas pendientes: el texto no distingue los dos casos a propósito
               (distinguirlos revelaría la deuda de cualquiera cuya cédula se tipee).
               En ambos, la persona completa sus datos y elige con tarifa No socio. */
            <div className="rounded-lg border border-line bg-paper-2 px-4 py-3">
              <p className="font-medium">Completá tus datos para inscribirte</p>
              <p className="flex items-start gap-2 text-sm text-ink-2 mt-1">
                <Info size={15} className="mt-0.5 shrink-0" />
                <span>
                  Se aplica la tarifa <strong>No socio</strong>. Si sos socio y tenés cuotas
                  pendientes, consultá con la organización.
                </span>
              </p>
            </div>
          )}

          {esSocioAlDia && (
            <p className="flex items-start gap-2 text-[13px] text-ink-2 border border-line rounded-lg bg-paper-2 px-4 py-3">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span>
                Tus datos ya están registrados (los mostramos parcialmente para que los
                reconozcas) y no se pueden editar acá: usamos los de tu ficha, y el mail de
                confirmación llega con tus datos reales. Sólo tenés que completar lo que falte.
                Si alguno cambió, escribinos por correo y lo actualizamos.
              </span>
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label htmlFor="nombre" className="label-mono block mb-1">Nombre</label>
              {nombreEnFicha ? (
                <DatoDeFicha id="nombre" valor={resuelto!.nombre_mask!} />
              ) : (
                <input id="nombre" className="field" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              )}
            </div>
            {cfg.mostrar_apellido && (
              <div>
                <label htmlFor="apellido" className="label-mono block mb-1">
                  Apellido{cfg.apellido_obligatorio && !apellidoEnFicha ? ' *' : ''}
                </label>
                {apellidoEnFicha ? (
                  <DatoDeFicha id="apellido" valor={resuelto!.apellido_mask!} />
                ) : (
                  <input id="apellido" className="field" value={apellido} onChange={(e) => setApellido(e.target.value)} required={cfg.apellido_obligatorio} />
                )}
              </div>
            )}
            {cfg.mostrar_email && (
              <div>
                <label htmlFor="mail" className="label-mono block mb-1">
                  Email{cfg.email_obligatorio && !mailEnFicha ? ' *' : ''}
                </label>
                {mailEnFicha ? (
                  <DatoDeFicha id="mail" valor={resuelto!.mail_mask!} />
                ) : (
                  <input id="mail" type="email" className="field" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="tu@correo.com" required={cfg.email_obligatorio} />
                )}
              </div>
            )}
            {cfg.mostrar_telefono && (
              <div>
                <label htmlFor="telefono" className="label-mono block mb-1">
                  Teléfono{!telefonoEnFicha ? ' *' : ''}
                </label>
                {telefonoEnFicha ? (
                  <DatoDeFicha id="telefono" valor={resuelto!.telefono_mask!} />
                ) : (
                  <input id="telefono" inputMode="tel" className="field" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="099 123 456" required />
                )}
              </div>
            )}
          </div>

          {categoriaVisible && (
          <fieldset>
            <legend className="label-mono mb-3">
              Categoría{conCosto ? ` · tarifa ${tipo === 'socio' ? 'Socio' : 'No socio'}` : ''}
            </legend>
            <div className="space-y-3">
              {opcionesCategoria.map((c) => {
                // Sólo se deshabilita por falta de precio en eventos con costo.
                const disabled = conCosto && c.precio == null
                const selected = categoriaId === c.id
                return (
                  <label
                    key={c.id}
                    className={[
                      'flex items-center justify-between gap-4 p-4 rounded-xl border cursor-pointer transition',
                      disabled
                        ? 'border-line opacity-50 cursor-not-allowed'
                        : selected
                          ? 'border-ink bg-paper-2 shadow-[2px_2px_0_var(--color-ink)]'
                          : 'border-line hover:border-ink',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="categoria"
                        className="accent-amber-deep"
                        value={c.id}
                        checked={selected}
                        disabled={disabled}
                        onChange={() => setCategoriaId(c.id)}
                      />
                      <span className="font-medium">{c.nombre}</span>
                    </div>
                    {conCosto && (
                      <span className="font-mono font-semibold">
                        {c.precio != null ? formatImporte(c.precio, evento.moneda_codigo) : '—'}
                      </span>
                    )}
                  </label>
                )
              })}

              {/* Otros — categoría libre escrita por el participante */}
              {permitirOtros && (
                <label
                  className={[
                    'flex items-center justify-between gap-4 p-4 rounded-xl border cursor-pointer transition',
                    esOtros
                      ? 'border-ink bg-paper-2 shadow-[2px_2px_0_var(--color-ink)]'
                      : 'border-line hover:border-ink',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="categoria"
                      className="accent-amber-deep"
                      value={OTROS}
                      checked={esOtros}
                      onChange={() => setCategoriaId(OTROS)}
                    />
                    <span className="font-medium">Otros</span>
                  </div>
                  {conCosto && precioMaxOtros != null && (
                    <span className="font-mono font-semibold">
                      {formatImporte(precioMaxOtros, evento.moneda_codigo)}
                    </span>
                  )}
                </label>
              )}

              {permitirOtros && esOtros && (
                <div className="pl-4">
                  <input
                    className="field"
                    placeholder="Escribí tu categoría"
                    value={categoriaOtros}
                    onChange={(e) => setCategoriaOtros(e.target.value)}
                    maxLength={60}
                    autoFocus
                  />
                  {conCosto && precioMaxOtros != null && (
                    <p className="mt-2 text-[11px] font-mono text-ink-3">
                      Se aplica la tarifa {tipo === 'socio' ? 'Socio' : 'No socio'} más alta del evento
                      ({formatImporte(precioMaxOtros, evento.moneda_codigo)}).
                    </p>
                  )}
                </div>
              )}
            </div>
          </fieldset>
          )}

          {transporteVisible && (
            <div className="border-t border-line pt-5">
              {/* Barra de cupo de transporte (sólo si el transporte tiene tope). */}
              {transp.completo ? (
                <div className="mb-4 max-w-[16rem]">
                  <span className="block mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] font-medium text-status-no">
                    Transporte completo
                  </span>
                  <div className="h-2 rounded-full bg-paper-3 overflow-hidden">
                    <div className="h-full rounded-full bg-status-no" style={{ width: '100%' }} />
                  </div>
                </div>
              ) : (
                transp.ocupacion_nivel && (
                  <div className="mb-4 max-w-[16rem]">
                    <span
                      className={`block mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] font-medium ${BARRA_TRANSPORTE[transp.ocupacion_nivel].texto_cls}`}
                    >
                      {BARRA_TRANSPORTE[transp.ocupacion_nivel].texto}
                    </span>
                    <div className="h-2 rounded-full bg-paper-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${BARRA_TRANSPORTE[transp.ocupacion_nivel].barra_cls}`}
                        style={{ width: BARRA_TRANSPORTE[transp.ocupacion_nivel].fill }}
                      />
                    </div>
                  </div>
                )
              )}
              <label
                className={`flex items-start gap-3 ${transp.completo ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  className="accent-amber-deep w-4 h-4 mt-1"
                  checked={llevaTransporte && !transp.completo}
                  disabled={transp.completo}
                  onChange={(e) => setLlevaTransporte(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Necesito transporte</span>
                  {transp.completo && (
                    <span className="block text-sm text-status-no mt-0.5">
                      Se agotaron los lugares de transporte. Podés inscribirte al evento sin transporte.
                    </span>
                  )}
                  {transp.descripcion && (
                    <span className="block text-sm text-ink-2 mt-0.5">{transp.descripcion}</span>
                  )}
                  <span className="block text-sm font-mono text-ink-2 mt-0.5">
                    {transp.con_costo
                      ? formatImporte(
                          tipo === 'socio' ? transp.importe_socio : transp.importe_no_socio,
                          evento.moneda_codigo,
                        )
                      : 'Sin costo'}
                  </span>
                </span>
              </label>
            </div>
          )}

          {alimentacionVisible && (
            <div className="border-t border-line pt-5 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-amber-deep w-4 h-4 mt-1"
                  checked={llevaAlimentacion}
                  onChange={(e) => setLlevaAlimentacion(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Reservar alimentación</span>
                  {alim.descripcion && (
                    <span className="block text-sm text-ink-2 mt-0.5">{alim.descripcion}</span>
                  )}
                  <span className="block text-sm font-mono text-ink-2 mt-0.5">
                    {alim.con_costo
                      ? formatImporte(
                          tipo === 'socio' ? alim.importe_socio : alim.importe_no_socio,
                          evento.moneda_codigo,
                        )
                      : 'Sin costo'}
                  </span>
                </span>
              </label>

              {llevaAlimentacion && alim.opciones.length > 0 && (
                <div className="pl-7">
                  <label htmlFor="alim-tipo" className="label-mono block mb-1">Tipo de alimentación *</label>
                  <select
                    id="alim-tipo"
                    className="field"
                    value={alimentacionTipo}
                    onChange={(e) => setAlimentacionTipo(e.target.value)}
                  >
                    <option value="">— Elegir —</option>
                    {alim.opciones.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                    <option value={ALIM_OTROS}>Otros</option>
                  </select>
                  {alimentacionTipo === ALIM_OTROS && (
                    <input
                      className="field mt-2"
                      placeholder="Especificá tu preferencia"
                      value={alimentacionOtros}
                      onChange={(e) => setAlimentacionOtros(e.target.value)}
                      maxLength={60}
                      autoFocus
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {cfg.mostrar_total && (conCosto || transporteImporte > 0 || alimentacionImporte > 0) && (
            <div className="flex justify-between items-baseline border-t border-line pt-4">
              <span className="label-mono">Total</span>
              <span className="font-mono text-xl font-semibold">
                {formatImporte(total, evento.moneda_codigo)}
              </span>
            </div>
          )}

          {esPagoRealizado ? (
            <div className="space-y-3 border-t border-line pt-5">
              {evento.datos_deposito && (
                <div className="rounded-xl border border-ink bg-paper-2 p-5">
                  <p className="flex items-center gap-2 label-mono mb-3">
                    <Landmark size={15} /> Datos para la transferencia
                  </p>
                  <p className="font-mono text-sm text-ink-1 whitespace-pre-line">
                    {evento.datos_deposito}
                  </p>
                </div>
              )}
              <div>
                <label htmlFor="referencia" className="label-mono block mb-1">
                  Referencia de la transferencia *
                </label>
                <input
                  id="referencia"
                  className="field"
                  placeholder="N° de comprobante de la transferencia que hiciste"
                  value={referenciaTransferencia}
                  onChange={(e) => setReferenciaTransferencia(e.target.value)}
                  maxLength={80}
                  disabled={enviando}
                />
              </div>

              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => enviar('pago_transferencia')}
                disabled={enviando}
              >
                {enviando ? <Loader2 className="animate-spin" size={16} /> : <Landmark size={16} />}
                {enviando ? 'Registrando…' : 'Confirmar inscripción y pago'}
              </button>
              <p className="text-[12px] text-ink-3 text-center">
                La organización va a verificar la transferencia para confirmar tu inscripción.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => enviar('reserva')}
              disabled={enviando}
            >
              {enviando ? <Loader2 className="animate-spin" size={16} /> : <Ticket size={16} />}
              {enviando ? 'Registrando…' : 'Confirmar preinscripción'}
            </button>
          )}

          <div className="text-center">
            <button
              type="button"
              className="btn-ghost"
              onClick={cerrarFormulario}
              disabled={enviando}
            >
              <X size={15} />
              Cerrar Formulario
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
