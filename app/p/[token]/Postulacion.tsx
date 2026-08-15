'use client'

/**
 * Postulación: segundo factor → formulario → confirmación. Y la baja, para
 * quien ya se anotó y cambia de idea.
 *
 * Tres cosas que este componente NO hace, y no por olvido:
 *
 *  1. No decide nada sobre la deuda. `puede_postularse` y `advertido` llegan ya
 *     resueltos por el desktop con la política aplicada; acá se muestran y se
 *     obedecen. Si la regla se escribiera también acá, el día que cambie una de
 *     las dos la persona leería una cosa en el mail y otra en la pantalla.
 *
 *  2. No guarda el token ni los dígitos en ningún lado. El token vive en la URL
 *     y los dígitos en memoria, mientras dura la pestaña.
 *
 *  3. No muestra "listo" sin un `ok` del servidor. Si el fetch se corta, la
 *     pantalla dice que no sabemos —nunca que la postulación no se registró— y
 *     ofrece verificarlo. Un falso positivo hace que alguien crea que se anotó y
 *     se entere cuando la lista ya está armada.
 */

import { useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import {
  mensajeDeErrorPostulacion,
  textoRegularizacion,
  textoRegularizacionAdvertido,
  type ErrorPostulacion,
  type InvitadoValidado,
  type MensajePostulacion,
} from '@/lib/convocatorias-types'
import { formatFechaHoraUY, formatMonto } from '@/lib/format'

type Modo = 'postular' | 'retirar'
type Fase = 'factor' | 'formulario' | 'listo' | 'baja' | 'retirado' | 'cortado'

/** Resultado de una llamada, ya separado en "pasó algo que entiendo" y "no sé". */
type Llamada<T> =
  | { estado: 'ok'; data: T }
  | { estado: 'error'; err: ErrorPostulacion }
  | { estado: 'tope' }
  /** No llegó respuesta interpretable. Para `registrar` esto es AMBIGUO. */
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
    return { estado: 'error', err: d as unknown as ErrorPostulacion }
  return { estado: 'sin_respuesta' }
}

const MENSAJE_TOPE: MensajePostulacion = {
  titulo: 'Demasiados intentos',
  detalle: 'Esperá un momento y volvé a probar.',
  terminal: false,
}

/** Códigos con los que la postulación con seguridad NO se registró. */
const NO_SE_REGISTRO = new Set([
  'digitos_incorrectos',
  'bloqueado',
  'no_abierta',
  'convocatoria_cerrada',
  'no_puede_postularse',
  'falta_aceptar',
])

function arriba() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/**
 * La pantalla de quien no puede anotarse. Se arma con el `motivo` que mandó el
 * desktop —el mismo texto que dice el mail y que muestra la grilla— más la
 * fecha de regularización si la hay.
 *
 * Con `politica_deuda = 'bloquear'` a esta persona nunca le llegó el link, así
 * que llegar acá significa que se lo reenviaron o que pagó y el padrón todavía
 * no se re-evaluó. El texto tiene que servir para los dos casos.
 */
function motivoDeNoPoder(inv: InvitadoValidado): MensajePostulacion {
  const regularizar = textoRegularizacion(inv.fecha_limite_regularizacion)
  return {
    titulo: 'No podés anotarte en este llamado',
    detalle: [
      inv.motivo ?? 'Según el padrón de esta convocatoria, no cumplís las condiciones.',
      regularizar,
    ]
      .filter(Boolean)
      .join(' '),
    terminal: true,
  }
}

