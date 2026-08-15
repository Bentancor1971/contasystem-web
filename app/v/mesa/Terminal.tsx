'use client'

/**
 * La terminal atendiendo: código → segundo factor → boleta → confirmación →
 * constancia → y vuelta sola al inicio.
 *
 * Es el mismo circuito de `/v/{token}` con tres reglas que no tiene, y que son
 * las que lo hacen usable en un dispositivo compartido:
 *
 *  1. **Timeout de inactividad.** En cualquier pantalla con datos de una
 *     persona —nombre, boleta a medio marcar— se descarta todo y se vuelve al
 *     inicio, con aviso visible antes. Es el riesgo real del kiosco: alguien
 *     marca media boleta, se distrae, y el siguiente se encuentra el voto del
 *     anterior.
 *
 *  2. **Nada sobrevive al votante.** Todo el estado vive en este componente y se
 *     borra al volver al inicio. No hay `localStorage`, no hay `sessionStorage`,
 *     no hay token en la URL y no se navega: no hay historial que pueda devolver
 *     la pantalla del anterior con el botón "atrás".
 *
 *  3. **No hay salida.** Ni links a la página de la elección, ni `mailto:`, ni
 *     nada que abra otra app. La única salida es votar o que corra el timeout.
 *     Desmontar la terminal pide la llave, que la tiene el operador.
 *
 * Como `/v/{token}/Votacion.tsx`, este componente NO decide nada: la validación
 * de acá es ayuda visual y quien decide es `emitir_voto` en la base.
 *
 * Sobre la duplicación con `Votacion.tsx`: es deliberada. El pedido del modo
 * mesa es no tocar la pantalla por la que vota todo el que vota desde su casa, y
 * las dos no quieren lo mismo —una habla de links y de mails, la otra de
 * avisarle al operador; una es un celular, la otra una tablet en un mostrador—.
 * Lo que sí se comparte es lo que decide: las reglas de la boleta viven en
 * `lib/elecciones-types.ts` y son las mismas para las dos.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Lock,
  Monitor,
  Timer,
  Vote,
} from 'lucide-react'
import {
  armarSelecciones,
  problemaDePapeleta,
  SELECCION_VACIA,
  type BoletaValidada,
  type ErrorVotacion,
  type MensajeVotacion,
  type Papeleta,
  type SeleccionLocal,
} from '@/lib/elecciones-types'
import {
  AVISO_MS,
  INACTIVIDAD_MS,
  mensajeEnTerminal,
  VUELTA_MS,
  type InfoTerminal,
} from '@/lib/kiosco-types'
import { formatFechaHoraUY } from '@/lib/format'

type Fase = 'espera' | 'factor' | 'boleta' | 'confirmar' | 'listo' | 'cortado'

/** Resultado de una llamada, ya separado en "pasó algo que entiendo" y "no sé". */
type Llamada<T> =
  | { estado: 'ok'; data: T }
  | { estado: 'error'; err: ErrorVotacion }
  | { estado: 'tope' }
  /** No llegó respuesta interpretable. Para `emitir` esto es AMBIGUO. */
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
  // Un 500 no trae código de negocio: no se puede afirmar qué pasó.
  if (res.status >= 500) return { estado: 'sin_respuesta' }
  if (typeof d.error === 'string') return { estado: 'error', err: d as unknown as ErrorVotacion }
  return { estado: 'sin_respuesta' }
}

const MENSAJE_TOPE: MensajeVotacion = {
  titulo: 'Esperá un momento',
  detalle: 'La terminal recibió muchas peticiones seguidas. Probá de nuevo en unos segundos.',
  terminal: false,
  tono: 'alto',
}

/** Códigos que la base devuelve cuando el voto con seguridad NO se registró. */
const NO_SE_REGISTRO = new Set([
  'digitos_incorrectos',
  'bloqueado',
  'no_habilitado',
  'eleccion_cerrada',
  'no_abierta',
  'falta_papeleta',
  'blanco_no_admitido',
  'blanco_con_opciones',
  'cantidad_invalida',
  'opcion_invalida',
])

