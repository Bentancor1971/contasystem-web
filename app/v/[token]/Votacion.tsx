'use client'

/**
 * Votación: segundo factor → boleta → confirmación → constancia.
 *
 * Tres cosas que este componente NO hace, y no por olvido:
 *
 *  1. No decide nada. La validación de acá —deshabilitar el checkbox N+1,
 *     marcar en rojo la papeleta incompleta— es ayuda visual. Quien decide es
 *     `emitir_voto`, que revalida el segundo factor, la ventana horaria contra
 *     el reloj de Postgres y el min/max de cada papeleta.
 *
 *  2. No guarda el token ni los dígitos en ningún lado. El token vive en la URL
 *     y los dígitos en memoria, mientras dura la pestaña. Ni localStorage, ni
 *     cookies, ni analytics.
 *
 *  3. No muestra "listo" sin un `ok` del servidor. Si el fetch se corta, la
 *     pantalla dice que no sabemos —nunca que el voto no se registró— y ofrece
 *     verificarlo. Un falso positivo hace que alguien crea que votó y se entere
 *     cuando la elección ya cerró.
 */

import { useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Lock,
  Vote,
} from 'lucide-react'
import {
  armarSelecciones,
  mensajeDeError,
  problemaDePapeleta,
  SELECCION_VACIA,
  type BoletaValidada,
  type CierreCtx,
  type ErrorVotacion,
  type MensajeVotacion,
  type Papeleta,
  type SeleccionLocal,
} from '@/lib/elecciones-types'
import { formatFechaHoraUY } from '@/lib/format'

type Fase = 'factor' | 'boleta' | 'confirmar' | 'listo' | 'cortado'

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
  if (typeof d.error === 'string')
    return { estado: 'error', err: d as unknown as ErrorVotacion }
  return { estado: 'sin_respuesta' }
}