/** La situación de cuotas, en una tarjeta. No traba nada por sí sola. */
function Situacion({ inv }: { inv: InvitadoValidado }) {
  if (inv.cuotas_pendientes <= 0 && !inv.advertido) return null

  const cuotas =
    inv.cuotas_pendientes > 0
      ? `${inv.cuotas_pendientes} ${inv.cuotas_pendientes === 1 ? 'cuota pendiente' : 'cuotas pendientes'}`
      : null
  const importe = inv.importe_adeudado > 0 ? `$ ${formatMonto(inv.importe_adeudado)}` : null

  return (
    <div
      className={`voto-aviso voto-aviso--${inv.advertido ? 'medio' : 'ok'} mb-6`}
      role="status"
    >
      <h3 className="font-medium text-[17px] leading-snug">Tu situación de cuotas</h3>
      <p className="text-ink-2 text-[16px] leading-relaxed mt-1">
        {cuotas
          ? `Figurás con ${cuotas}${importe ? ` (${importe})` : ''}.`
          : 'Figurás con cuotas pendientes.'}{' '}
        {inv.advertido
          ? 'Podés anotarte igual, pero tu postulación queda sujeta a revisión por parte de la '
            + 'Comisión Directiva, podría no ser aceptada si no regularizás.'
          : 'No te impide anotarte.'}
      </p>
      {inv.advertido && textoRegularizacionAdvertido(inv.fecha_limite_regularizacion) && (
        <p className="text-ink-2 text-[16px] leading-relaxed mt-2">
          {textoRegularizacionAdvertido(inv.fecha_limite_regularizacion)}
        </p>
      )}
      {inv.deuda_actualizada_at && (
        // Que la cifra sea de hace un rato es normal y hay que decirlo: quien
        // pagó esta mañana tiene que saber por qué todavía la ve.
        <p className="text-ink-3 text-sm leading-relaxed mt-2">
          Dato al {formatFechaHoraUY(inv.deuda_actualizada_at)}. Si pagaste después, puede
          tardar un rato en actualizarse.
        </p>
      )}
    </div>
  )
}

