'use client'

/**
 * Ficha de socio: segundo factor → formulario → enviado.
 *
 * Misma máquina de fases que Postulacion.tsx, con dos diferencias de fondo:
 *
 *  · El FACTOR SE RETIENE en memoria tras validarlo: `registrar_ficha_cambio`
 *    lo revalida al guardar (no confía en que /validar haya ocurrido), así que
 *    hay que volver a mandarlo. Nunca toca sessionStorage/localStorage — vive
 *    en el estado del componente y muere con la pestaña.
 *
 *  · Al enviar viajan SOLO los campos tocados (distintos de lo que vino de la
 *    ficha). Un campo vaciado tampoco viaja: no existe el borrado remoto de
 *    datos — mismo criterio que las inscripciones de eventos.
 *
 * El modo del factor viene del server: 'cedula' pide los últimos N dígitos del
 * documento; 'codigo' pide el código del mail (la cédula registrada no valida
 * el dígito verificador) y habilita el único caso en que se puede proponer
 * 'documento': cargar la cédula correcta.
 */

import { useRef, useState } from 'react'
import { FileText, Loader2, Lock, Pencil } from 'lucide-react'
import { esCedulaUruguayaValida } from '@/lib/cedula'
import {
  configDe,
  LABELS_CAMPOS,
  limpiarCodigo,
  limpiarDocumento,
  mensajeDeErrorFicha,
  type CampoFicha,
  type ErrorFicha,
  type FichaValidada,
  type ItemCatalogo,
  type MensajeFicha,
  type ModoFactor,
} from '@/lib/ficha-types'

type Fase = 'factor' | 'formulario' | 'listo' | 'cortado'

/** Resultado de una llamada, ya separado en "pasó algo que entiendo" y "no sé". */
type Llamada<T> =
  | { estado: 'ok'; data: T }
  | { estado: 'error'; err: ErrorFicha }
  | { estado: 'tope' }
  | { estado: 'sin_respuesta' }

async function pedir<T>(url: string, body: unknown): Promise<Llamada<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    return { estado: 'sin_respuesta' }
  }
  if (res.status === 429) return { estado: 'tope' }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { estado: 'sin_respuesta' }
  }
  if (!data || typeof data !== 'object') return { estado: 'sin_respuesta' }

  const d = data as Record<string, unknown>
  if (d.ok === true) return { estado: 'ok', data: d as T }
  if (res.status >= 500) return { estado: 'sin_respuesta' }
  if (typeof d.error === 'string') return { estado: 'error', err: d as unknown as ErrorFicha }
  return { estado: 'sin_respuesta' }
}

const MENSAJE_TOPE: MensajeFicha = {
  titulo: 'Demasiados intentos',
  detalle: 'Esperá un momento y volvé a probar.',
  terminal: false,
}

function arriba() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function Aviso({ msj }: { msj: MensajeFicha }) {
  return (
    <div className={`voto-aviso voto-aviso--${msj.terminal ? 'alto' : 'medio'} mb-6`} role="alert">
      <h2 className="font-display text-2xl font-medium leading-tight mb-2">{msj.titulo}</h2>
      <p className="text-ink-2 text-[17px] leading-relaxed">{msj.detalle}</p>
    </div>
  )
}

/** Los valores del formulario, todos string (los ids de membresía incluidos). */
type Valores = Partial<Record<CampoFicha, string>>

/**
 * El estado inicial de cada campo, en dos capas: `original` es lo que dice la
 * ficha HOY (contra eso se calcula qué viaja) y `inicial` lo que se muestra —
 * la propuesta pendiente pisa a la ficha, para que quien vuelve a entrar vea
 * lo que ya envió y no crea que se perdió.
 */
function armarValores(v: FichaValidada): { original: Valores; inicial: Valores } {
  const original: Valores = {
    nombre: v.ficha.nombre,
    apellido: v.ficha.apellido,
    sexo: v.ficha.sexo === 'M' || v.ficha.sexo === 'F' ? v.ficha.sexo : '',
    fecha_nacimiento: v.ficha.fecha_nacimiento,
    generacion: v.membresia.generacion,
    fecha_recibido: v.membresia.fecha_recibido,
    telefono: v.ficha.telefono,
    celular: v.ficha.celular,
    mail: v.ficha.mail,
    direccion: v.ficha.direccion,
    localidad: v.ficha.localidad,
    categoria_id: v.membresia.categoria_id,
    forma_pago_id: v.membresia.forma_pago_id,
    estado_registro_id: v.membresia.estado_registro_id,
    tipo_pago_id: v.membresia.tipo_pago_id,
    instituto_id: v.membresia.instituto_id,
    documento: '',
  }
  const inicial: Valores = { ...original }
  if (v.cambios_pendientes) {
    for (const [campo, valor] of Object.entries(v.cambios_pendientes)) {
      if (typeof valor === 'string') inicial[campo as CampoFicha] = valor
    }
  }
  return { original, inicial }
}

