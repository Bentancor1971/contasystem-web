'use client'

/**
 * /configuracion/mails — Estado del cron de saludos de cumpleaños
 * (solo lectura). Lee /api/admin/birthday-config.
 *
 * La lista de empresas sale del registro (empresas_api_keys). Cada
 * empresa tiene un flag "Activo" (de su plantilla) que controla el envío.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  CalendarClock,
  Building2,
  Send,
  RefreshCw,
  Pencil,
  ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useApp } from '@/lib/app-context'
import { canSeeConfig } from '@/lib/roles'
import { formatFecha } from '@/lib/format'

type GmailEstado = 'completa' | 'incompleta' | 'vacia'

interface Empresa {
  empresaId: string
  nombre: string
  slug: string | null
  activo: boolean
  tieneTemplate: boolean
  gmail: {
    user: string | null
    fromName: string | null
    appPasswordSet: boolean
    estado: GmailEstado
  }
}
interface LogRow {
  socio_id: string
  empresa_id: string | null
  fecha_cumpleanos: string
  status: string
  error_message: string | null
  enviado_en: string
}
interface BirthdayConfig {
  cron: { horaEnvio: number; heartbeat: string }
  cronSecretConfigurado: boolean
  templatesTablaExiste: boolean
  empresas: Empresa[]
  logs: { tablaExiste: boolean; recientes: LogRow[]; totalEnviados: number | null }
}

/** Formatea un timestamptz ISO a fecha+hora de Montevideo. */
function fmtEnviadoEn(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-UY', {
      timeZone: 'America/Montevideo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function MailsConfigPage() {
  const router = useRouter()
  const { empresa, permisos } = useApp()
  const [config, setConfig] = useState<BirthdayConfig | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [horaEnvio, setHoraEnvio] = useState<number | null>(null)
  const [savingHora, setSavingHora] = useState(false)

  useEffect(() => {
    if (!canSeeConfig(permisos)) router.replace('/configuracion')
  }, [permisos, router])

  const cargar = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch(
        `/api/admin/birthday-config?empresa_id=${encodeURIComponent(empresa.empresa_id)}`,
        { cache: 'no-store' },
      )
      const data = (await res.json().catch(() => ({}))) as
        | BirthdayConfig
        | { error?: string }
      if (!res.ok) {
        toast.error((data as { error?: string }).error ?? `Error · ${res.status}`)
        return
      }
      const cfg = data as BirthdayConfig
      setConfig(cfg)
      setHoraEnvio(cfg.cron.horaEnvio)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar')
    } finally {
      setRefreshing(false)
    }
  }, [empresa.empresa_id])

  useEffect(() => {
    if (canSeeConfig(permisos)) void cargar()
  }, [cargar, permisos])

  if (!canSeeConfig(permisos)) return null

  async function guardarHora(h: number) {
    const previa = horaEnvio
    setHoraEnvio(h)
    setSavingHora(true)
    try {
      const res = await fetch('/api/admin/birthday-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ empresa_id: empresa.empresa_id, hora_envio: h }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? `Error · ${res.status}`)
        setHoraEnvio(previa)
        return
      }
      toast.success(`Hora de envío: ${String(h).padStart(2, '0')}:00`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
      setHoraEnvio(previa)
    } finally {
      setSavingHora(false)
    }
  }

  const operativo =
    !!config &&
    config.cronSecretConfigurado &&
    config.logs.tablaExiste &&
    config.empresas.some((e) => e.activo && e.gmail.estado === 'completa')

  return (
    <main className="max-w-3xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1.5 label-mono text-ink-2 hover:text-ink mb-5"
      >
        <ArrowLeft size={12} /> Configuración
      </Link>

      <div className="flex items-end justify-between gap-4 mb-7 rise">
        <div>
          <p className="label-mono mb-2">Envío automático</p>
          <h1 className="font-display text-4xl font-medium leading-tight">
            Saludos de cumpleaños
          </h1>
          {config && (
            <span
              className={`badge mt-3 ${operativo ? 'badge-imported' : 'badge-pending'}`}
            >
              {operativo ? 'Operativo' : 'Configuración incompleta'}
            </span>
          )}
        </div>
        <button
          onClick={() => void cargar()}
          className="btn-ghost shrink-0"
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          <span className="label-mono">Actualizar</span>
        </button>
      </div>

      {config === null ? (
        <div className="py-16 flex justify-center">
          <Loader2 size={24} className="animate-spin text-amber" />
        </div>
      ) : (
        <div className="space-y-4 rise">
          {/* Editar plantilla */}
          <Link
            href="/configuracion/mails/plantilla"
            className="card p-5 lg:p-6 flex items-center justify-between gap-4 hover:border-ink-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-light text-amber-deep flex items-center justify-center shrink-0">
                <Pencil size={18} />
              </div>
              <div>
                <div className="font-display-tight text-lg font-medium">
                  Plantilla del mail
                </div>
                <div className="text-sm text-ink-2 mt-0.5">
                  Editar imagen, texto y activar el envío por empresa
                </div>
              </div>
            </div>
            <ChevronRight size={20} className="text-ink-3 shrink-0" />
          </Link>

          {/* Programación */}
          <section className="card p-5 lg:p-7">
            <CardHeader icon={<CalendarClock size={18} />} title="Programación" />
            <div className="perforated my-4" />
            <dl className="space-y-2.5">
              <InfoRow label="Frecuencia">Todos los días</InfoRow>
              <InfoRow label="Hora de envío">
                <select
                  value={horaEnvio ?? config.cron.horaEnvio}
                  disabled={savingHora}
                  onChange={(e) => void guardarHora(Number(e.target.value))}
                  className="border border-line rounded-lg px-2 py-1 text-sm bg-white outline-none focus:border-amber-deep disabled:opacity-50"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </InfoRow>
              <InfoRow label="CRON_SECRET">
                <BoolChip
                  ok={config.cronSecretConfigurado}
                  okText="Configurado"
                  noText="Falta"
                />
              </InfoRow>
            </dl>
            <p className="font-mono text-[11px] text-ink-3 mt-3 leading-relaxed">
              Hora de Montevideo. El cron se ejecuta cada hora y manda los
              saludos cuando llega la hora configurada.
            </p>
          </section>

          {/* Empresas */}
          <section className="card p-5 lg:p-7">
            <CardHeader icon={<Building2 size={18} />} title="Empresas" />
            <p className="text-sm text-ink-2 mt-1.5 mb-4">
              Tomadas del registro. La casilla Gmail y el estado{' '}
              <strong>Activo</strong> de cada empresa se configuran en{' '}
              <strong>Plantilla del mail</strong>.
            </p>
            {config.empresas.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">
                No se encontraron empresas en el registro.
              </p>
            ) : (
              <div className="space-y-3">
                {config.empresas.map((e) => (
                  <EmpresaCard key={e.empresaId} e={e} />
                ))}
              </div>
            )}
          </section>

          {/* Últimos envíos */}
          <section className="card p-5 lg:p-7">
            <div className="flex items-center justify-between gap-3">
              <CardHeader icon={<Send size={18} />} title="Últimos envíos" />
              {config.logs.tablaExiste && config.logs.totalEnviados !== null && (
                <span className="font-mono text-xs text-ink-3 shrink-0">
                  {config.logs.totalEnviados} en total
                </span>
              )}
            </div>
            <div className="perforated my-4" />
            <LogsView logs={config.logs} />
          </section>

          {/* Nota */}
          <p className="font-mono text-[11px] text-ink-3 leading-relaxed px-1">
            Las empresas, las casillas Gmail, la plantilla y la hora de envío
            se gestionan desde la app. Solo el CRON_SECRET va en variables de
            entorno — ver BIRTHDAY_CRON.md.
          </p>
        </div>
      )}
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────
// Subcomponentes
// ────────────────────────────────────────────────────────────────────

function CardHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-amber-light text-amber-deep flex items-center justify-center shrink-0">
        {icon}
      </div>
      <h2 className="font-display-tight text-xl font-medium">{title}</h2>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="label-mono shrink-0">{label}</dt>
      <dd className="text-sm text-ink-2 text-right break-all">{children}</dd>
    </div>
  )
}