export function Postulacion({
  token,
  modo,
  verificacionDigitos,
  emailContacto,
  textoDespues,
  invitadoInicial,
}: {
  token: string
  /** `retirar` = esta credencial ya se anotó y la ventana sigue abierta. */
  modo: Modo
  verificacionDigitos: number
  emailContacto: string | null
  /** Cierre que escribe la institución. Se muestra recién con la postulación hecha. */
  textoDespues: string | null
  /** Sólo cuando la convocatoria no pide segundo factor: la situación ya viene del server. */
  invitadoInicial: InvitadoValidado | null
}) {
  const inicial: Fase =
    modo === 'retirar'
      ? 'baja'
      : invitadoInicial
        ? invitadoInicial.puede_postularse
          ? 'formulario'
          : 'cortado'
        : 'factor'

  const [fase, setFase] = useState<Fase>(inicial)
  const [digitos, setDigitos] = useState('')
  const [invitado, setInvitado] = useState<InvitadoValidado | null>(
    invitadoInicial?.puede_postularse ? invitadoInicial : null,
  )
  const [comentario, setComentario] = useState('')
  const [acepta, setAcepta] = useState(false)
  const [aceptaAdvertencia, setAceptaAdvertencia] = useState(false)
  const [aviso, setAviso] = useState<MensajePostulacion | null>(null)
  const [cortado, setCortado] = useState<MensajePostulacion | null>(
    invitadoInicial && !invitadoInicial.puede_postularse
      ? motivoDeNoPoder(invitadoInicial)
      : null,
  )
  const [recibidaAt, setRecibidaAt] = useState<string | null>(null)
  /** El envío no respondió: puede haberse registrado o no. */
  const [dudoso, setDudoso] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  // Doble toque en el botón: el estado de React puede no haber pintado todavía.
  const enVuelo = useRef(false)

  const base = `/api/postulacion/${encodeURIComponent(token)}`
  const faltanDigitos = digitos.length !== verificacionDigitos

  function mostrar(err: ErrorPostulacion) {
    const m = mensajeDeErrorPostulacion(err, emailContacto)
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
    if (faltanDigitos) {
      setAviso({
        titulo: 'Faltan dígitos',
        detalle: `Ingresá los últimos ${verificacionDigitos} dígitos de tu cédula.`,
        terminal: false,
      })
      return
    }
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    const r = await pedir<InvitadoValidado>(`${base}/validar`, { digitos })
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok') {
      setInvitado(r.data)
      if (!r.data.puede_postularse) {
        // No se dibuja el formulario. Mostrarlo y que el servidor lo rechace al
        // enviar sería hacerle escribir a alguien para nada.
        setCortado(motivoDeNoPoder(r.data))
        setFase('cortado')
      } else {
        setFase('formulario')
      }
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
          },
    )
  }

  // ── Paso 2 · anotarse ─────────────────────────────────────────────────────

  async function onRegistrar(e: React.FormEvent) {
    e.preventDefault()
    if (enVuelo.current || !invitado) return
    if (!acepta) {
      setAviso({
        titulo: 'Falta aceptar las condiciones',
        detalle: 'Marcá la casilla del final para poder anotarte.',
        terminal: false,
      })
      return
    }
    if (invitado.advertido && !aceptaAdvertencia) {
      setAviso({
        titulo: 'Falta confirmar que leíste tu situación',
        detalle: 'Marcá que entendés que tu postulación queda sujeta a revisión.',
        terminal: false,
      })
      return
    }
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    const r = await pedir<{ ok: true; recibida_at: string }>(`${base}/registrar`, {
      digitos,
      comentario,
      acepta_condiciones: true,
    })
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok') {
      setRecibidaAt(r.data.recibida_at)
      setFase('listo')
      arriba()
      return
    }

    if (r.estado === 'tope') {
      // El 429 lo devuelve la web antes de tocar la base: no se registró nada.
      setAviso(MENSAJE_TOPE)
      return
    }

    if (r.estado === 'error') {
      if (r.err.error === 'digitos_incorrectos') {
        // Sólo puede pasar si la credencial cambió mientras estaba abierta la
        // pantalla. Se vuelve al segundo factor.
        setDigitos('')
        setFase('factor')
        arriba()
      }
      if (!NO_SE_REGISTRO.has(String(r.err.error)) && r.err.error !== 'ya_postulado') {
        // Código que no conocemos: no se afirma nada sobre si entró o no.
        setDudoso(true)
      }
      mostrar(r.err)
      return
    }

    // No hubo respuesta interpretable. La postulación PUEDE haber entrado.
    setDudoso(true)
    setAviso(mensajeDeErrorPostulacion({ error: 'sin_respuesta' }, emailContacto))
  }

  /** Contra `buscar_convocatoria`: ¿quedó registrada la que no confirmó? */
  async function onVerificar() {
    if (enVuelo.current) return
    enVuelo.current = true
    setOcupado(true)
    const r = await pedir<{ ok: true; ya_postulado: boolean }>(`${base}/estado`, {})
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok' && r.data.ya_postulado) {
      setDudoso(false)
      setAviso(null)
      setRecibidaAt(null) // `buscar_convocatoria` no devuelve la hora exacta
      setFase('listo')
      arriba()
      return
    }
    if (r.estado === 'ok') {
      setDudoso(false)
      setAviso({
        titulo: 'No quedaste anotado',
        detalle: 'Podés volver a enviarlo desde acá.',
        terminal: false,
      })
      return
    }
    setAviso({
      titulo: 'No pudimos verificarlo',
      detalle: 'Revisá tu conexión y probá de nuevo en un momento.',
      terminal: false,
    })
  }

  // ── Darse de baja ─────────────────────────────────────────────────────────

  async function onRetirar(e: React.FormEvent) {
    e.preventDefault()
    if (enVuelo.current) return
    if (faltanDigitos) {
      setAviso({
        titulo: 'Faltan dígitos',
        detalle: `Ingresá los últimos ${verificacionDigitos} dígitos de tu cédula.`,
        terminal: false,
      })
      return
    }
    enVuelo.current = true
    setOcupado(true)
    setAviso(null)
    const r = await pedir<{ ok: true }>(`${base}/retirar`, { digitos })
    enVuelo.current = false
    setOcupado(false)

    if (r.estado === 'ok') {
      setFase('retirado')
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
            titulo: 'No pudimos darte de baja',
            detalle: 'Revisá tu conexión y volvé a probar.',
            terminal: false,
          },
    )
  }

  // ── Pantallas ─────────────────────────────────────────────────────────────

  if (fase === 'cortado' && cortado) {
    return (
      <div className="voto-aviso voto-aviso--alto" role="alert">
        <h2 className="font-display text-2xl font-medium leading-tight mb-2">
          {cortado.titulo}
        </h2>
        <p className="text-ink-2 text-[17px] leading-relaxed">{cortado.detalle}</p>
      </div>
    )
  }

  if (fase === 'listo') {
    return (
      <div className="rise">
        <div className="card p-7 sm:p-8 text-center">
          <CheckCircle2 className="text-status-ok mx-auto mb-3" size={52} aria-hidden />
          <span className="label-mono text-status-ok">Postulación recibida</span>
          <h2 className="font-display text-3xl font-medium leading-tight mt-3 mb-4">
            Quedaste anotado{invitado?.nombre ? `, ${invitado.nombre}` : ''}
          </h2>
          <div className="perforated mb-4" />
          {recibidaAt ? (
            <p className="font-mono text-[15px]">Recibida el {formatFechaHoraUY(recibidaAt)}</p>
          ) : (
            <p className="font-mono text-[15px]">Tu postulación figura registrada</p>
          )}
          <p className="text-ink-2 text-[17px] leading-relaxed mt-4">
            Anotarte no te compromete a nada todavía: la lista se conforma después, de
            común acuerdo, y la comisión se comunica con los interesados.
          </p>
          {/* No se promete el mail como un hecho: el acuse lo manda el desktop
              cuando baja la postulación, y sólo si hay dirección registrada. El
              comprobante garantizado es la fecha y hora de arriba, que vino con
              el `ok` del servidor. */}
          <p className="text-ink-2 text-[17px] leading-relaxed mt-2">
            Si tenés un mail registrado te estará llegando un acuse de recibo.
          </p>
          {textoDespues && (
            <p className="text-ink-2 text-[17px] leading-relaxed mt-4 whitespace-pre-line">
              {textoDespues}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (fase === 'retirado') {
    return (
      <div className="rise">
        <div className="card p-7 sm:p-8 text-center">
          <span className="label-mono">Baja registrada</span>
          <h2 className="font-display text-3xl font-medium leading-tight mt-3 mb-4">
            Te sacamos de la lista de interesados
          </h2>
          <div className="perforated mb-4" />
          <p className="text-ink-2 text-[17px] leading-relaxed">
            Ya no figurás anotado en este llamado. Si cambiás de idea, podés volver a
            anotarte con este mismo link mientras el plazo siga abierto.
          </p>
          <button
            type="button"
            className="btn-secondary mt-6 mx-auto"
            onClick={() => window.location.reload()}
          >
            Volver a anotarme
          </button>
        </div>
      </div>
    )
  }

  const avisoVisible = aviso && (
    <div
      className={`voto-aviso ${dudoso ? 'voto-aviso--medio' : 'voto-aviso--alto'} mb-6`}
      role="alert"
    >
      <div className="flex gap-3">
        <AlertCircle className="text-ink-2 shrink-0 mt-0.5" size={20} aria-hidden />
        <div>
          <h3 className="font-medium text-[17px] leading-snug">{aviso.titulo}</h3>
          <p className="text-ink-2 text-[16px] leading-relaxed mt-1">{aviso.detalle}</p>
          {dudoso && (
            <button
              type="button"
              className="btn-secondary mt-4"
              onClick={onVerificar}
              disabled={ocupado}
            >
              {ocupado && <Loader2 className="animate-spin" size={16} />}
              Verificar si quedó registrada
            </button>
          )}
        </div>
      </div>
    </div>
  )

  // ── El campo de los dígitos, igual en las dos entradas ────────────────────

  const campoDigitos = (
    <>
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
        aria-describedby="digitos-ayuda"
        onChange={(e) =>
          setDigitos(e.target.value.replace(/\D/g, '').slice(0, verificacionDigitos))
        }
      />
      <p id="digitos-ayuda" className="text-ink-3 text-sm mt-3 leading-relaxed">
        No mostramos tu nombre ni tu situación hasta verificarlo. Si el link te lo
        reenviaron, no alcanza.
      </p>
    </>
  )

  // ── Baja ──────────────────────────────────────────────────────────────────

  if (fase === 'baja') {
    return (
      <div className="rise">
        {avisoVisible}
        <div className="voto-aviso voto-aviso--ok mb-6" role="status">
          <h2 className="font-display text-2xl font-medium leading-tight mb-2">
            Ya estás anotado
          </h2>
          <p className="text-ink-2 text-[17px] leading-relaxed">
            Tu interés en integrar la lista está registrado. No hay nada más que hacer:
            la comisión se comunica con los interesados cuando cierre el plazo.
          </p>
        </div>

        <form onSubmit={onRetirar} className="card p-6 sm:p-7">
          <span className="label-mono">¿Cambiaste de idea?</span>
          <p className="text-[17px] leading-relaxed mt-3 mb-5">
            Podés darte de baja mientras el plazo siga abierto.
            {verificacionDigitos > 0 && (
              <>
                {' '}
                Escribí los{' '}
                <span className="hl hl-thin">últimos {verificacionDigitos} dígitos</span> de
                tu cédula para confirmarlo.
              </>
            )}
          </p>
          {verificacionDigitos > 0 && campoDigitos}
          <button
            type="submit"
            className="btn-secondary w-full mt-7"
            disabled={ocupado || (verificacionDigitos > 0 && faltanDigitos)}
          >
            {ocupado ? <Loader2 className="animate-spin" size={18} /> : <UserMinus size={18} />}
            Darme de baja
          </button>
        </form>
      </div>
    )
  }

  // ── Segundo factor ────────────────────────────────────────────────────────

  if (fase === 'factor') {
    return (
      <div className="rise">
        {avisoVisible}
        <form onSubmit={onValidar} className="card p-6 sm:p-7">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-amber-deep" aria-hidden />
            <span className="label-mono">Verificá que sos vos</span>
          </div>
          <label htmlFor="digitos" className="block text-[17px] leading-relaxed mb-5">
            Para anotarte, escribí los{' '}
            <span className="hl hl-thin">últimos {verificacionDigitos} dígitos</span> de tu
            cédula, sin puntos ni guiones.
          </label>
          {campoDigitos}
          <button
            type="submit"
            className="btn-primary w-full mt-7"
            disabled={ocupado || faltanDigitos}
          >
            {ocupado ? <Loader2 className="animate-spin" size={18} /> : null}
            Continuar
          </button>
        </form>
      </div>
    )
  }

  if (!invitado) return null

  // ── Formulario ────────────────────────────────────────────────────────────

  return (
    <div className="rise">
      {avisoVisible}

      <p className="text-[17px] leading-relaxed mb-6">
        Te estás anotando como <strong>{invitado.nombre}</strong>.
      </p>

      <Situacion inv={invitado} />

      <form onSubmit={onRegistrar} className="card p-6 sm:p-7">
        <span className="label-mono">Anotarme</span>
        <h2 className="font-display text-2xl font-medium leading-tight mt-3 mb-2">
          Me interesa integrar la lista
        </h2>
        {/* El tono es deliberado: el problema real de una convocatoria no es que
            sobren candidatos, es que faltan. Decir con todas las letras que esto
            no compromete a nada es lo que hace que alguien se anote. */}
        <p className="text-ink-2 text-[17px] leading-relaxed mb-6">
          Con esto sólo declarás interés. No elegís lista, ni cargo, ni compañeros: eso
          se acuerda después, entre todos.
        </p>

        <label htmlFor="comentario" className="block label-mono mb-2">
          Comentario <span className="text-ink-3">(opcional)</span>
        </label>
        <textarea
          id="comentario"
          name="comentario"
          className="field mb-6"
          rows={4}
          maxLength={2000}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />

        {invitado.advertido && (
          <label className="flex gap-3 items-start text-[16px] leading-relaxed mb-5">
            <input
              type="checkbox"
              className="voto-control mt-0.5"
              checked={aceptaAdvertencia}
              onChange={(e) => setAceptaAdvertencia(e.target.checked)}
            />
            <span>
              Entiendo que figuro con cuotas pendientes y que mi postulación queda sujeta
              a revisión de la comisión.
            </span>
          </label>
        )}

        <label className="flex gap-3 items-start text-[16px] leading-relaxed">
          <input
            type="checkbox"
            className="voto-control mt-0.5"
            checked={acepta}
            onChange={(e) => setAcepta(e.target.checked)}
          />
          <span>Declaro conocer el estatuto y las condiciones de esta convocatoria.</span>
        </label>

        <button
          type="submit"
          className="btn-primary w-full mt-7"
          disabled={ocupado || !acepta || (invitado.advertido && !aceptaAdvertencia)}
        >
          {ocupado ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
          Anotarme
        </button>
      </form>
    </div>
  )
}