// ── Piezas del formulario ───────────────────────────────────────────────────

function Campo({
  id,
  label,
  obligatorio = false,
  falta = false,
  children,
}: {
  id: string
  label: string
  /** El desktop lo marcó obligatorio: rótulo resaltado + asterisco. */
  obligatorio?: boolean
  /** Quedó vacío en un intento de envío: rótulo en rojo hasta completarlo. */
  falta?: boolean
  children: React.ReactNode
}) {
  const color = falta ? 'text-red-700' : obligatorio ? 'text-amber-deep' : ''
  return (
    <div>
      <label htmlFor={id} className={`label-mono block mb-1.5 ${color}`}>
        {label}
        {obligatorio && <span aria-hidden> *</span>}
      </label>
      {children}
    </div>
  )
}

/**
 * Un select de membresía. Si la empresa no publicó opciones para este catálogo
 * el campo queda de sólo lectura con el nombre actual: un select vacío invita
 * a "elegir nada" y eso no es una propuesta.
 */
function SelectMembresia({
  id,
  label,
  opciones,
  valor,
  nombreActual,
  obligatorio = false,
  falta = false,
  onChange,
}: {
  id: string
  label: string
  opciones: ItemCatalogo[]
  valor: string
  nombreActual: string
  obligatorio?: boolean
  falta?: boolean
  onChange: (v: string) => void
}) {
  if (opciones.length === 0) {
    return (
      <Campo id={id} label={label} obligatorio={obligatorio} falta={falta}>
        <input id={id} className="field" value={nombreActual || '—'} readOnly tabIndex={-1} />
      </Campo>
    )
  }
  return (
    <Campo id={id} label={label} obligatorio={obligatorio} falta={falta}>
      <select id={id} className="field" value={valor} onChange={(e) => onChange(e.target.value)}>
        {/* La opción vacía existe sólo si la ficha no tiene valor hoy: elegirla
            no viaja (vaciar no es una propuesta). */}
        {valor === '' && <option value="">Sin asignar</option>}
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
        {/* El valor actual puede no estar entre las opciones publicadas (una
            categoría vieja). Se agrega para que el select no lo "cambie" solo. */}
        {valor !== '' && !opciones.some((o) => o.id === valor) && (
          <option value={valor}>{nombreActual || '(actual)'}</option>
        )}
      </select>
    </Campo>
  )
}

// ── El componente ───────────────────────────────────────────────────────────

