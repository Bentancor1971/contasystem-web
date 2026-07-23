'use client'

/**
 * /configuracion/eventos — Config web por evento.
 *
 * Controla qué se muestra en el formulario público /e/[slug] y el HTML propio
 * de la web (encabezado/pie, mail de acuse, certificado).
 *
 * Los textos del evento (texto_antes / texto_despues) los manda el desktop y su
 * push los sobreescribe: acá se muestran solo lectura.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Save, ExternalLink, Info, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useApp } from '@/lib/app-context'
import { canSeeConfig } from '@/lib/roles'
import { DEFAULT_EVENTO_WEB_CONFIG, type EventoWebConfig } from '@/lib/eventos-types'
import { PLANTILLAS_EJEMPLO, conPlantillasEjemplo } from '@/lib/evento-plantillas-ejemplo'

interface EventoRow {
  id: string
  slug: string
  nombre: string
  tipo: 'con_costo' | 'sin_costo'
  estado: string
  fecha_inicio: string | null
  texto_antes: string | null
  texto_despues: string | null
  transporte_disponible: boolean
  alimentacion_disponible: boolean
  sorteo_disponible: boolean
  datos_deposito: string | null
}

type BoolKey = {
  [K in keyof EventoWebConfig]: EventoWebConfig[K] extends boolean ? K : never
}[keyof EventoWebConfig]

type HtmlKey = {
  [K in keyof EventoWebConfig]: EventoWebConfig[K] extends string | null ? K : never
}[keyof EventoWebConfig]

/** Checkbox de config con etiqueta, ayuda y motivo de deshabilitado. */
function Check({
  label,
  hint,
  checked,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <label
      className={`flex items-start gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        className="accent-amber-deep w-4 h-4 mt-1 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium text-[15px]">{label}</span>
        {(disabled ? disabledReason : hint) && (
          <span className="block text-[12px] text-ink-2 mt-0.5">
            {disabled ? disabledReason : hint}
          </span>
        )}
      </span>
    </label>
  )
}

/**
 * Textarea de HTML. Definido a nivel de módulo a propósito: si viviera dentro
 * del componente, React lo remontaría en cada tecla y se perdería el foco.
 */
function HtmlArea({
  value,
  onChange,
  rows = 6,
  placeholder,
}: {
  value: string | null
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <textarea
      className="field font-mono text-[13px] leading-relaxed"
      rows={rows}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * Etiqueta de un campo de plantilla, con el atajo para volver al ejemplo.
 * El botón sólo aparece si lo que hay escrito difiere del ejemplo.
 */
function LabelPlantilla({
  label,
  actual,
  ejemplo,
  onRestaurar,
}: {
  label: string
  actual: string | null
  ejemplo: string
  onRestaurar: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <label className="label-mono">{label}</label>
      {(actual ?? '') !== ejemplo && (
        <button
          type="button"
          onClick={onRestaurar}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3 hover:text-ink-1 transition-colors"
        >
          <RotateCcw size={12} /> Restaurar ejemplo
        </button>
      )}
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="label-mono mb-4">{titulo}</h2>
      {children}
    </section>
  )
}

export default function ConfiguracionEventosPage() {
  const router = useRouter()
  const { empresa, permisos } = useApp()

  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [eventos, setEventos] = useState<EventoRow[]>([])
  const [eventoId, setEventoId] = useState('')
  const [cfg, setCfg] = useState<EventoWebConfig>({ ...DEFAULT_EVENTO_WEB_CONFIG })
  const [faltaTabla, setFaltaTabla] = useState(false)

  useEffect(() => {
    if (!canSeeConfig(permisos)) router.replace('/carga')
  }, [permisos, router])

  const cargar = useCallback(
    async (evId: string) => {
      const params = new URLSearchParams({ empresa_id: empresa.empresa_id })
      if (evId) params.set('evento_id', evId)
      const res = await fetch(`/api/admin/eventos-config?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar')
      setEventos(data.eventos as EventoRow[])
      setFaltaTabla(!data.tablaExiste)
      // Los campos que el evento todavía no tiene arrancan con la plantilla de
      // ejemplo, a la vista y editable, en vez de un placeholder fantasma.
      setCfg(conPlantillasEjemplo(data.config as EventoWebConfig))
      return data.eventos as EventoRow[]
    },
    [empresa.empresa_id],
  )

  // Carga inicial: trae los eventos y selecciona el primero.
  useEffect(() => {
    void (async () => {
      try {
        const evs = await cargar('')
        if (evs.length > 0) {
          setEventoId(evs[0].id)
          await cargar(evs[0].id)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        setLoading(false)
      }
    })()
  }, [cargar])

  async function cambiarEvento(id: string) {
    setEventoId(id)
    setLoading(true)
    try {
      await cargar(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  async function guardar() {
    if (!eventoId) return
    setGuardando(true)
    try {
      const res = await fetch('/api/admin/eventos-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa_id: empresa.empresa_id,
          evento_id: eventoId,
          ...cfg,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      toast.success('Configuración guardada')
      setFaltaTabla(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (!canSeeConfig(permisos)) return null

  const evento = eventos.find((e) => e.id === eventoId) ?? null
  const conCosto = evento?.tipo === 'con_costo'

  const set = (k: BoolKey, v: boolean) => setCfg((p) => ({ ...p, [k]: v }))
  const setHtml = (k: HtmlKey, v: string) => setCfg((p) => ({ ...p, [k]: v || null }))

  return (
    <main className="max-w-3xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} /> Configuración
      </Link>

      <div className="mb-8 rise">
        <h1 className="font-display text-4xl md:text-5xl font-medium leading-tight">
          Eventos en la web
        </h1>
        <p className="text-ink-2 mt-3 text-base max-w-xl">
          Elegí qué se muestra en el formulario público de cada evento y editá el HTML
          propio de la web.
        </p>
      </div>

      {faltaTabla && (
        <div className="card p-4 mb-6 border-status-warn">
          <p className="text-sm text-status-warn flex items-start gap-2">
            <Info size={16} className="mt-0.5 shrink-0" />
            Falta crear la tabla. Ejecutá <code>supabase/evento_web_config.sql</code> en
            Supabase. Hasta entonces, la web usa los valores por defecto.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-amber" size={28} />
        </div>
      ) : eventos.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-xl font-medium mb-1">Sin eventos publicados</p>
          <p className="text-ink-2 text-sm">
            Publicá un evento desde ContaSystem (desktop) y sincronizá para configurarlo acá.
          </p>
        </div>
      ) : (
        <div className="card p-6 lg:p-8 rise space-y-7">
          {/* Selector de evento */}
          <div>
            <label htmlFor="evento" className="label-mono block mb-2">
              Evento
            </label>
            <select
              id="evento"
              className="field text-[16px]"
              value={eventoId}
              onChange={(e) => cambiarEvento(e.target.value)}
              disabled={guardando}
            >
              {eventos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre} · {e.tipo === 'con_costo' ? 'Con costo' : 'Sin costo'}
                  {e.estado !== 'abierto' ? ` · ${e.estado}` : ''}
                </option>
              ))}
            </select>
            {evento && (
              <a
                href={`/e/${evento.slug}`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost mt-2"
              >
                <ExternalLink size={14} /> Ver página pública
              </a>
            )}
          </div>

          <Seccion titulo="Campos de datos">
            <div className="space-y-4">
              <Check
                label="Mostrar Apellido"
                checked={cfg.mostrar_apellido}
                onChange={(v) => set('mostrar_apellido', v)}
              />
              <Check
                label="Apellido obligatorio"
                checked={cfg.apellido_obligatorio}
                onChange={(v) => set('apellido_obligatorio', v)}
                disabled={!cfg.mostrar_apellido}
                disabledReason="Requiere mostrar el campo"
              />
              <Check
                label="Mostrar Email"
                checked={cfg.mostrar_email}
                onChange={(v) => set('mostrar_email', v)}
                hint="Sin email no se puede enviar el acuse de inscripción."
              />
              <Check
                label="Email obligatorio"
                checked={cfg.email_obligatorio}
                onChange={(v) => set('email_obligatorio', v)}
                disabled={!cfg.mostrar_email}
                disabledReason="Requiere mostrar el campo"
              />
              <Check
                label="Mostrar Teléfono"
                checked={cfg.mostrar_telefono}
                onChange={(v) => set('mostrar_telefono', v)}
              />
              <Check
                label="Teléfono obligatorio"
                checked={cfg.telefono_obligatorio}
                onChange={(v) => set('telefono_obligatorio', v)}
                disabled={!cfg.mostrar_telefono}
                disabledReason="Requiere mostrar el campo"
              />
            </div>
          </Seccion>

          <Seccion titulo="Categoría">
            <div className="space-y-4">
              <Check
                label="Mostrar Categoría"
                checked={conCosto ? true : cfg.mostrar_categoria}
                onChange={(v) => set('mostrar_categoria', v)}
                disabled={conCosto}
                disabledReason="En eventos con costo la categoría define el precio: siempre se muestra."
              />
              <Check
                label='Habilitar opción "Otros" (categoría libre)'
                hint="El participante puede escribir una categoría no prevista."
                checked={cfg.permitir_categoria_otros}
                onChange={(v) => set('permitir_categoria_otros', v)}
              />
            </div>
          </Seccion>

          <Seccion titulo="Extras del evento">
            <div className="space-y-4">
              <Check
                label="Mostrar Transporte"
                checked={cfg.mostrar_transporte}
                onChange={(v) => set('mostrar_transporte', v)}
                disabled={!evento?.transporte_disponible}
                disabledReason="Este evento no tiene transporte configurado en el desktop."
              />
              <Check
                label="Mostrar Alimentación"
                checked={cfg.mostrar_alimentacion}
                onChange={(v) => set('mostrar_alimentacion', v)}
                disabled={!evento?.alimentacion_disponible}
                disabledReason="Este evento no tiene alimentación configurada en el desktop."
              />
              <Check
                label="Mostrar Sorteo"
                hint="El participante marca si quiere entrar al sorteo y recibe su número por correo."
                checked={cfg.mostrar_sorteo}
                onChange={(v) => set('mostrar_sorteo', v)}
                disabled={!evento?.sorteo_disponible}
                disabledReason="Este evento no tiene sorteo configurado en el desktop."
              />
            </div>
          </Seccion>

          <Seccion titulo="Pago y Total">
            <div className="space-y-4">
              <Check
                label="Mostrar Total"
                checked={cfg.mostrar_total}
                onChange={(v) => set('mostrar_total', v)}
              />
              <Check
                label="Permitir pago por transferencia"
                checked={cfg.permitir_pago_transferencia}
                onChange={(v) => set('permitir_pago_transferencia', v)}
                disabled={!evento?.datos_deposito}
                disabledReason="Este evento no tiene datos de depósito cargados en el desktop."
              />
            </div>
          </Seccion>

          <Seccion titulo="HTML de la página pública">
            <p className="text-[12px] text-ink-2 mb-4 flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              Vienen con un texto de ejemplo para que lo uses de referencia: editalo a
              gusto. Si borrás el campo, la sección no se muestra. Acá el HTML sale tal
              cual, sin variables.
            </p>
            <div className="space-y-5">
              <div>
                <LabelPlantilla
                  label="Encabezado (arriba del formulario)"
                  actual={cfg.pagina_html_encabezado}
                  ejemplo={PLANTILLAS_EJEMPLO.pagina_html_encabezado}
                  onRestaurar={() =>
                    setHtml('pagina_html_encabezado', PLANTILLAS_EJEMPLO.pagina_html_encabezado)
                  }
                />
                <HtmlArea
                  value={cfg.pagina_html_encabezado}
                  onChange={(v) => setHtml('pagina_html_encabezado', v)}
                  placeholder="<p>Bienvenidos…</p>"
                />
              </div>
              <div>
                <LabelPlantilla
                  label="Pie (debajo del formulario)"
                  actual={cfg.pagina_html_pie}
                  ejemplo={PLANTILLAS_EJEMPLO.pagina_html_pie}
                  onRestaurar={() => setHtml('pagina_html_pie', PLANTILLAS_EJEMPLO.pagina_html_pie)}
                />
                <HtmlArea
                  value={cfg.pagina_html_pie}
                  onChange={(v) => setHtml('pagina_html_pie', v)}
                  placeholder="<p>Consultas: …</p>"
                />
              </div>
            </div>
          </Seccion>

          <Seccion titulo="Mail de acuse — Preinscripción (reserva)">
            <p className="text-[12px] text-ink-2 mb-4 flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              Se envía cuando la persona reserva el cupo para pagar después. Si lo dejás
              vacío, sale el recibo con diseño por defecto.
            </p>
            <div className="space-y-5">
              <div>
                <LabelPlantilla
                  label="Asunto"
                  actual={cfg.mail_acuse_asunto}
                  ejemplo={PLANTILLAS_EJEMPLO.mail_acuse_asunto}
                  onRestaurar={() =>
                    setHtml('mail_acuse_asunto', PLANTILLAS_EJEMPLO.mail_acuse_asunto)
                  }
                />
                <input
                  className="field"
                  placeholder="Preinscripción registrada — {evento}"
                  value={cfg.mail_acuse_asunto ?? ''}
                  onChange={(e) => setHtml('mail_acuse_asunto', e.target.value)}
                  maxLength={200}
                />
              </div>
              <div>
                <LabelPlantilla
                  label="Cuerpo (HTML)"
                  actual={cfg.mail_acuse_html}
                  ejemplo={PLANTILLAS_EJEMPLO.mail_acuse_html}
                  onRestaurar={() => setHtml('mail_acuse_html', PLANTILLAS_EJEMPLO.mail_acuse_html)}
                />
                <HtmlArea
                  value={cfg.mail_acuse_html}
                  onChange={(v) => setHtml('mail_acuse_html', v)}
                  rows={8}
                  placeholder="<p>Hola {nombre}…</p>"
                />
                <p className="mt-2 text-[11px] font-mono text-ink-3">
                  Variables: {'{nombre}'} {'{evento}'} {'{numero}'} {'{numero_sorteo}'} {'{total}'}
                </p>
              </div>
            </div>
          </Seccion>

          <Seccion titulo="Mail de acuse — Pago declarado (transferencia)">
            <p className="text-[12px] text-ink-2 mb-4 flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              Se envía cuando la persona declara que ya transfirió (queda a verificar).
              Ideal para avisar que la transferencia se va a confirmar. Si lo dejás vacío,
              sale el recibo con diseño por defecto.
            </p>
            <div className="space-y-5">
              <div>
                <LabelPlantilla
                  label="Asunto"
                  actual={cfg.mail_acuse_pago_asunto}
                  ejemplo={PLANTILLAS_EJEMPLO.mail_acuse_pago_asunto}
                  onRestaurar={() =>
                    setHtml('mail_acuse_pago_asunto', PLANTILLAS_EJEMPLO.mail_acuse_pago_asunto)
                  }
                />
                <input
                  className="field"
                  placeholder="Inscripción con pago declarado — {evento}"
                  value={cfg.mail_acuse_pago_asunto ?? ''}
                  onChange={(e) => setHtml('mail_acuse_pago_asunto', e.target.value)}
                  maxLength={200}
                />
              </div>
              <div>
                <LabelPlantilla
                  label="Cuerpo (HTML)"
                  actual={cfg.mail_acuse_pago_html}
                  ejemplo={PLANTILLAS_EJEMPLO.mail_acuse_pago_html}
                  onRestaurar={() =>
                    setHtml('mail_acuse_pago_html', PLANTILLAS_EJEMPLO.mail_acuse_pago_html)
                  }
                />
                <HtmlArea
                  value={cfg.mail_acuse_pago_html}
                  onChange={(v) => setHtml('mail_acuse_pago_html', v)}
                  rows={8}
                  placeholder="<p>Hola {nombre}… vamos a verificar tu transferencia.</p>"
                />
                <p className="mt-2 text-[11px] font-mono text-ink-3">
                  Variables: {'{nombre}'} {'{evento}'} {'{numero}'} {'{numero_sorteo}'} {'{total}'}
                </p>
              </div>
            </div>
          </Seccion>

          <Seccion titulo="Página de certificado">
            <div>
              <LabelPlantilla
                label="HTML de /c/[token]"
                actual={cfg.certificado_html}
                ejemplo={PLANTILLAS_EJEMPLO.certificado_html}
                onRestaurar={() => setHtml('certificado_html', PLANTILLAS_EJEMPLO.certificado_html)}
              />
              <HtmlArea
                value={cfg.certificado_html}
                onChange={(v) => setHtml('certificado_html', v)}
                placeholder="<p>Certificado válido…</p>"
              />
              <p className="mt-2 text-[11px] text-ink-3">
                Se agrega debajo de la tarjeta de validación. No admite variables.
              </p>
            </div>
          </Seccion>

          {/* Textos que manda el desktop — solo lectura */}
          <Seccion titulo="Textos del evento (los define el desktop)">
            <p className="text-[12px] text-ink-2 mb-3 flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              Se editan en ContaSystem. Cada sincronización los sobreescribe, por eso no se
              pueden editar acá.
            </p>
            <dl className="space-y-3 font-mono text-[13px]">
              <div>
                <dt className="text-ink-3">Texto antes</dt>
                <dd className="whitespace-pre-line">{evento?.texto_antes || '—'}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Texto después</dt>
                <dd className="whitespace-pre-line">{evento?.texto_despues || '—'}</dd>
              </div>
            </dl>
          </Seccion>

          <button
            type="button"
            className="btn-primary w-full"
            onClick={guardar}
            disabled={guardando || !eventoId}
          >
            {guardando ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {guardando ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      )}
    </main>
  )
}
