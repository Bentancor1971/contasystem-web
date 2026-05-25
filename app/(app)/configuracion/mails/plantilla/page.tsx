'use client'

/**
 * /configuracion/mails/plantilla — Editor de la plantilla del mail de
 * cumpleaños (una por empresa): imagen de fondo + texto con variables
 * {nombre} y {denominacion}, con preview en vivo del mail real.
 *
 * La lista de empresas sale del registro (empresas_api_keys), así una
 * empresa nueva aparece sola. Cada empresa tiene un switch "Activo" que
 * controla si el cron le manda saludos.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Upload, Trash2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { useApp } from '@/lib/app-context'
import { canSeeConfig } from '@/lib/roles'
import {
  DEFAULT_BIRTHDAY_TEMPLATE,
  renderBirthdayEmail,
  type BirthdayTemplate,
} from '@/lib/birthday-email-template'

interface EmpresaOpcion {
  empresaId: string
  nombre: string
}

interface FormState {
  activo: boolean
  /** true = solo saludar a socios con estado "activo". false = saludar a todos. */
  soloActivos: boolean
  asunto: string
  denominacion: string
  cuerpo: string
  imagenFondoPath: string | null
  imagenUrl: string | null
  textoColor: string
  panelColor: string
  panelOpacidad: number
  /** Casilla Gmail remitente. */
  gmailUser: string
  fromName: string
  /** Nueva App Password a guardar; '' = no cambiar la actual. */
  gmailAppPassword: string
  /** true si ya hay una App Password guardada. */
  gmailAppPasswordSet: boolean
}

/** Nombre de ejemplo usado en el preview. */
const NOMBRE_DEMO = 'María'

function formATemplate(f: FormState): BirthdayTemplate {
  return {
    asunto: f.asunto,
    denominacion: f.denominacion,
    cuerpo: f.cuerpo,
    imagenUrl: f.imagenUrl,
    textoColor: f.textoColor,
    panelColor: f.panelColor,
    panelOpacidad: f.panelOpacidad,
  }
}