export function FichaForm({
  token,
  modoFactor,
  verificacionDigitos,
}: {
  token: string
  modoFactor: ModoFactor
  verificacionDigitos: number
}) {
  const base = `/api/ficha/${token}`

  const [fase, setFase] = useState<Fase>('factor')
  const [entrada, setEntrada] = useState('') // lo tipeado en el paso del factor
  const [factor, setFactor] = useState('') // el factor ya validado, para guardar
  const [datos, setDatos] = useState<FichaValidada | null>(null)
  const [original, setOriginal] = useState<Valores>({})
  const [valores, setValores] = useState<Valores>({})
  const [aviso, setAviso] = useState<MensajeFicha | null>(null)
  const [cortado, setCortado] = useState<MensajeFicha | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // El PDF del título elegido, todavía sin subir: sube recién al enviar, así
  // un PDF elegido y arrepentido no deja nada en el servidor.
  const [tituloFile, setTituloFile] = useState<File | null>(null)
  // true = el server mandó el mail de acuse con el detalle antes → después.
  const [acuseEnviado, setAcuseEnviado] = useState(false)
  // Obligatorios que quedaron vacíos en el último intento de envío.
  const [faltantes, setFaltantes] = useState<Set<string>>(new Set())
  const tituloInputRef = useRef<HTMLInputElement>(null)
  const enVuelo = useRef(false)

  const MAX_TITULO_BYTES = 10 * 1024 * 1024

  const esCodigo = modoFactor === 'codigo'

  function mostrar(err: ErrorFicha) {
    const msj = mensajeDeErrorFicha(err, modoFactor)
    if (msj.terminal) {
      setCortado(msj)
      setFase('cortado')
    } else {
      setAviso(msj)
    }
    arriba()
  }

  function setCampo(campo: CampoFicha, v: string) {
    setValores((prev) => ({ ...prev, [campo]: v }))
  }

  // ── Paso 1 · el factor ────────────────────────────────────────────────────

  const factorLimpio = esCodigo ? limpiarCodigo(entrada) : entrada.replace(/\D/g, '')
  const factorIncompleto = esCodigo
    ? factorLimpio.length < 4
    : factorLimpio.length !== verificacionDigitos

  async function onValidar(e: React.FormEvent) {
    e.preventDefault()
    if (enVuelo.current || factorIncompleto) return
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    const r = await pedir<FichaValidada>(`${base}/validar`, { factor: factorLimpio })
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok') {
      const { original: orig, inicial } = armarValores(r.data)
      setDatos(r.data)
      setOriginal(orig)
      setValores(inicial)
      setFactor(factorLimpio)
      setEntrada('')
      setFase('formulario')
      arriba()
      return
    }
    if (r.estado === 'error') {
      if (r.err.error === 'factor_incorrecto') setEntrada('')
      mostrar(r.err)
      return
    }
    setAviso(
      r.estado === 'tope'
        ? MENSAJE_TOPE
        : {
            titulo: 'No pudimos verificarte',
            detalle: 'Revisá tu conexión y volvé a probar.',
            terminal: false,
          },
    )
  }

  // ── Paso 2 · enviar la propuesta ──────────────────────────────────────────

  /** Sólo lo tocado y no vacío. `documento` además limpio y sólo en modo código. */
  function cambiosAEnviar(): Record<string, string> {
    const cambios: Record<string, string> = {}
    for (const [campo, valor] of Object.entries(valores)) {
      if (typeof valor !== 'string') continue
      const v = valor.trim()
      if (campo === 'documento') {
        if (!esCodigo) continue
        const doc = limpiarDocumento(v)
        if (doc !== '') cambios.documento = doc
        continue
      }
      if (v === '') continue // vaciar no viaja
      if (v === (original[campo as CampoFicha] ?? '').trim()) continue
      cambios[campo] = v
    }
    return cambios
  }

  /** Elegir el PDF del título: se valida acá, se sube recién al enviar. */
  function onTituloElegido(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    e.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setAviso({ titulo: 'El título tiene que ser un PDF', detalle: 'Elegí el archivo escaneado en formato PDF.', terminal: false })
      return
    }
    if (file.size > MAX_TITULO_BYTES) {
      setAviso({
        titulo: 'El archivo es demasiado grande',
        detalle: `Pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es 10 MB. Volvé a escanearlo en menor calidad.`,
        terminal: false,
      })
      return
    }
    setAviso(null)
    setTituloFile(file)
  }

  /** Sube el PDF a Storage vía signed URL. Devuelve false si algo falló (ya con aviso puesto). */
  async function subirTitulo(file: File): Promise<boolean> {
    const r = await pedir<{ ok: true; upload_url: string }>(`${base}/titulo`, { factor })
    if (r.estado !== 'ok') {
      if (r.estado === 'error') mostrar(r.err)
      else setAviso(r.estado === 'tope' ? MENSAJE_TOPE : {
        titulo: 'No pudimos preparar la subida del título',
        detalle: 'Revisá tu conexión y volvé a probar.',
        terminal: false,
      })
      return false
    }
    try {
      const res = await fetch(r.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return true
    } catch {
      setAviso({
        titulo: 'No se pudo subir el título',
        detalle: 'Revisá tu conexión y volvé a intentar. Los demás cambios no se enviaron todavía.',
        terminal: false,
      })
      return false
    }
  }

  async function onEnviar(e: React.FormEvent) {
    e.preventDefault()
    if (enVuelo.current) return

    // Obligatorios (los marcó el desktop): el campo tiene que quedar CON valor
    // — si la ficha ya lo traía, no hace falta tocarlo. Se chequea sobre lo
    // que muestra el formulario, no sobre lo que viaja.
    if (datos) {
      const vacios: string[] = []
      const aplicables = [
        'nombre', 'apellido', 'sexo', 'fecha_nacimiento', 'generacion',
        ...(datos.membresia.titulo_aplica ? ['fecha_recibido'] : []),
        'telefono', 'celular', 'mail', 'direccion', 'localidad',
        'categoria_id', 'forma_pago_id', 'estado_registro_id', 'tipo_pago_id', 'instituto_id',
      ]
      for (const campo of aplicables) {
        const cfg = configDe(datos.campos, campo)
        if (!cfg.visible || !cfg.obligatorio) continue
        if ((valores[campo as CampoFicha] ?? '').trim() === '') vacios.push(campo)
      }
      const cfgTitulo = configDe(datos.campos, 'titulo_pdf')
      if (
        datos.membresia.titulo_aplica && cfgTitulo.visible && cfgTitulo.obligatorio &&
        !tituloFile && !datos.membresia.titulo_cargado
      ) {
        vacios.push('titulo_pdf')
      }
      if (vacios.length > 0) {
        setFaltantes(new Set(vacios))
        setAviso({
          titulo: 'Faltan datos obligatorios',
          detalle: `Completá: ${vacios.map((c) => LABELS_CAMPOS[c] ?? c).join(', ')}. Están marcados con *.`,
          terminal: false,
        })
        arriba()
        return
      }
      setFaltantes(new Set())
    }

    const cambios = cambiosAEnviar()
    if (Object.keys(cambios).length === 0 && !tituloFile) {
      setAviso({
        titulo: 'No hay cambios para enviar',
        detalle: 'Modificá al menos un dato antes de enviar. Si está todo bien, no hace falta hacer nada.',
        terminal: false,
      })
      arriba()
      return
    }
    // La única validación local que corta: la cédula corregida tiene que pasar
    // el dígito verificador — reemplazar un error de carga por otro no arregla
    // nada. El server exige lo mismo.
    if (cambios.documento && !esCedulaUruguayaValida(cambios.documento)) {
      setAviso({
        titulo: 'La cédula no es válida',
        detalle:
          'Revisá el número completo, con el dígito verificador. Podés escribirla con o sin puntos y guiones.',
        terminal: false,
      })
      arriba()
      return
    }

    enVuelo.current = true
    setOcupado(true)
    setAviso(null)

    // Primero el PDF (si hay): guardar recién registra la propuesta cuando el
    // archivo ya está en Storage — la RPC lo verifica y lo suma sola.
    if (tituloFile) {
      const subido = await subirTitulo(tituloFile)
      if (!subido) {
        enVuelo.current = false
        setOcupado(false)
        arriba()
        return
      }
    }

    const r = await pedir<{ ok: true; id: string; acuse_enviado?: boolean }>(`${base}/guardar`, {
      factor,
      cambios,
      subio_titulo: !!tituloFile,
    })
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok') {
      setAcuseEnviado(r.data.acuse_enviado === true)
      setFase('listo')
      arriba()
      return
    }
    if (r.estado === 'error') {
      mostrar(r.err)
      return
    }
    setAviso(
      r.estado === 'tope'
        ? MENSAJE_TOPE
        : {
            titulo: 'No pudimos enviar los cambios',
            detalle: 'Revisá tu conexión y volvé a probar. Si ya lo intentaste, esperá un momento.',
            terminal: false,
          },
    )
  }

  // ── Pantallas ─────────────────────────────────────────────────────────────

  if (fase === 'cortado' && cortado) {
    return (
      <div className="rise">
        <Aviso msj={cortado} />
      </div>
    )
  }

  if (fase === 'listo') {
    return (
      <div className="rise">
        <div className="voto-aviso voto-aviso--ok" role="status">
          <h2 className="font-display text-2xl font-medium leading-tight mb-2">
            Cambios enviados
          </h2>
          <p className="text-ink-2 text-[17px] leading-relaxed">
            Los recibió la asociación y los va a revisar antes de aplicarlos. No tenés que
            hacer nada más — si hiciera falta aclarar algo, te contactan al mail de tu ficha.
            {acuseEnviado && ' Te mandamos un mail con el detalle de lo que enviaste.'}
          </p>
        </div>
      </div>
    )
  }

  if (fase === 'factor') {
    return (
      <div className="rise">
        {aviso && <Aviso msj={aviso} />}
        <form onSubmit={onValidar} className="card p-6 sm:p-7">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-amber-deep" aria-hidden />
            <span className="label-mono">Verificá que sos vos</span>
          </div>
          {esCodigo ? (
            <>
              <label htmlFor="factor" className="block text-[17px] leading-relaxed mb-5">
                Escribí el <span className="hl hl-thin">código de ingreso</span> que figura en
                el mail donde te llegó este link.
              </label>
              <input
                id="factor"
                className="field text-center font-mono tracking-[0.2em]"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                autoFocus
              />
            </>
          ) : (
            <>
              <label htmlFor="factor" className="block text-[17px] leading-relaxed mb-5">
                Escribí los <span className="hl hl-thin">últimos {verificacionDigitos} dígitos</span>{' '}
                de tu cédula, contando el dígito verificador.
              </label>
              <input
                id="factor"
                className="field text-center font-mono tracking-[0.3em]"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                autoComplete="off"
                maxLength={verificacionDigitos}
                autoFocus
              />
            </>
          )}
          <button
            type="submit"
            className="btn-primary w-full mt-7"
            disabled={ocupado || factorIncompleto}
          >
            {ocupado ? <Loader2 className="animate-spin" size={18} /> : null}
            Continuar
          </button>
        </form>
      </div>
    )
  }

  if (!datos) return null

  // ── Formulario ────────────────────────────────────────────────────────────

  const cat = datos.catalogos
  const mem = datos.membresia
  // Config por campo, decidida en el desktop: qué se ve y qué se exige.
  const vis = (campo: string) => configDe(datos.campos, campo).visible
  const obl = (campo: string) => configDe(datos.campos, campo).obligatorio
  const falta = (campo: string) => faltantes.has(campo)
  const hayPersonales = ['nombre', 'apellido', 'sexo', 'fecha_nacimiento', 'generacion']
    .concat(mem.titulo_aplica ? ['fecha_recibido'] : []).some(vis)
  const hayContacto = ['telefono', 'celular', 'mail', 'direccion', 'localidad'].some(vis)
  const hayMembresia = ['categoria_id', 'forma_pago_id', 'estado_registro_id', 'tipo_pago_id', 'instituto_id'].some(vis)
  const hayTitulo = mem.titulo_aplica && vis('titulo_pdf')

  return (
    <div className="rise">
      {aviso && <Aviso msj={aviso} />}

      <form onSubmit={onEnviar} className="card p-6 sm:p-7">
        <div className="flex items-center gap-2 mb-5">
          <Pencil size={16} className="text-amber-deep" aria-hidden />
          <span className="label-mono">Tus datos</span>
        </div>

        {!datos.ficha_encontrada && (
          <p className="text-ink-2 text-[16px] leading-relaxed mb-5">
            No encontramos tu ficha cargada: completá los datos que quieras que la
            asociación registre.
          </p>
        )}

        {/* Documento: la identidad. Con cédula válida no se toca desde acá; con
            cédula inválida corregirla es el punto de todo el circuito. */}
        {esCodigo ? (
          <div className="mb-6 rounded border border-amber-deep/30 bg-amber-deep/5 p-4">
            <p className="text-[16px] leading-relaxed mb-3">
              El documento que tenemos registrado (<strong className="font-mono">{datos.ficha.documento || '—'}</strong>)
              no parece una cédula válida. Cargá tu{' '}
              <span className="hl hl-thin">cédula correcta</span>:
            </p>
            <Campo id="documento" label="Cédula (con dígito verificador)">
              <input
                id="documento"
                className="field font-mono"
                value={valores.documento ?? ''}
                onChange={(e) => setCampo('documento', e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="1.234.567-8"
              />
            </Campo>
          </div>
        ) : (
          <div className="mb-6">
            <Campo id="documento" label="Documento">
              <input id="documento" className="field font-mono" value={datos.ficha.documento} readOnly tabIndex={-1} />
            </Campo>
            <p className="text-ink-3 text-[13px] leading-relaxed mt-1.5">
              La cédula no se puede cambiar desde acá. Si está mal, comunicate con tu asociación.
            </p>
          </div>
        )}

        {hayPersonales && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            {vis('nombre') && (
              <Campo id="nombre" label="Nombre" obligatorio={obl('nombre')} falta={falta('nombre')}>
                <input id="nombre" className="field" value={valores.nombre ?? ''} maxLength={200}
                  onChange={(e) => setCampo('nombre', e.target.value)} autoComplete="given-name" />
              </Campo>
            )}
            {vis('apellido') && (
              <Campo id="apellido" label="Apellido" obligatorio={obl('apellido')} falta={falta('apellido')}>
                <input id="apellido" className="field" value={valores.apellido ?? ''} maxLength={200}
                  onChange={(e) => setCampo('apellido', e.target.value)} autoComplete="family-name" />
              </Campo>
            )}
            {vis('sexo') && (
              <Campo id="sexo" label="Sexo" obligatorio={obl('sexo')} falta={falta('sexo')}>
                <select id="sexo" className="field" value={valores.sexo ?? ''}
                  onChange={(e) => setCampo('sexo', e.target.value)}>
                  {(valores.sexo ?? '') === '' && <option value="">Sin especificar</option>}
                  <option value="F">Femenino</option>
                  <option value="M">Masculino</option>
                </select>
              </Campo>
            )}
            {vis('fecha_nacimiento') && (
              <Campo id="fecha_nacimiento" label="Fecha de nacimiento" obligatorio={obl('fecha_nacimiento')} falta={falta('fecha_nacimiento')}>
                <input id="fecha_nacimiento" type="date" className="field" value={valores.fecha_nacimiento ?? ''}
                  onChange={(e) => setCampo('fecha_nacimiento', e.target.value)} />
              </Campo>
            )}
            {vis('generacion') && (
              <Campo id="generacion" label="Generación" obligatorio={obl('generacion')} falta={falta('generacion')}>
                <input id="generacion" className="field" value={valores.generacion ?? ''} maxLength={200}
                  onChange={(e) => setCampo('generacion', e.target.value)} />
              </Campo>
            )}
            {/* Sólo para no estudiantes: la fecha en que se recibió. */}
            {mem.titulo_aplica && vis('fecha_recibido') && (
              <Campo id="fecha_recibido" label="Fecha de recibido" obligatorio={obl('fecha_recibido')} falta={falta('fecha_recibido')}>
                <input id="fecha_recibido" type="date" className="field" value={valores.fecha_recibido ?? ''}
                  onChange={(e) => setCampo('fecha_recibido', e.target.value)} />
              </Campo>
            )}
          </div>
        )}

        {hayContacto && (
          <>
            <div className="perforated my-7" />
            <span className="label-mono block mb-4">Contacto</span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
              {vis('telefono') && (
                <Campo id="telefono" label="Teléfono" obligatorio={obl('telefono')} falta={falta('telefono')}>
                  <input id="telefono" className="field" value={valores.telefono ?? ''} maxLength={200}
                    onChange={(e) => setCampo('telefono', e.target.value)} inputMode="tel" autoComplete="tel" />
                </Campo>
              )}
              {vis('celular') && (
                <Campo id="celular" label="Celular" obligatorio={obl('celular')} falta={falta('celular')}>
                  <input id="celular" className="field" value={valores.celular ?? ''} maxLength={200}
                    onChange={(e) => setCampo('celular', e.target.value)} inputMode="tel" autoComplete="tel" />
                </Campo>
              )}
              {vis('mail') && (
                <div className="sm:col-span-2">
                  <Campo id="mail" label="Email" obligatorio={obl('mail')} falta={falta('mail')}>
                    <input id="mail" type="email" className="field" value={valores.mail ?? ''} maxLength={200}
                      onChange={(e) => setCampo('mail', e.target.value)} autoComplete="email" />
                  </Campo>
                </div>
              )}
              {vis('direccion') && (
                <Campo id="direccion" label="Dirección" obligatorio={obl('direccion')} falta={falta('direccion')}>
                  <input id="direccion" className="field" value={valores.direccion ?? ''} maxLength={200}
                    onChange={(e) => setCampo('direccion', e.target.value)} autoComplete="street-address" />
                </Campo>
              )}
              {vis('localidad') && (
                <Campo id="localidad" label="Localidad" obligatorio={obl('localidad')} falta={falta('localidad')}>
                  <input id="localidad" className="field" value={valores.localidad ?? ''} maxLength={200}
                    onChange={(e) => setCampo('localidad', e.target.value)} />
                </Campo>
              )}
            </div>
          </>
        )}

        {hayMembresia && (
          <>
            <div className="perforated my-7" />
            <span className="label-mono block mb-1.5">Membresía</span>
            <p className="text-ink-3 text-[13px] leading-relaxed mb-4">
              Estos datos definen tu categoría y tu cuota: cualquier cambio lo evalúa la
              asociación antes de aplicarlo.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
              {vis('categoria_id') && (
                <SelectMembresia id="categoria_id" label="Categoría" opciones={cat.categorias}
                  valor={valores.categoria_id ?? ''} nombreActual={mem.categoria_nombre}
                  obligatorio={obl('categoria_id')} falta={falta('categoria_id')}
                  onChange={(v) => setCampo('categoria_id', v)} />
              )}
              {vis('forma_pago_id') && (
                <SelectMembresia id="forma_pago_id" label="Forma de pago" opciones={cat.formas_pago}
                  valor={valores.forma_pago_id ?? ''} nombreActual={mem.forma_pago_nombre}
                  obligatorio={obl('forma_pago_id')} falta={falta('forma_pago_id')}
                  onChange={(v) => setCampo('forma_pago_id', v)} />
              )}
              {vis('estado_registro_id') && (
                <SelectMembresia id="estado_registro_id" label="Estado" opciones={cat.estados_registro}
                  valor={valores.estado_registro_id ?? ''} nombreActual={mem.estado_registro_nombre}
                  obligatorio={obl('estado_registro_id')} falta={falta('estado_registro_id')}
                  onChange={(v) => setCampo('estado_registro_id', v)} />
              )}
              {vis('tipo_pago_id') && (
                <SelectMembresia id="tipo_pago_id" label="Tipo de pago" opciones={cat.tipos_pago}
                  valor={valores.tipo_pago_id ?? ''} nombreActual={mem.tipo_pago_nombre}
                  obligatorio={obl('tipo_pago_id')} falta={falta('tipo_pago_id')}
                  onChange={(v) => setCampo('tipo_pago_id', v)} />
              )}
              {vis('instituto_id') && (
                <SelectMembresia id="instituto_id" label="Instituto" opciones={cat.institutos}
                  valor={valores.instituto_id ?? ''} nombreActual={mem.instituto_nombre}
                  obligatorio={obl('instituto_id')} falta={falta('instituto_id')}
                  onChange={(v) => setCampo('instituto_id', v)} />
              )}
            </div>
          </>
        )}

        {/* El título en PDF: sólo para no estudiantes. El archivo sube recién
            al enviar, junto con el resto de la propuesta. */}
        {hayTitulo && (
          <>
            <div className="perforated my-7" />
            <span className={`label-mono block mb-1.5 ${falta('titulo_pdf') ? 'text-red-700' : obl('titulo_pdf') ? 'text-amber-deep' : ''}`}>
              Título{obl('titulo_pdf') && <span aria-hidden> *</span>}
            </span>
            <p className="text-ink-3 text-[13px] leading-relaxed mb-3">
              {mem.titulo_cargado
                ? 'Ya tenemos tu título registrado. Si subís uno nuevo, reemplaza al anterior.'
                : obl('titulo_pdf')
                  ? 'Subí tu título escaneado en PDF (máximo 10 MB). Es necesario para poder enviar el formulario.'
                  : 'Subí tu título escaneado en PDF (máximo 10 MB). Lo revisa la asociación junto con el resto de los datos.'}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => tituloInputRef.current?.click()}
                disabled={ocupado}
              >
                <FileText size={16} aria-hidden />
                {tituloFile ? 'Cambiar archivo' : 'Elegir PDF'}
              </button>
              {tituloFile && (
                <span className="text-[15px] text-ink-2 break-all">
                  {tituloFile.name} · {(tituloFile.size / 1024 / 1024).toFixed(1)} MB
                  <button
                    type="button"
                    className="ml-2 text-ink-3 underline decoration-dotted"
                    onClick={() => setTituloFile(null)}
                    disabled={ocupado}
                  >
                    quitar
                  </button>
                </span>
              )}
              <input
                ref={tituloInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={onTituloElegido}
              />
            </div>
          </>
        )}

        <button type="submit" className="btn-primary w-full mt-8" disabled={ocupado}>
          {ocupado ? <Loader2 className="animate-spin" size={18} /> : null}
          Enviar cambios
        </button>
        <p className="text-ink-3 text-[13px] leading-relaxed mt-3 text-center">
          Sólo viaja lo que modificaste. La asociación lo revisa antes de aplicarlo.
        </p>
      </form>
    </div>
  )
}