function BoolChip({
  ok,
  okText,
  noText,
}: {
  ok: boolean
  okText: string
  noText: string
}) {
  return (
    <span className={`badge ${ok ? 'badge-imported' : 'badge-rejected'}`}>
      {ok ? okText : noText}
    </span>
  )
}

function SinDato() {
  return <span className="text-ink-3 text-xs italic">sin configurar</span>
}

function EmpresaCard({ e }: { e: Empresa }) {
  return (
    <div className="border border-line rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="font-display-tight text-base font-medium">
          {e.nombre}
        </span>
        <span
          className={`badge shrink-0 ${e.activo ? 'badge-imported' : 'badge-anulado'}`}
        >
          {e.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>
      <dl className="space-y-2">
        <InfoRow label="empresa_id">
          <code className="font-mono text-xs">{e.empresaId}</code>
        </InfoRow>
        <InfoRow label="Casilla Gmail">{e.gmail.user ?? <SinDato />}</InfoRow>
        <InfoRow label="App Password">
          <BoolChip
            ok={e.gmail.appPasswordSet}
            okText="Configurada"
            noText="Falta"
          />
        </InfoRow>
        <InfoRow label="Plantilla">
          <BoolChip
            ok={e.tieneTemplate}
            okText="Guardada"
            noText="Sin guardar"
          />
        </InfoRow>
      </dl>
    </div>
  )
}

function LogsView({ logs }: { logs: BirthdayConfig['logs'] }) {
  if (!logs.tablaExiste) {
    return (
      <div className="bg-status-warn-bg text-status-warn rounded-lg p-4 text-sm leading-relaxed">
        La tabla{' '}
        <code className="font-mono text-xs">birthday_email_logs</code> todavía no
        existe. Ejecutá{' '}
        <code className="font-mono text-xs">supabase/birthday_email_logs.sql</code>{' '}
        en el SQL Editor de Supabase para habilitar el registro de envíos.
      </div>
    )
  }
  if (logs.recientes.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink-3">
        Todavía no se registraron envíos.
      </p>
    )
  }
  return (
    <div>
      {logs.recientes.map((log, i) => (
        <div key={`${log.socio_id}-${log.fecha_cumpleanos}`}>
          <div className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm">
                Cumpleaños {formatFecha(log.fecha_cumpleanos)}
              </div>
              <div className="font-mono text-[11px] text-ink-3 mt-0.5">
                socio {log.socio_id.slice(0, 8)}… · {fmtEnviadoEn(log.enviado_en)}
              </div>
              {log.error_message && (
                <div className="text-[11px] text-status-no mt-1 break-words">
                  {log.error_message}
                </div>
              )}
            </div>
            <span
              className={`badge shrink-0 ${
                log.status === 'enviado' ? 'badge-imported' : 'badge-rejected'
              }`}
            >
              {log.status === 'enviado' ? 'Enviado' : 'Error'}
            </span>
          </div>
          {i < logs.recientes.length - 1 && <div className="perforated mx-1" />}
        </div>
      ))}
    </div>
  )
}