function irA(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function arriba() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** "Elegí una opción" / "Elegí hasta 3" / "Elegí entre 2 y 3". */
function reglaDe(p: Papeleta): string {
  const partes: string[] = []
  if (p.max_selecciones <= 1) partes.push('Elegí una opción')
  else if (p.min_selecciones === p.max_selecciones)
    partes.push(`Elegí ${p.min_selecciones} opciones`)
  else if (p.min_selecciones <= 1) partes.push(`Elegí hasta ${p.max_selecciones} opciones`)
  else partes.push(`Elegí entre ${p.min_selecciones} y ${p.max_selecciones} opciones`)
  if (!p.obligatoria) partes.push('podés dejarla sin completar')
  return partes.join(' · ')
}

/** Respuesta del canje del código. El token va adentro del pase, firmado. */
interface CanjeOk {
  ok: true
  pase: string
  verificacion_digitos: number
  instructivo: string | null
  texto_despues: string | null
}

export function Terminal({ info }: { info: InfoTerminal }) {
  const router = useRouter()

  const [fase, setFase] = useState<Fase>('espera')
  const [codigo, setCodigo] = useState('')
  const [pase, setPase] = useState('')
  const [digitosPedidos, setDigitosPedidos] = useState(0)
  const [instructivo, setInstructivo] = useState<string | null>(null)
  const [textoDespues, setTextoDespues] = useState<string | null>(null)
  const [digitos, setDigitos] = useState('')
  const [boleta, setBoleta] = useState<BoletaValidada | null>(null)
  const [sel, setSel] = useState<Record<string, SeleccionLocal>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<MensajeVotacion | null>(null)
  const [cortado, setCortado] = useState<MensajeVotacion | null>(null)
  const [emitidoAt, setEmitidoAt] = useState<string | null>(null)
  /** El emitir no respondió: puede haberse registrado o no. */
  const [dudoso, setDudoso] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  // Doble toque en el botón: el estado de React puede no haber pintado todavía.
  const enVuelo = useRef(false)

  // ── Reloj de la terminal ──────────────────────────────────────────────────

  const ultimaActividad = useRef(Date.now())
  const inicioFase = useRef(Date.now())
  const [restante, setRestante] = useState(INACTIVIDAD_MS)

  /**
   * Vuelve al inicio sin dejar rastro de quien estaba. Es la operación más
   * importante de esta pantalla: la corre el timeout, el botón "Listo" y cada
   * final de camino.
   */
  const reiniciar = useCallback(() => {
    enVuelo.current = false
    setFase('espera')
    setCodigo('')
    setPase('')
    setDigitosPedidos(0)
    setInstructivo(null)
    setTextoDespues(null)
    setDigitos('')
    setBoleta(null)
    setSel({})
    setErrores({})
    setAviso(null)
    setCortado(null)
    setEmitidoAt(null)
    setDudoso(false)
    setOcupado(false)
    arriba()
  }, [])

  useEffect(() => {
    inicioFase.current = Date.now()
    ultimaActividad.current = Date.now()
    // Se pone el valor de entrada acá y no se espera al primer tic: si no, la
    // constancia aparece anunciando los 90 segundos de la inactividad antes de
    // corregirse a los 20 de la vuelta.
    setRestante(fase === 'listo' || fase === 'cortado' ? VUELTA_MS : INACTIVIDAD_MS)
  }, [fase])

  useEffect(() => {
    if (fase === 'espera') return

    // `listo` y `cortado` no esperan actividad: son finales de camino y vuelven
    // solos, para que la constancia del anterior no quede en pantalla cuando se
    // acerca el siguiente.
    const automatica = fase === 'listo' || fase === 'cortado'
    const limite = automatica ? VUELTA_MS : INACTIVIDAD_MS

    const id = setInterval(() => {
      // Con una llamada en vuelo el reloj no corre: una conexión lenta al
      // emitir no puede borrar la boleta de alguien que ya apretó el botón.
      if (enVuelo.current) {
        ultimaActividad.current = Date.now()
        setRestante(limite)
        return
      }
      const desde = automatica ? inicioFase.current : ultimaActividad.current
      const queda = limite - (Date.now() - desde)
      if (queda <= 0) {
        reiniciar()
        return
      }
      // El reloj mira cuatro veces por segundo pero la pantalla se redibuja lo
      // menos posible: mientras falte mucho no se toca el estado, y después una
      // vez por segundo. Repintar la boleta entera cuatro veces por segundo se
      // nota en la tablet, y justo cuando alguien está marcando.
      setRestante((prev) => {
        if (queda > AVISO_MS && prev > AVISO_MS) return prev
        if (Math.ceil(queda / 1000) === Math.ceil(prev / 1000)) return prev
        return queda
      })
    }, 250)

    return () => clearInterval(id)
  }, [fase, reiniciar])

  const marcarActividad = useCallback(() => {
    ultimaActividad.current = Date.now()
  }, [])

  // ── Errores ───────────────────────────────────────────────────────────────

  const mostrar = useCallback(
    (err: ErrorVotacion) => {
      // Una sesión caída no es un problema del votante: la terminal dejó de
      // estar montada y la pantalla que corresponde es la del operador.
      if (err.error === 'sesion_invalida') {
        router.refresh()
        return
      }
      const m = mensajeEnTerminal(err)
      if (m.terminal) {
        setCortado(m)
        setFase('cortado')
        arriba()
      } else {
        setAviso(m)
      }
    },
    [router],
  )

  // ── Paso 1 · el código impreso ────────────────────────────────────────────

  async function validarConDigitos(paseNuevo: string, valor: string) {
    const r = await pedir<BoletaValidada>('/api/votacion/mesa/validar', {
      pase: paseNuevo,
      digitos: valor,
    })
    if (r.estado === 'ok') {
      setBoleta(r.data)
      setSel({})
      setErrores({})
      setAviso(null)
      setFase('boleta')
      arriba()
      return
    }
    if (r.estado === 'error') {
      if (r.err.error === 'digitos_incorrectos') setDigitos('')
      mostrar(r.err)
      return
    }
    setAviso(
      r.estado === 'tope'
        ? MENSAJE_TOPE
        : {
            titulo: 'No pudimos verificar tus dígitos',
            detalle: 'Avisale al operador de la mesa y probá de nuevo.',
            terminal: false,
            tono: 'alto',
          },
    )
  }

  async function onCanjear(e: React.FormEvent) {
    e.preventDefault()
    if (enVuelo.current || codigo.trim() === '') return
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)

    const r = await pedir<CanjeOk>('/api/votacion/mesa/codigo', { codigo })

    if (r.estado === 'ok') {
      setPase(r.data.pase)
      setDigitosPedidos(r.data.verificacion_digitos)
      setInstructivo(r.data.instructivo)
      setTextoDespues(r.data.texto_despues)
      setCodigo('')

      if (r.data.verificacion_digitos > 0) {
        setFase('factor')
        arriba()
      } else {
        // Elección sin segundo factor: la boleta se pide derecho. El desktop ya
        // avisa que una terminal sin segundo factor deja votar a quien agarre
        // la planilla de códigos; acá no se puede hacer más que respetarlo.
        await validarConDigitos(r.data.pase, '')
      }
      enVuelo.current = false
      setOcupado(false)
      return
    }

    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'error') {
      mostrar(r.err)
      return
    }
    setAviso(
      r.estado === 'tope'
        ? MENSAJE_TOPE
        : {
            titulo: 'No pudimos leer tu código',
            detalle: 'Puede ser la conexión del local. Avisale al operador de la mesa.',
            terminal: false,
            tono: 'alto',
          },
    )
  }

  // ── Paso 2 · segundo factor ───────────────────────────────────────────────

  async function onValidar(e: React.FormEvent) {
    e.preventDefault()
    if (enVuelo.current) return
    if (digitos.length !== digitosPedidos) {
      setAviso({
        titulo: 'Faltan dígitos',
        detalle: `Ingresá los últimos ${digitosPedidos} dígitos de tu cédula, contando el dígito verificador.`,
        terminal: false,
        tono: 'alto',
      })
      return
    }
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    await validarConDigitos(pase, digitos)
    enVuelo.current = false
    setOcupado(false)
  }

  // ── Paso 3 · marcar la boleta ─────────────────────────────────────────────

  function limpiar(papeletaId: string) {
    setErrores((e) => {
      if (!(papeletaId in e)) return e
      const resto = { ...e }
      delete resto[papeletaId]
      return resto
    })
    setAviso(null)
  }

  function elegirUnica(p: Papeleta, opcionId: string) {
    setSel((s) => ({ ...s, [p.id]: { opciones: [opcionId], blanco: false } }))
    limpiar(p.id)
  }

  function alternar(p: Papeleta, opcionId: string) {
    setSel((s) => {
      const actual = s[p.id] ?? SELECCION_VACIA
      const marcada = actual.opciones.includes(opcionId)
      if (!marcada && actual.opciones.length >= p.max_selecciones) return s
      const opciones = marcada
        ? actual.opciones.filter((x) => x !== opcionId)
        : [...actual.opciones, opcionId]
      return { ...s, [p.id]: { opciones, blanco: false } }
    })
    limpiar(p.id)
  }

  /** El blanco desmarca todo lo demás de esa papeleta, y viceversa. */
  function marcarBlanco(p: Papeleta) {
    setSel((s) => {
      const actual = s[p.id] ?? SELECCION_VACIA
      const blanco = p.tipo === 'multiple' ? !actual.blanco : true
      return { ...s, [p.id]: { opciones: [], blanco } }
    })
    limpiar(p.id)
  }

  function onRevisar() {
    if (!boleta) return
    const nuevos: Record<string, string> = {}
    for (const p of boleta.papeletas) {
      const problema = problemaDePapeleta(p, sel[p.id] ?? SELECCION_VACIA)
      if (problema) nuevos[p.id] = problema
    }
    setErrores(nuevos)
    const primera = boleta.papeletas.find((p) => nuevos[p.id])
    if (primera) {
      setAviso({
        titulo: 'Falta completar la boleta',
        detalle: `Revisá «${primera.titulo}».`,
        terminal: false,
        tono: 'alto',
      })
      irA(`papeleta-${primera.id}`)
      return
    }
    setAviso(null)
    setFase('confirmar')
    arriba()
  }

  // ── Paso 4 · emitir ───────────────────────────────────────────────────────

  async function onEmitir() {
    if (!boleta || enVuelo.current) return
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)

    const r = await pedir<{ ok: true; emitido_at: string }>('/api/votacion/mesa/emitir', {
      pase,
      digitos,
      selecciones: armarSelecciones(boleta.papeletas, sel),
    })
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok') {
      // Un `ok` contesta la duda de un intento anterior: ese emitir no había
      // llegado, y este sí.
      setDudoso(false)
      setEmitidoAt(r.data.emitido_at)
      setFase('listo')
      arriba()
      return
    }

    if (r.estado === 'tope') {
      // El 429 lo devuelve la web antes de tocar la base: el voto no entró.
      setAviso(MENSAJE_TOPE)
      return
    }

    if (r.estado === 'error' && NO_SE_REGISTRO.has(String(r.err.error))) {
      if (r.err.papeleta && boleta) {
        const p = boleta.papeletas.find((x) => x.titulo === r.err.papeleta)
        if (p) {
          setErrores((e) => ({ ...e, [p.id]: 'Revisá esta parte.' }))
          setFase('boleta')
          setTimeout(() => irA(`papeleta-${p.id}`), 0)
        }
      }
      if (r.err.error === 'digitos_incorrectos') {
        setDigitos('')
        setFase('factor')
        arriba()
      }
      mostrar(r.err)
      return
    }

    if (r.estado === 'error') {
      mostrar(r.err)
      return
    }

    // No hubo respuesta interpretable. El voto PUEDE haber quedado registrado, y
    // eso NO se puede resolver acá: en la terminal no hay a quién preguntarle
    // "¿quedaste votado?" sin volver a exponer datos de la persona. Lo resuelve
    // el operador contra el padrón del desktop, que es donde se ve la verdad.
    // El texto lo pone la caja de la duda, que es la que no se borra sola.
    setDudoso(true)
    arriba()
  }

  // ── Desmontar (operador) ──────────────────────────────────────────────────

  const [cerrando, setCerrando] = useState(false)
  const [llaveCierre, setLlaveCierre] = useState('')
  const [errorCierre, setErrorCierre] = useState<string | null>(null)

  async function onDesmontar(e: React.FormEvent) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true)
    setErrorCierre(null)
    const r = await pedir<{ ok: true }>('/api/votacion/mesa/desmontar', { llave: llaveCierre })
    if (r.estado === 'ok') {
      router.refresh()
      return
    }
    setOcupado(false)
    setErrorCierre(
      r.estado === 'tope'
        ? 'Demasiados intentos. Esperá unos minutos.'
        : 'La llave no sirve para esta terminal.',
    )
  }

  // ── Piezas ────────────────────────────────────────────────────────────────

  const segundos = Math.max(0, Math.ceil(restante / 1000))
  const enCuentaRegresiva = fase !== 'espera' && fase !== 'listo' && fase !== 'cortado'

  const barra = (
    <header className="flex items-center justify-between gap-3 mb-6">
      <div className="min-w-0">
        <span className="label-mono truncate block">{info.eleccion}</span>
        <p className="font-mono text-sm text-ink-3 truncate">{info.terminal}</p>
      </div>
      <Monitor className="text-ink-3 shrink-0" size={18} aria-hidden />
    </header>
  )

  const avisoInactividad = enCuentaRegresiva && restante <= AVISO_MS && (
    <div className="voto-aviso voto-aviso--medio mb-5" role="alert">
      <div className="flex gap-3">
        <Timer className="text-ink-2 shrink-0 mt-0.5" size={20} aria-hidden />
        <div className="min-w-0">
          <h3 className="font-medium text-[17px] leading-snug">¿Seguís ahí?</h3>
          <p className="text-ink-2 text-[16px] leading-relaxed mt-1">
            Si no tocás nada, la pantalla se borra en {segundos} segundos y hay que empezar de
            nuevo con el código.
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={marcarActividad}>
            Sigo acá
          </button>
        </div>
      </div>
    </div>
  )

  /**
   * La duda tiene caja propia y no se borra con un click, igual que en
   * `/v/[token]`. Acá importa todavía más: en la terminal no hay a quién
   * preguntarle "¿quedé votado?" sin exponer datos, así que la única salida es
   * el operador —y esa instrucción no puede desaparecer porque la persona tocó
   * otra opción, con el botón de emitir todavía a la vista—.
   */
  const dudaVisible = dudoso && (
    <div className="voto-aviso voto-aviso--medio mb-6" role="alert">
      <div className="flex gap-3">
        <AlertCircle className="text-ink-2 shrink-0 mt-0.5" size={20} aria-hidden />
        <div>
          <h3 className="font-medium text-[17px] leading-snug">
            No pudimos confirmar tu voto
          </h3>
          <p className="text-ink-2 text-[16px] leading-relaxed mt-1">
            Se cortó la conexión y no sabemos si llegó a registrarse. No vuelvas a votar:
            avisale al operador de la mesa, que lo verifica en el sistema.
          </p>
        </div>
      </div>
    </div>
  )

  const avisoVisible = aviso && (
    <div className={`voto-aviso voto-aviso--${aviso.tono} mb-6`} role="alert">
      <div className="flex gap-3">
        <AlertCircle className="text-ink-2 shrink-0 mt-0.5" size={20} aria-hidden />
        <div>
          <h3 className="font-medium text-[17px] leading-snug">{aviso.titulo}</h3>
          <p className="text-ink-2 text-[16px] leading-relaxed mt-1">{aviso.detalle}</p>
        </div>
      </div>
    </div>
  )

  // ── Pantallas ─────────────────────────────────────────────────────────────

  function contenido() {
    // Inicio: la pantalla en la que la terminal pasa la mayor parte del día.
    if (fase === 'espera') {
      return (
        <div className="rise">
          <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mb-4">
            Escribí tu código
          </h1>
          <p className="text-ink-2 text-[17px] leading-relaxed mb-7">
            Es el código que te entregaron en la mesa. Nadie ve lo que marcás en esta pantalla.
          </p>

          {avisoVisible}

          <form onSubmit={onCanjear} className="card p-6 sm:p-7">
            <label htmlFor="codigo" className="label-mono block mb-3">
              Código de tu credencial
            </label>
            <input
              id="codigo"
              name="codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={40}
              enterKeyHint="go"
              className="field text-center font-mono text-2xl tracking-[0.25em]"
            />
            <p className="text-ink-3 text-sm leading-relaxed mt-3">
              Copialo tal cual figura en el papel. No lleva 0 ni 1: lo que parece un cero es una
              O.
            </p>
            <button
              type="submit"
              className="btn-primary w-full mt-7"
              disabled={ocupado || codigo.trim() === ''}
            >
              {ocupado ? <Loader2 className="animate-spin" size={18} /> : null}
              Continuar
            </button>
          </form>

          {/* Salida del operador. Pide la llave: en un dispositivo compartido un
              botón que desmonta la tablet sin nada que lo frene es la misma
              puerta que la terminal vino a cerrar. */}
          <div className="mt-10">
            {!cerrando ? (
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => {
                  setCerrando(true)
                  setLlaveCierre('')
                  setErrorCierre(null)
                }}
              >
                Cerrar esta terminal
              </button>
            ) : (
              <form onSubmit={onDesmontar} className="card p-5">
                <label htmlFor="llave-cierre" className="label-mono block mb-2">
                  Llave de la terminal
                </label>
                <input
                  id="llave-cierre"
                  name="llave-cierre"
                  value={llaveCierre}
                  onChange={(e) => setLlaveCierre(e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={40}
                  className="field text-center font-mono tracking-[0.2em]"
                />
                {errorCierre && (
                  <p className="msg-error mt-3" role="alert">
                    {errorCierre}
                  </p>
                )}
                <div className="flex gap-2 mt-4">
                  <button type="submit" className="btn-secondary" disabled={ocupado}>
                    {ocupado ? <Loader2 className="animate-spin" size={16} /> : null}
                    Cerrar terminal
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setCerrando(false)}
                    disabled={ocupado}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )
    }

    if (fase === 'cortado' && cortado) {
      return (
        <div className="rise">
          <div
            className={`voto-aviso voto-aviso--${cortado.tono}`}
            role={cortado.tono === 'ok' ? 'status' : 'alert'}
          >
            <h2 className="font-display text-2xl font-medium leading-tight mb-2">
              {cortado.titulo}
            </h2>
            <p className="text-ink-2 text-[17px] leading-relaxed">{cortado.detalle}</p>
          </div>
          <button type="button" className="btn-primary w-full mt-6" onClick={reiniciar}>
            Empezar de nuevo
          </button>
          <p className="text-ink-3 text-sm text-center mt-3">
            Vuelve solo en {segundos} segundos.
          </p>
        </div>
      )
    }

    if (fase === 'listo') {
      return (
        <div className="rise">
          <div className="card p-7 sm:p-8 text-center">
            <CheckCircle2 className="text-status-ok mx-auto mb-3" size={52} aria-hidden />
            <span className="label-mono text-status-ok">Voto registrado</span>
            <h2 className="font-display text-3xl font-medium leading-tight mt-3 mb-4">
              Listo{boleta?.votante ? `, ${boleta.votante}` : ''}
            </h2>
            <div className="perforated mb-4" />
            {emitidoAt ? (
              <p className="font-mono text-[15px]">Emitido el {formatFechaHoraUY(emitidoAt)}</p>
            ) : (
              <p className="font-mono text-[15px]">Tu voto figura como emitido</p>
            )}
            <p className="text-ink-2 text-[17px] leading-relaxed mt-4">
              Si tenés un mail registrado, te llega una constancia.
            </p>
            {textoDespues && (
              <p className="text-ink-2 text-[17px] leading-relaxed mt-4 whitespace-pre-line">
                {textoDespues}
              </p>
            )}
          </div>
          <button type="button" className="btn-primary w-full mt-6" onClick={reiniciar}>
            Listo
          </button>
          <p className="text-ink-3 text-sm text-center mt-3">
            La pantalla vuelve sola en {segundos} segundos.
          </p>
        </div>
      )
    }

    // ── Segundo factor ──────────────────────────────────────────────────────

    if (fase === 'factor') {
      return (
        <div className="rise">
          {avisoVisible}

          {/* El instructivo es donde la institución avisa, entre otras cosas,
              que el voto es nominal. Quien vota tiene derecho a leerlo también
              acá, no sólo en el mail que quizá no recibió. */}
          {instructivo && (
            <section className="card p-6 mb-6" aria-labelledby="instructivo-titulo">
              <h2 id="instructivo-titulo" className="label-mono mb-3">
                Antes de votar
              </h2>
              <p className="text-[17px] leading-relaxed whitespace-pre-line">{instructivo}</p>
            </section>
          )}

          <form onSubmit={onValidar} className="card p-6 sm:p-7">
            <div className="flex items-center gap-2 mb-4">
              <Lock size={16} className="text-amber-deep" aria-hidden />
              <span className="label-mono">Verificá que sos vos</span>
            </div>
            <label htmlFor="digitos" className="block text-[17px] leading-relaxed mb-5">
              Escribí los{' '}
              <span className="hl hl-thin">últimos {digitosPedidos} dígitos</span> de tu cédula.
            </label>
            <input
              id="digitos"
              name="digitos"
              className="field text-center font-mono text-2xl tracking-[0.35em]"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint="go"
              maxLength={digitosPedidos}
              value={digitos}
              aria-describedby="digitos-ayuda"
              onChange={(e) =>
                setDigitos(e.target.value.replace(/\D/g, '').slice(0, digitosPedidos))
              }
            />
            <p id="digitos-ayuda" className="text-ink-3 text-sm mt-3 leading-relaxed">
              Son los últimos {digitosPedidos} dígitos <strong>incluyendo el dígito
              verificador</strong>, sin puntos ni guiones. Por ejemplo, si tu cédula es
              1.234.567-8, escribí{' '}
              <span className="font-mono">{'12345678'.slice(-digitosPedidos)}</span>.
            </p>
            <button
              type="submit"
              className="btn-primary w-full mt-7"
              disabled={ocupado || digitos.length !== digitosPedidos}
            >
              {ocupado ? <Loader2 className="animate-spin" size={18} /> : null}
              Continuar
            </button>
          </form>
        </div>
      )
    }

    if (!boleta) return null

    // ── Confirmación ────────────────────────────────────────────────────────

    if (fase === 'confirmar') {
      return (
        <div className="rise">
          {dudaVisible}
          {avisoVisible}
          <section className="card p-6 sm:p-7" aria-labelledby="confirmar-titulo">
            <span className="label-mono">Último paso</span>
            <h2
              id="confirmar-titulo"
              className="font-display text-3xl font-medium leading-tight mt-3 mb-1"
            >
              Revisá tu voto
            </h2>
            <p className="text-ink-2 text-[17px] leading-relaxed mb-5">
              Esto es lo que vas a emitir como <strong>{boleta.votante}</strong>. Un voto emitido
              no se puede cambiar.
            </p>
            <div className="perforated mb-1" />

            {boleta.papeletas.map((p) => {
              const s = sel[p.id] ?? SELECCION_VACIA
              const elegidas = p.opciones.filter((o) => s.opciones.includes(o.id))
              return (
                <div key={p.id} className="py-4 border-b border-line last:border-b-0">
                  <span className="label-mono">{p.titulo}</span>
                  {s.blanco ? (
                    <p className="text-[17px] font-medium mt-1.5">Voto en blanco</p>
                  ) : elegidas.length > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {elegidas.map((o) => (
                        <li key={o.id} className="text-[17px] font-medium leading-snug">
                          {o.numero && <span className="font-mono mr-2">{o.numero}</span>}
                          {o.titulo}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[17px] text-ink-3 mt-1.5">Sin completar</p>
                  )}
                </div>
              )
            })}
          </section>

          <div className="voto-sticky mt-6">
            <button
              type="button"
              className="btn-primary w-full"
              onClick={onEmitir}
              disabled={ocupado}
            >
              {ocupado ? <Loader2 className="animate-spin" size={18} /> : <Vote size={18} />}
              Emitir mi voto — es definitivo
            </button>
            <button
              type="button"
              className="btn-ghost mt-4 mx-auto"
              onClick={() => {
                // `dudoso` no se apaga acá: ver la caja de la duda.
                setAviso(null)
                setFase('boleta')
                arriba()
              }}
              disabled={ocupado}
            >
              <ChevronLeft size={16} /> Volver y cambiar mi voto
            </button>
          </div>
        </div>
      )
    }

    // ── Boleta ──────────────────────────────────────────────────────────────

    return (
      <div>
        {dudaVisible}
        {avisoVisible}

        <p className="text-[17px] leading-relaxed mb-6">
          Estás votando como <strong>{boleta.votante}</strong>.
        </p>

        <div className="space-y-6">
          {boleta.papeletas.map((p, i) => {
            const s = sel[p.id] ?? SELECCION_VACIA
            // Checkbox sólo cuando de verdad se puede marcar más de una: un
            // `max_selecciones: 1` dibujado con checkbox obliga a desmarcar
            // antes de cambiar de opción, que es la trampa que no queremos con
            // gente mayor y una tablet nueva en la mano.
            const multiple = p.max_selecciones > 1
            const enTope = !s.blanco && s.opciones.length >= p.max_selecciones
            const error = errores[p.id]

            return (
              <fieldset
                key={p.id}
                id={`papeleta-${p.id}`}
                className={`voto-papeleta${error ? ' voto-papeleta--error' : ''}`}
              >
                <legend className="w-full">
                  <span className="label-mono">
                    {i + 1} de {boleta.papeletas.length}
                  </span>
                  <span className="block font-display text-2xl font-medium leading-tight mt-2">
                    {p.titulo}
                  </span>
                </legend>

                {p.descripcion && (
                  <p className="text-ink-2 text-[16px] leading-relaxed mt-3 whitespace-pre-line">
                    {p.descripcion}
                  </p>
                )}
                <p className="voto-regla mt-3 mb-4">{reglaDe(p)}</p>

                {error && (
                  <p className="msg-error mb-4" role="alert">
                    {error}
                  </p>
                )}

                <div className="space-y-3">
                  {p.opciones.map((o) => {
                    const marcada = !s.blanco && s.opciones.includes(o.id)
                    const bloqueada = multiple && !marcada && enTope
                    return (
                      <div
                        key={o.id}
                        className={`voto-opcion${marcada ? ' voto-opcion--sel' : ''}${
                          bloqueada ? ' voto-opcion--tope' : ''
                        }`}
                      >
                        <label className="voto-fila">
                          <input
                            type={multiple ? 'checkbox' : 'radio'}
                            className="voto-control"
                            name={`papeleta-${p.id}`}
                            value={o.id}
                            checked={marcada}
                            disabled={bloqueada}
                            onChange={() =>
                              multiple ? alternar(p, o.id) : elegirUnica(p, o.id)
                            }
                          />
                          <span className="min-w-0">
                            <span className="voto-titulo">
                              {o.numero && <span className="voto-numero">{o.numero}</span>}
                              {o.titulo}
                            </span>
                            {o.lema && <span className="voto-lema">{o.lema}</span>}
                            {o.descripcion && (
                              <span className="voto-desc whitespace-pre-line">
                                {o.descripcion}
                              </span>
                            )}
                            {o.imagen_url && (
                              // eslint-disable-next-line @next/next/no-img-element -- URL externa cargada por el desktop
                              <img
                                src={o.imagen_url}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="mt-3 w-full h-auto rounded-lg border border-line"
                              />
                            )}
                          </span>
                        </label>

                        {o.integrantes.length > 0 && (
                          <details className="voto-integrantes">
                            <summary>Ver integrantes ({o.integrantes.length})</summary>
                            <ul>
                              {o.integrantes.map((x, k) => (
                                <li key={`${o.id}-${k}`}>
                                  <span>{x.nombre}</span>
                                  {x.cargo && <span>{x.cargo}</span>}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    )
                  })}

                  {p.permite_blanco && (
                    <div
                      className={`voto-opcion voto-blanco${s.blanco ? ' voto-opcion--sel' : ''}`}
                    >
                      <label className="voto-fila">
                        <input
                          type={multiple ? 'checkbox' : 'radio'}
                          className="voto-control"
                          name={`papeleta-${p.id}`}
                          value="__blanco__"
                          checked={s.blanco}
                          onChange={() => marcarBlanco(p)}
                        />
                        <span className="voto-titulo">Voto en blanco</span>
                      </label>
                    </div>
                  )}
                </div>
              </fieldset>
            )
          })}
        </div>

        <div className="voto-sticky mt-6">
          <button type="button" className="btn-primary w-full" onClick={onRevisar}>
            Revisar mi voto
          </button>
        </div>
      </div>
    )
  }

  return (
    <main
      className="min-h-screen bg-paper"
      // Cualquier toque cuenta como actividad. Va en el contenedor y no en cada
      // control porque lo que importa es que haya alguien adelante, no qué tocó.
      onPointerDown={marcarActividad}
      onKeyDown={marcarActividad}
    >
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-8 sm:py-12">
        {barra}
        {avisoInactividad}
        {contenido()}
        <footer className="font-mono text-[11px] text-ink-3 mt-14">
          CONTASYSTEM · TERMINAL DE MESA
        </footer>
      </div>
    </main>
  )
}