export default function PlantillaMailPage() {
  const router = useRouter()
  const { empresa, permisos } = useApp()

  const [empresas, setEmpresas] = useState<EmpresaOpcion[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [form, setForm] = useState<FormState | null>(null)
  const [tablaExiste, setTablaExiste] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const cuerpoRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!canSeeConfig(permisos)) router.replace('/configuracion')
  }, [permisos, router])

  // 1) Cargar la lista de empresas (registro empresas_api_keys).
  useEffect(() => {
    if (!canSeeConfig(permisos)) return
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(
          `/api/admin/birthday-config?empresa_id=${encodeURIComponent(empresa.empresa_id)}`,
          { cache: 'no-store' },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error ?? `Error · ${res.status}`)
          if (vivo) setEmpresas([])
          return
        }
        const lista = (data.empresas ?? []) as {
          empresaId: string
          nombre: string
        }[]
        const opciones: EmpresaOpcion[] = lista.map((e) => ({
          empresaId: e.empresaId,
          nombre: e.nombre,
        }))
        if (!vivo) return
        setEmpresas(opciones)
        setSelected((prev) => prev || opciones[0]?.empresaId || '')
      } catch (err) {
        if (vivo) {
          toast.error(err instanceof Error ? err.message : 'Error al cargar')
          setEmpresas([])
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [empresa.empresa_id, permisos])

  // 2) Cargar la plantilla de la empresa seleccionada.
  const cargarPlantilla = useCallback(
    async (plantillaEmpresa: string) => {
      setForm(null)
      try {
        const res = await fetch(
          `/api/admin/birthday-template?empresa_id=${encodeURIComponent(
            empresa.empresa_id,
          )}&plantilla_empresa=${encodeURIComponent(plantillaEmpresa)}`,
          { cache: 'no-store' },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error ?? `Error · ${res.status}`)
          return
        }
        setTablaExiste(data.tablaExiste !== false)
        setForm({
          activo: !!data.activo,
          soloActivos: data.soloActivos !== false,
          asunto: data.asunto,
          denominacion: data.denominacion,
          cuerpo: data.cuerpo,
          imagenFondoPath: data.imagenFondoPath ?? null,
          imagenUrl: data.imagenUrl ?? null,
          textoColor: data.textoColor,
          panelColor: data.panelColor,
          panelOpacidad: data.panelOpacidad,
          gmailUser: data.gmailUser ?? '',
          fromName: data.fromName ?? '',
          gmailAppPassword: '',
          gmailAppPasswordSet: !!data.gmailAppPasswordSet,
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      }
    },
    [empresa.empresa_id],
  )

  useEffect(() => {
    if (selected) void cargarPlantilla(selected)
  }, [selected, cargarPlantilla])

  // 3) Preview en vivo (debounce para no recompilar el iframe en cada tecla).
  useEffect(() => {
    if (!form) return
    const t = setTimeout(() => {
      setPreviewHtml(
        renderBirthdayEmail({
          nombre: NOMBRE_DEMO,
          plantilla: formATemplate(form),
        }).html,
      )
    }, 250)
    return () => clearTimeout(t)
  }, [form])

  if (!canSeeConfig(permisos)) return null

  function patch(cambios: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...cambios } : f))
  }

  function insertarVariable(token: string) {
    const ta = cuerpoRef.current
    if (!ta || !form) {
      patch({ cuerpo: (form?.cuerpo ?? '') + token })
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const nuevo = ta.value.slice(0, start) + token + ta.value.slice(end)
    patch({ cuerpo: nuevo })
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + token.length
    })
  }

  async function onArchivo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-subir el mismo archivo
    if (!file) return

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(
        `/api/admin/birthday-template/imagen?empresa_id=${encodeURIComponent(
          empresa.empresa_id,
        )}&plantilla_empresa=${encodeURIComponent(selected)}`,
        { method: 'POST', body: fd },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? `Error · ${res.status}`)
        return
      }
      patch({ imagenFondoPath: data.path, imagenUrl: data.url })
      toast.success('Imagen subida')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir')
    } finally {
      setUploading(false)
    }
  }

  async function guardar() {
    if (!form || !selected) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/birthday-template', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          empresa_id: empresa.empresa_id,
          plantilla_empresa: selected,
          activo: form.activo,
          solo_activos: form.soloActivos,
          asunto: form.asunto,
          denominacion: form.denominacion,
          cuerpo: form.cuerpo,
          imagen_fondo_path: form.imagenFondoPath,
          texto_color: form.textoColor,
          panel_color: form.panelColor,
          panel_opacidad: form.panelOpacidad,
          gmail_user: form.gmailUser,
          from_name: form.fromName,
          ...(form.gmailAppPassword.trim()
            ? { gmail_app_password: form.gmailAppPassword }
            : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? `Error · ${res.status}`)
        return
      }
      toast.success('Plantilla guardada')
      setTablaExiste(true)
      // La App Password ya quedó guardada: limpiar el campo y marcarla.
      patch({
        gmailAppPasswordSet:
          form.gmailAppPasswordSet || !!form.gmailAppPassword.trim(),
        gmailAppPassword: '',
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const asuntoPreview = form
    ? renderBirthdayEmail({ nombre: NOMBRE_DEMO, plantilla: formATemplate(form) })
        .subject
    : ''

  return (
    <main className="max-w-5xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
      <Link
        href="/configuracion/mails"
        className="inline-flex items-center gap-1.5 label-mono text-ink-2 hover:text-ink mb-5"
      >
        <ArrowLeft size={12} /> Saludos de cumpleaños
      </Link>

      <div className="flex items-end justify-between gap-4 mb-6 rise">
        <div>
          <p className="label-mono mb-2">Mail de cumpleaños</p>
          <h1 className="font-display text-4xl font-medium leading-tight">
            Plantilla del mail
          </h1>
        </div>
        <button
          onClick={() => void guardar()}
          className="btn-primary whitespace-nowrap"
          disabled={saving || !form}
        >
          {saving ? 'Guardando…' : 'Guardar'}
          {!saving && <Save size={16} strokeWidth={2.5} />}
        </button>
      </div>

      {empresas === null ? (
        <div className="py-16 flex justify-center">
          <Loader2 size={24} className="animate-spin text-amber" />
        </div>
      ) : empresas.length === 0 ? (
        <div className="card p-6 text-sm text-ink-2">
          No se encontraron empresas en el registro{' '}
          <code className="font-mono text-xs">empresas_api_keys</code>.
        </div>
      ) : (
        <>
          {/* Selector de empresa */}
          <div className="mb-5 flex items-center gap-3">
            <label htmlFor="empresa-sel" className="label-mono">
              Empresa
            </label>
            <select
              id="empresa-sel"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-[15px] bg-white outline-none focus:border-amber-deep min-w-[200px]"
            >
              {empresas.map((e) => (
                <option key={e.empresaId} value={e.empresaId}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>

          {!tablaExiste && (
            <div className="card p-4 mb-5 bg-status-warn-bg text-status-warn text-sm leading-relaxed">
              La tabla{' '}
              <code className="font-mono text-xs">birthday_email_templates</code>{' '}
              todavía no existe. Ejecutá{' '}
              <code className="font-mono text-xs">
                supabase/birthday_email_templates.sql
              </code>{' '}
              en Supabase — hasta entonces no vas a poder guardar.
            </div>
          )}

          {form === null ? (
            <div className="py-16 flex justify-center">
              <Loader2 size={24} className="animate-spin text-amber" />
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-6 rise">
              {/* ── Formulario ── */}
              <div className="space-y-5">
                {/* Estado / Activo */}
                <section className="card p-5 lg:p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="font-display-tight text-lg font-medium">
                        Envío automático
                      </h2>
                      <p className="text-sm text-ink-2 mt-0.5">
                        {form.activo
                          ? 'Esta empresa recibe el saludo en cada cumpleaños.'
                          : 'Apagado — el cron no le manda saludos a esta empresa.'}
                      </p>
                    </div>
                    <Toggle
                      on={form.activo}
                      onChange={(v) => patch({ activo: v })}
                      label="Activar envío para esta empresa"
                    />
                  </div>

                  <div className="perforated my-4" />

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-display-tight text-base font-medium">
                        Solo a socios activos
                      </h3>
                      <p className="text-sm text-ink-2 mt-0.5">
                        {form.soloActivos
                          ? 'Solo reciben el saludo los socios con estado "Activo".'
                          : 'Reciben el saludo todos los socios con mail y fecha de nacimiento.'}
                      </p>
                    </div>
                    <Toggle
                      on={form.soloActivos}
                      onChange={(v) => patch({ soloActivos: v })}
                      label="Filtrar por estado activo"
                    />
                  </div>
                </section>

                {/* Casilla Gmail */}
                <section className="card p-5 lg:p-6 space-y-5">
                  <div>
                    <h2 className="font-display-tight text-lg font-medium">
                      Casilla Gmail
                    </h2>
                    <p className="text-sm text-ink-2 mt-0.5">
                      La cuenta desde la que sale el saludo de esta empresa.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="gmail-user" className="label-mono block mb-2">
                      Casilla Gmail
                    </label>
                    <input
                      id="gmail-user"
                      type="email"
                      autoComplete="off"
                      className="field text-[15px]"
                      placeholder="saludos.empresa@gmail.com"
                      value={form.gmailUser}
                      onChange={(e) => patch({ gmailUser: e.target.value })}
                    />
                  </div>

                  <div>
                    <label htmlFor="from-name" className="label-mono block mb-2">
                      Nombre del remitente
                    </label>
                    <input
                      id="from-name"
                      type="text"
                      className="field text-[15px]"
                      placeholder="Ej. AUP"
                      value={form.fromName}
                      maxLength={80}
                      onChange={(e) => patch({ fromName: e.target.value })}
                    />
                  </div>

                  <div>
                    <label htmlFor="gmail-pass" className="label-mono block mb-2">
                      App Password
                    </label>
                    <input
                      id="gmail-pass"
                      type="password"
                      autoComplete="new-password"
                      className="field text-[15px] font-mono"
                      placeholder={
                        form.gmailAppPasswordSet
                          ? '•••••••••••••••• (sin cambios)'
                          : 'App Password de 16 caracteres'
                      }
                      value={form.gmailAppPassword}
                      onChange={(e) =>
                        patch({ gmailAppPassword: e.target.value })
                      }
                    />
                    <p className="font-mono text-[11px] text-ink-3 mt-2 leading-relaxed">
                      {form.gmailAppPasswordSet
                        ? 'Ya hay una App Password guardada. Dejá el campo vacío para mantenerla, o escribí una nueva para reemplazarla.'
                        : 'Generala en myaccount.google.com/apppasswords (la cuenta necesita verificación en 2 pasos).'}
                    </p>
                  </div>
                </section>

                {/* Imagen cabecera */}
                <section className="card p-5 lg:p-6">
                  <h2 className="font-display-tight text-lg font-medium mb-1">
                    Imagen de cabecera
                  </h2>
                  <p className="text-sm text-ink-2 mb-3">
                    La identidad de la empresa. Se muestra arriba del saludo,
                    a ancho completo de la tarjeta.
                  </p>

                  {form.imagenUrl ? (
                    <div className="relative mb-3 rounded-lg overflow-hidden border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={form.imagenUrl}
                        alt="Fondo del mail"
                        className="w-full h-40 object-cover"
                      />
                    </div>
                  ) : (
                    <div className="mb-3 rounded-lg border border-dashed border-line h-40 flex items-center justify-center text-sm text-ink-3">
                      Sin imagen — el mail usa un fondo de color sólido
                    </div>
                  )}

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => void onArchivo(e)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="btn-ghost"
                      disabled={uploading}
                    >
                      {uploading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Upload size={14} />
                      )}
                      <span className="label-mono">
                        {form.imagenUrl ? 'Cambiar imagen' : 'Subir imagen'}
                      </span>
                    </button>
                    {form.imagenUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          patch({ imagenFondoPath: null, imagenUrl: null })
                        }
                        className="btn-ghost"
                        disabled={uploading}
                      >
                        <Trash2 size={14} />
                        <span className="label-mono">Quitar</span>
                      </button>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-ink-3 mt-2">
                    PNG, JPG o WebP · máx 3 MB · recomendado 1200×800 px
                  </p>
                </section>

                {/* Texto */}
                <section className="card p-5 lg:p-6 space-y-5">
                  <h2 className="font-display-tight text-lg font-medium">
                    Texto del saludo
                  </h2>

                  <div>
                    <label htmlFor="asunto" className="label-mono block mb-2">
                      Asunto
                    </label>
                    <input
                      id="asunto"
                      type="text"
                      className="field text-[15px]"
                      value={form.asunto}
                      maxLength={200}
                      onChange={(e) => patch({ asunto: e.target.value })}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="denominacion"
                      className="label-mono block mb-2"
                    >
                      Denominación
                    </label>
                    <input
                      id="denominacion"
                      type="text"
                      className="field text-[15px]"
                      placeholder="Ej. Estimado/a"
                      value={form.denominacion}
                      maxLength={80}
                      onChange={(e) => patch({ denominacion: e.target.value })}
                    />
                    <p className="font-mono text-[11px] text-ink-3 mt-2">
                      Tratamiento del socio. Se inserta donde pongas{' '}
                      <code>{'{denominacion}'}</code>.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <label htmlFor="cuerpo" className="label-mono">
                        Cuerpo
                      </label>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => insertarVariable('{nombre}')}
                          className="font-mono text-[11px] text-amber-deep hover:underline"
                        >
                          + {'{nombre}'}
                        </button>
                        <button
                          type="button"
                          onClick={() => insertarVariable('{denominacion}')}
                          className="font-mono text-[11px] text-amber-deep hover:underline"
                        >
                          + {'{denominacion}'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      id="cuerpo"
                      ref={cuerpoRef}
                      rows={6}
                      className="w-full border border-line rounded-lg p-3 text-[15px] bg-white outline-none focus:border-amber-deep resize-y"
                      value={form.cuerpo}
                      maxLength={2000}
                      onChange={(e) => patch({ cuerpo: e.target.value })}
                    />
                    <p className="font-mono text-[11px] text-ink-3 mt-2">
                      Variables: <code>{'{nombre}'}</code> ·{' '}
                      <code>{'{denominacion}'}</code>. Los saltos de línea se
                      respetan.
                    </p>
                  </div>
                </section>

                {/* Estilo del saludo */}
                <section className="card p-5 lg:p-6 space-y-4">
                  <h2 className="font-display-tight text-lg font-medium">
                    Estilo del saludo
                  </h2>
                  <p className="text-sm text-ink-2 -mt-1">
                    Colores de la tarjeta de texto que va debajo de la imagen.
                  </p>

                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="texto-color" className="label-mono">
                      Color del texto
                    </label>
                    <div className="flex items-center gap-2">
                      {form.textoColor.toLowerCase() !==
                        DEFAULT_BIRTHDAY_TEMPLATE.textoColor.toLowerCase() && (
                        <button
                          type="button"
                          onClick={() =>
                            patch({
                              textoColor: DEFAULT_BIRTHDAY_TEMPLATE.textoColor,
                            })
                          }
                          className="font-mono text-[11px] text-amber-deep hover:underline"
                        >
                          restaurar
                        </button>
                      )}
                      <input
                        id="texto-color"
                        type="color"
                        className="w-12 h-9 rounded border border-line bg-white cursor-pointer"
                        value={form.textoColor}
                        onChange={(e) => patch({ textoColor: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="panel-color" className="label-mono">
                      Color de fondo
                    </label>
                    <div className="flex items-center gap-2">
                      {form.panelColor.toLowerCase() !==
                        DEFAULT_BIRTHDAY_TEMPLATE.panelColor.toLowerCase() && (
                        <button
                          type="button"
                          onClick={() =>
                            patch({
                              panelColor: DEFAULT_BIRTHDAY_TEMPLATE.panelColor,
                            })
                          }
                          className="font-mono text-[11px] text-amber-deep hover:underline"
                        >
                          restaurar
                        </button>
                      )}
                      <input
                        id="panel-color"
                        type="color"
                        className="w-12 h-9 rounded border border-line bg-white cursor-pointer"
                        value={form.panelColor}
                        onChange={(e) => patch({ panelColor: e.target.value })}
                      />
                    </div>
                  </div>
                  <p className="font-mono text-[11px] text-ink-3 -mt-2">
                    Asegurate de que haya buen contraste entre ambos colores
                    para que el saludo se lea claramente.
                  </p>
                </section>
              </div>

              {/* ── Preview ── */}
              <div className="lg:sticky lg:top-20 lg:self-start">
                <div className="card p-5 lg:p-6">
                  <div className="flex items-baseline justify-between mb-3">
                    <h2 className="font-display-tight text-lg font-medium">
                      Vista previa
                    </h2>
                    <span className="font-mono text-[11px] text-ink-3">
                      ejemplo: {NOMBRE_DEMO}
                    </span>
                  </div>
                  <div className="mb-3">
                    <span className="label-mono">Asunto</span>
                    <p className="text-sm text-ink mt-1 break-words">
                      {asuntoPreview || '—'}
                    </p>
                  </div>
                  <div className="perforated mb-3" />
                  <iframe
                    title="Vista previa del mail"
                    srcDoc={previewHtml}
                    sandbox=""
                    className="w-full h-[560px] rounded-lg border border-line bg-white"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────
// Toggle (switch) reutilizable
// ────────────────────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-status-ok' : 'bg-paper-3'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