const MENSAJE_TOPE: MensajeVotacion = {
  titulo: 'Demasiados intentos',
  detalle: 'Esperá un momento y volvé a probar.',
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

export function Votacion({
  token,
  verificacionDigitos,
  emailContacto,
  textoDespues,
  boletaInicial,
  encabezado,
  instructivo,
  eleccion,
}: {
  token: string
  verificacionDigitos: number
  emailContacto: string | null
  /** Cierre que escribe la institución. Se muestra recién con el voto emitido. */
  textoDespues: string | null
  /** Sólo cuando la elección no pide segundo factor: la boleta ya viene del server. */
  boletaInicial: BoletaValidada | null
  /** Título, fechas, descripción y texto de apertura. Los arma el servidor. */
  encabezado: React.ReactNode
  /** El "Antes de votar" de la institución, o `null` si no escribió ninguno. */
  instructivo: React.ReactNode
  /**
   * Lo justo para explicar un cierre que llegue con la persona adentro. Sin
   * esto, una elección que cerraba a mitad de sesión daba "ya no se pueden
   * emitir votos" a secas, mientras que la misma elección, recargando la
   * página, distinguía escrutada de anulada de cerrada a mano.
   */
  eleccion: CierreCtx
}) {
  const [fase, setFase] = useState<Fase>(boletaInicial ? 'boleta' : 'factor')
  const [digitos, setDigitos] = useState('')
  const [boleta, setBoleta] = useState<BoletaValidada | null>(boletaInicial)
  const [sel, setSel] = useState<Record<string, SeleccionLocal>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<MensajeVotacion | null>(null)
  const [cortado, setCortado] = useState<MensajeVotacion | null>(null)
  const [emitidoAt, setEmitidoAt] = useState<string | null>(null)
  /**
   * El emitir no respondió: puede haberse registrado o no.
   *
   * Es un estado que SOBREVIVE a todo lo demás y que sólo cierra `onVerificar`.
   * Antes compartía caja con los errores de boleta: cualquier click en una
   * opción llamaba a `limpiar()` → `setAviso(null)` y se llevaba puesto el
   * botón de verificar, y "Volver y cambiar mi voto" lo apagaba directamente.
   * En los dos casos quedaba una persona que no sabía si su voto había entrado,
   * sin manera de averiguarlo, frente a un botón que dice "es definitivo".
   */
  const [dudoso, setDudoso] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  // Doble toque en el botón: el estado de React puede no haber pintado todavía.
  const enVuelo = useRef(false)

  const base = `/api/votacion/${encodeURIComponent(token)}`

  function mostrar(err: ErrorVotacion) {
    const m = mensajeDeError(err, emailContacto, eleccion)
    if (m.terminal) {
      setCortado(m)
      setFase('cortado')
      arriba()
    } else {
      setAviso(m)
    }
  }

  // ── Paso 1 · segundo factor ───────────────────────────────────────────────

  async function onValidar(e: React.FormEvent) {
    e.preventDefault()
    if (enVuelo.current) return
    if (digitos.length !== verificacionDigitos) {
      setAviso({
        titulo: 'Faltan dígitos',
        detalle: `Ingresá los últimos ${verificacionDigitos} dígitos de tu cédula, contando el dígito verificador.`,
        terminal: false,
        tono: 'alto',
      })
      return
    }
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    const r = await pedir<BoletaValidada>(`${base}/validar`, { digitos })
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok') {
      setBoleta(r.data)
      setSel({})
      setErrores({})
      setFase('boleta')
      arriba()
      return
    }
    if (r.estado === 'error') {
      // Los dígitos quedan borrados: el próximo intento se escribe entero.
      if (r.err.error === 'digitos_incorrectos') setDigitos('')
      mostrar(r.err)
      return
    }
    setAviso(
      r.estado === 'tope'
        ? MENSAJE_TOPE
        : {
            titulo: 'No pudimos verificar tus dígitos',
            detalle: 'Revisá tu conexión y volvé a probar.',
            terminal: false,
            tono: 'alto',
          },
    )
  }

  // ── Paso 2 · marcar la boleta ─────────────────────────────────────────────

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
      // En una papeleta de opción única el blanco es un radio más: no se
      // "desmarca" solo, se cambia eligiendo otra cosa. En una múltiple es un
      // checkbox y sí se puede volver atrás.
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

  // ── Paso 3 · emitir ───────────────────────────────────────────────────────

  async function onEmitir() {
    if (!boleta || enVuelo.current) return
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    const r = await pedir<{ ok: true; emitido_at: string }>(`${base}/emitir`, {
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
      // Errores de boleta: se vuelve a la boleta con la papeleta señalada.
      if (r.err.papeleta && boleta) {
        const p = boleta.papeletas.find((x) => x.titulo === r.err.papeleta)
        if (p) {
          setErrores((e) => ({ ...e, [p.id]: 'Revisá esta parte.' }))
          setFase('boleta')
          setTimeout(() => irA(`papeleta-${p.id}`), 0)
        }
      }
      if (r.err.error === 'digitos_incorrectos') {
        // Sólo puede pasar si la credencial cambió mientras estaba abierta la
        // pantalla. Se vuelve al segundo factor.
        setDigitos('')
        setFase('factor')
        arriba()
      }
      mostrar(r.err)
      return
    }

    if (r.estado === 'error') {
      // `ya_voto` y compañía: terminal, y con su propia pantalla.
      mostrar(r.err)
      return
    }

    // No hubo respuesta interpretable. El voto PUEDE haber quedado registrado.
    // El texto lo pone la caja de la duda, que es la que no se borra sola.
    setDudoso(true)
    arriba()
  }

  /** Contra `buscar_credencial`: ¿quedó registrado el voto que no confirmó? */
  async function onVerificar() {
    if (enVuelo.current) return
    enVuelo.current = true
    setOcupado(true)
    const r = await pedir<{ ok: true; ya_voto: boolean; emitido_at: string | null }>(
      `${base}/estado`,
      {},
    )
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok' && r.data.ya_voto) {
      setDudoso(false)
      setAviso(null)
      // Desde `54_` la hora viene también por acá, así que la constancia sale
      // igual de completa que si el emitir hubiera contestado. Con una base sin
      // ese script queda `null` y la pantalla se acomoda sola.
      setEmitidoAt(r.data.emitido_at ?? null)
      setFase('listo')
      arriba()
      return
    }
    if (r.estado === 'ok') {
      // El servidor lo afirma: la duda se cierra y vuelve a haber algo que hacer.
      setDudoso(false)
      setAviso({
        titulo: 'Tu voto no quedó registrado',
        detalle: 'Podés emitirlo de nuevo con el botón de abajo.',
        terminal: false,
        tono: 'medio',
      })
      return
    }
    // No se pudo averiguar: `dudoso` SIGUE en pie, con su botón, porque la
    // pregunta sigue sin contestar.
    setAviso({
      titulo: 'No pudimos verificarlo',
      detalle: 'Revisá tu conexión y probá de nuevo en un momento.',
      terminal: false,
      tono: 'medio',
    })
  }

  // ── Pantallas ─────────────────────────────────────────────────────────────

  /**
   * El encabezado y el instructivo son la PORTADA: acompañan a la pantalla de
   * entrada y se van cuando la persona pasa a marcar. Con la boleta delante,
   * el título, las fechas, la descripción y el "Antes de votar" son dos
   * pantallas de scroll entre la persona y la primera papeleta —en un teléfono,
   * la boleta arranca abajo de todo—, y en la confirmación compiten con lo
   * único que importa leer ahí, que es lo que se está por emitir.
   *
   * La entrada no siempre es el segundo factor: cuando la elección no lo pide,
   * la boleta ES la portada, y ahí el instructivo tiene que estar sí o sí —es
   * donde la institución avisa que el voto es nominal, y eso se lee antes de
   * marcar, no después—.
   */
  const enPortada = fase === 'factor' || (fase === 'boleta' && !!boletaInicial)

  // En las pantallas terminales queda el encabezado y no el instructivo: sirve
  // para saber de qué elección habla el aviso, y las instrucciones para votar
  // ya no le sirven a nadie que no puede votar o que acaba de votar.
  if (fase === 'cortado' && cortado) {
    return (
      <>
        {encabezado}
        {/* El tono lo trae el mensaje. Todo lo terminal salía en rojo, así que
            un "ya votaste" alcanzado a mitad del flujo se leía como un error
            mientras el mismo mensaje, recargando la página, salía en verde. */}
        <div
          className={`voto-aviso voto-aviso--${cortado.tono}`}
          role={cortado.tono === 'ok' ? 'status' : 'alert'}
        >
          <h2 className="font-display text-2xl font-medium leading-tight mb-2">
            {cortado.titulo}
          </h2>
          <p className="text-ink-2 text-[17px] leading-relaxed">{cortado.detalle}</p>
        </div>
      </>
    )
  }

  if (fase === 'listo') {
    return (
      <div className="rise">
        {encabezado}
        <div className="card p-7 sm:p-8 text-center">
          <CheckCircle2 className="text-status-ok mx-auto mb-3" size={52} aria-hidden />
          <span className="label-mono text-status-ok">Voto registrado</span>
          <h2 className="font-display text-3xl font-medium leading-tight mt-3 mb-4">
            Listo{boleta?.votante ? `, ${boleta.votante}` : ''}
          </h2>
          <div className="perforated mb-4" />
          {emitidoAt ? (
            <p className="font-mono text-[15px]">
              Emitido el {formatFechaHoraUY(emitidoAt)}
            </p>
          ) : (
            <p className="font-mono text-[15px]">Tu voto figura como emitido</p>
          )}
          {/* No se promete el mail como un hecho: la constancia sale acá mismo,
              pero sólo si la credencial tiene dirección y la empresa tiene
              casilla configurada. El comprobante que sí está garantizado es la
              fecha y hora de arriba, que vino con el `ok` del servidor.

              Y no se pide guardar una fecha que no está en pantalla: sin hora
              —una base sin `54_`, o un `/estado` que la resolvió sin ella— esa
              frase mandaba a mirar arriba, donde no había nada. Ahí el respaldo
              es que el link va a seguir contestando lo mismo. */}
          {emitidoAt ? (
            <p className="text-ink-2 text-[17px] leading-relaxed mt-4">
              Guardá esta pantalla: la fecha y hora de arriba son tu comprobante.
            </p>
          ) : (
            <p className="text-ink-2 text-[17px] leading-relaxed mt-4">
              Podés volver a abrir este link cuando quieras: va a seguir diciendo que ya
              votaste.
            </p>
          )}
          <p className="text-ink-2 text-[17px] leading-relaxed mt-2">
            Si tenés un mail registrado, además te llega una constancia.
          </p>
          {/* Cierre propio de la institución. Va antes del "cerrá la página"
              porque es contenido, no instrucción de uso. */}
          {textoDespues && (
            <p className="text-ink-2 text-[17px] leading-relaxed mt-4 whitespace-pre-line">
              {textoDespues}
            </p>
          )}
          <p className="text-ink-3 text-sm leading-relaxed mt-3">
            Ya podés cerrar esta página. El link no vuelve a servir para votar.
          </p>
        </div>
      </div>
    )
  }

  /**
   * La duda tiene caja propia, separada de los avisos.
   *
   * No es un adorno: mientras esta caja esté, la persona tiene a mano la única
   * manera de saber si votó. Compartir la caja con los errores de boleta la
   * hacía desaparecer con cualquier click, que es el peor momento posible para
   * quedarse sin ella.
   */
  const duda = mensajeDeError({ error: 'sin_respuesta' }, emailContacto)
  const dudaVisible = dudoso && (
    <div className="voto-aviso voto-aviso--medio mb-6" role="alert">
      <div className="flex gap-3">
        <AlertCircle className="text-ink-2 shrink-0 mt-0.5" size={20} aria-hidden />
        <div>
          <h3 className="font-medium text-[17px] leading-snug">{duda.titulo}</h3>
          <p className="text-ink-2 text-[16px] leading-relaxed mt-1">{duda.detalle}</p>
          <button
            type="button"
            className="btn-secondary mt-4"
            onClick={onVerificar}
            disabled={ocupado}
          >
            {ocupado && <Loader2 className="animate-spin" size={16} />}
            Verificar si quedó registrado
          </button>
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

  // ── Segundo factor ────────────────────────────────────────────────────────

  if (fase === 'factor') {
    return (
      <div className="rise">
        {encabezado}
        {instructivo}
        {avisoVisible}
        <form onSubmit={onValidar} className="card p-6 sm:p-7">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-amber-deep" aria-hidden />
            <span className="label-mono">Verificá que sos vos</span>
          </div>
          <label htmlFor="digitos" className="block text-[17px] leading-relaxed mb-5">
            Para votar, escribí los{' '}
            <span className="hl hl-thin">últimos {verificacionDigitos} dígitos</span> de tu
            cédula.
          </label>
          <input
            id="digitos"
            name="digitos"
            className="field text-center font-mono text-2xl tracking-[0.35em]"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="go"
            maxLength={verificacionDigitos}
            value={digitos}
            aria-describedby="digitos-ayuda digitos-privacidad"
            onChange={(e) =>
              setDigitos(e.target.value.replace(/\D/g, '').slice(0, verificacionDigitos))
            }
          />
          {/* La duda más común no es cuál es la cédula, es si el verificador cuenta.
              Se contesta con el ejemplo, que además muestra que no van ni puntos ni
              guiones sin tener que decirlo dos veces. */}
          <p id="digitos-ayuda" className="text-ink-3 text-sm mt-3 leading-relaxed">
            Son los últimos {verificacionDigitos} dígitos <strong>incluyendo el dígito
            verificador</strong>, todo sin puntos ni guiones. Por ejemplo, si tu cédula
            es 1.234.567-8, escribí{' '}
            <span className="font-mono">{'12345678'.slice(-verificacionDigitos)}</span>.
          </p>
          <p id="digitos-privacidad" className="text-ink-3 text-sm mt-2 leading-relaxed">
            No mostramos tu nombre ni la boleta hasta verificarlo. Si el link te lo
            reenviaron, no alcanza para votar.
          </p>
          <button
            type="submit"
            className="btn-primary w-full mt-7"
            disabled={ocupado || digitos.length !== verificacionDigitos}
          >
            {ocupado ? <Loader2 className="animate-spin" size={18} /> : null}
            Continuar
          </button>
        </form>
      </div>
    )
  }

  if (!boleta) return null

  // ── Confirmación ──────────────────────────────────────────────────────────

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
            Esto es lo que vas a emitir como <strong>{boleta.votante}</strong>. Un voto
            emitido no se puede cambiar.
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
              // `dudoso` NO se apaga acá: volver a la boleta no contesta si el
              // voto entró, y apagarlo dejaba a la persona sin el botón que sí
              // lo contesta.
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

  // ── Boleta ────────────────────────────────────────────────────────────────

  return (
    <div>
      {enPortada && (
        <>
          {encabezado}
          {instructivo}
        </>
      )}
      {dudaVisible}
      {avisoVisible}

      <p className="text-[17px] leading-relaxed mb-6">
        Estás votando como <strong>{boleta.votante}</strong>.
      </p>

      <div className="space-y-6">
        {boleta.papeletas.map((p, i) => {
          const s = sel[p.id] ?? SELECCION_VACIA
          // Checkbox sólo cuando de verdad se puede marcar más de una. Un
          // `tipo: 'multiple'` con `max_selecciones: 1` dibujado con checkbox
          // obliga a desmarcar antes de cambiar de opción, que es exactamente
          // la trampa que no queremos con gente mayor y un teléfono en la mano.
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
