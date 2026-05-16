'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Search, Loader2, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/Header'
import { Highlight } from '@/components/Highlight'
import type {
  EmpresaOnline,
  PlantillaRemota,
  ContactoRemoto,
  ComprobanteRemoto,
  EstadoComprobante,
} from '@/lib/types'
import { formatMonto, formatMontoLive, parseMonto, formatFecha, hoyISO, simboloMoneda } from '@/lib/format'

const LS_KEY = 'cs-carga-empresa-id'
const MONEDAS = ['UYU', 'USD', 'EUR'] as const
type Moneda = (typeof MONEDAS)[number]
type Tab = 'cargar' | 'ultimos'

export default function CargaPage() {
  const router = useRouter()
  const [empresa, setEmpresa] = useState<EmpresaOnline | null>(null)
  const [userEmail, setUserEmail] = useState<string>('')
  const [plantillas, setPlantillas] = useState<PlantillaRemota[]>([])
  const [contactos, setContactos] = useState<ContactoRemoto[]>([])
  const [comprobantes, setComprobantes] = useState<ComprobanteRemoto[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('cargar')

  // Form
  const [fecha, setFecha] = useState(hoyISO())
  const [plantillaId, setPlantillaId] = useState<string>('')
  const [contactoId, setContactoId] = useState<string>('')
  const [monto, setMonto] = useState('')
  const [moneda, setMoneda] = useState<Moneda>('UYU')
  const [descripcion, setDescripcion] = useState('')
  const [descripcionTocada, setDescripcionTocada] = useState(false)
  const [busy, setBusy] = useState(false)

  // ── Bootstrap ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const empresaId = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      if (!empresaId) {
        router.replace('/empresa')
        return
      }
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      setUserEmail(user?.email ?? '')

      const empRes = await supabase
        .from('empresas_online_remoto')
        .select('*')
        .eq('empresa_id', empresaId)
        .single()
      if (empRes.error || !empRes.data) {
        toast.error('No tenés acceso a esa empresa')
        router.replace('/empresa')
        return
      }
      const emp = empRes.data as EmpresaOnline
      setEmpresa(emp)
      setMoneda((emp.moneda_base_codigo as Moneda) ?? 'UYU')

      const [plRes, ctRes, cmpRes] = await Promise.all([
        supabase.from('plantillas_remoto').select('*').eq('empresa_id', empresaId).eq('activo', 1).order('nombre'),
        supabase.from('contactos_remoto').select('*').or(`empresa_id.eq.${empresaId},grupo_id.eq.${emp.grupo_id ?? '___none___'}`).eq('activo', 1).eq('visible_web', 1).order('nombre_razon_social'),
        supabase.from('comprobantes_remoto').select('*').eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(20),
      ])

      if (plRes.data) setPlantillas(plRes.data as PlantillaRemota[])
      if (ctRes.data) setContactos(ctRes.data as ContactoRemoto[])
      if (cmpRes.data) setComprobantes(cmpRes.data as ComprobanteRemoto[])

      setLoading(false)
    }
    void load()
  }, [router])

  const plantillaSeleccionada = useMemo(
    () => plantillas.find((p) => p.id === plantillaId) ?? null,
    [plantillas, plantillaId],
  )

  // Pre-llenar descripción al elegir plantilla (si el user no la tocó)
  useEffect(() => {
    if (plantillaSeleccionada && !descripcionTocada) {
      setDescripcion(plantillaSeleccionada.descripcion_default ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantillaSeleccionada])

  const plantillaPorId = useMemo(
    () => Object.fromEntries(plantillas.map((p) => [p.id, p.nombre])),
    [plantillas],
  )
  const contactoPorId = useMemo(
    () => Object.fromEntries(contactos.map((c) => [c.id, c.nombre_razon_social])),
    [contactos],
  )

  const stats = useMemo(() => {
    const pendientes = comprobantes.filter((c) => c.estado === 'pendiente').length
    const importados = comprobantes.filter((c) => c.estado === 'importado').length
    const rechazados = comprobantes.filter((c) => c.estado === 'rechazado').length
    return { pendientes, importados, rechazados }
  }, [comprobantes])

  function resetForm() {
    setFecha(hoyISO())
    setPlantillaId('')
    setContactoId('')
    setMonto('')
    setMoneda((empresa?.moneda_base_codigo as Moneda) ?? 'UYU')
    setDescripcion('')
    setDescripcionTocada(false)
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresa) return
    if (!plantillaId) { toast.error('Elegí una plantilla'); return }
    const montoNum = parseMonto(monto)
    if (!isFinite(montoNum) || montoNum <= 0) { toast.error('Monto inválido'); return }

    setBusy(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('upsert_comprobante_web', {
        p_row: {
          empresa_id: empresa.empresa_id,
          plantilla_id: plantillaId,
          contacto_id: contactoId || null,
          fecha,
          moneda_codigo: moneda,
          monto_total: montoNum,
          descripcion: descripcion.trim() || null,
        },
      })
      if (error) throw new Error(error.message)
      const nuevo = data as ComprobanteRemoto
      toast.success(`Guardado · ${nuevo.numero_borrador ?? 'WEB-…'}`, { duration: 4000 })
      setComprobantes((prev) => [nuevo, ...prev].slice(0, 20))
      resetForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !empresa) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-amber" size={32} />
      </main>
    )
  }

  return (
    <>
      <Header empresa={empresa} userEmail={userEmail} />

      {/* Tabs */}
      <div className="bg-white border-b border-line">
        <div className="max-w-3xl mx-auto px-5 md:px-8">
          <div className="flex">
            <button className="tab" aria-selected={tab === 'cargar'} onClick={() => setTab('cargar')}>
              Cargar
            </button>
            <button className="tab" aria-selected={tab === 'ultimos'} onClick={() => setTab('ultimos')}>
              Últimos {comprobantes.length > 0 && `· ${comprobantes.length}`}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
        {tab === 'cargar' ? (
          <form onSubmit={guardar} className="card p-6 lg:p-10 rise">
            <div className="mb-6">
              <p className="label-mono mb-2">Nuevo</p>
              <h2 className="font-display text-3xl md:text-4xl font-medium leading-tight">
                Cargá tu <Highlight thin>comprobante</Highlight>
              </h2>
            </div>

            {/* Moneda */}
            <div className="mb-7">
              <span className="label-mono block mb-2">Moneda</span>
              <div className="pill-group" role="group">
                {MONEDAS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="pill"
                    aria-pressed={moneda === m}
                    onClick={() => setMoneda(m)}
                    disabled={busy}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-7">
              {/* Fecha */}
              <div>
                <label htmlFor="fecha" className="label-mono block mb-2">Fecha *</label>
                <input
                  id="fecha"
                  type="date"
                  className="field"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              {/* Plantilla */}
              <div>
                <label htmlFor="plantilla" className="label-mono block mb-2">Plantilla *</label>
                <select
                  id="plantilla"
                  className="field text-[17px]"
                  value={plantillaId}
                  onChange={(e) => setPlantillaId(e.target.value)}
                  required
                  disabled={busy}
                >
                  <option value="">— Elegir —</option>
                  {plantillas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                      {p.iva_porcentaje > 0 ? ` · IVA ${p.iva_porcentaje}%` : ''}
                    </option>
                  ))}
                </select>
                {plantillas.length === 0 && (
                  <p className="mt-2 text-[11px] font-mono text-ink-3">
                    Sin plantillas todavía. El contador las define en ContaSystem.
                  </p>
                )}
              </div>

              {/* Proveedor */}
              <div>
                <label htmlFor="contacto" className="label-mono block mb-2">
                  Proveedor <span className="normal-case text-ink-3 tracking-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <select
                    id="contacto"
                    className="field text-[17px] pr-8"
                    value={contactoId}
                    onChange={(e) => setContactoId(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">— Sin contacto —</option>
                    {contactos.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre_razon_social}</option>
                    ))}
                  </select>
                  <Search size={16} className="absolute right-0 bottom-3.5 text-ink-3 pointer-events-none" />
                </div>
              </div>

              {/* Total con IVA */}
              <div>
                <label htmlFor="monto" className="label-mono block mb-2">Total con IVA *</label>
                <div className="flex items-baseline gap-2 border-b-[1.5px] border-ink py-1.5">
                  <span className="font-mono text-ink-3 text-lg">{simboloMoneda(moneda)}</span>
                  <input
                    id="monto"
                    inputMode="decimal"
                    className="font-mono text-[26px] font-medium bg-transparent border-0 outline-none w-full leading-none p-0"
                    placeholder="0,00"
                    value={monto}
                    onChange={(e) => setMonto(formatMontoLive(e.target.value))}
                    disabled={busy}
                    required
                  />
                </div>
              </div>

              {/* Descripción */}
              <div>
                <label htmlFor="descripcion" className="label-mono block mb-2">Descripción</label>
                <textarea
                  id="descripcion"
                  rows={3}
                  className="w-full bg-paper-2 border border-line rounded-md px-3 py-2.5 text-[15px] resize-none focus:outline-none focus:border-ink-2 transition-colors font-sans"
                  value={descripcion}
                  onChange={(e) => { setDescripcion(e.target.value); setDescripcionTocada(true) }}
                  disabled={busy}
                  placeholder="Detalle opcional…"
                />
              </div>

              {/* Submit */}
              <div className="pt-2">
                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Guardando…' : 'Guardar comprobante'}
                  {!busy && <Save size={16} strokeWidth={2.5} />}
                </button>
                <p className="font-mono text-[11px] text-ink-3 mt-3 text-center leading-relaxed">
                  El contador verá tu carga en ContaSystem<br />y la importará al sistema.
                </p>
              </div>
            </div>
          </form>
        ) : (
          <ListaUltimos
            comprobantes={comprobantes}
            stats={stats}
            plantillaPorId={plantillaPorId}
            contactoPorId={contactoPorId}
            onVolverACargar={() => setTab('cargar')}
          />
        )}
      </main>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Lista "Últimos 20"
// ──────────────────────────────────────────────────────────────────────

function ListaUltimos({
  comprobantes, stats, plantillaPorId, contactoPorId, onVolverACargar,
}: {
  comprobantes: ComprobanteRemoto[]
  stats: { pendientes: number; importados: number; rechazados: number }
  plantillaPorId: Record<string, string>
  contactoPorId: Record<string, string>
  onVolverACargar: () => void
}) {
  return (
    <div className="card p-6 lg:p-10">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <p className="label-mono mb-2">Tu actividad</p>
          <h2 className="font-display text-3xl font-medium">Últimos 20</h2>
        </div>
        {stats.pendientes > 0 && (
          <span className="font-mono text-xs text-amber-deep font-semibold">
            {stats.pendientes} pendiente{stats.pendientes === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {comprobantes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {stats.pendientes > 0 && <span className="badge badge-pending">Pendiente · {stats.pendientes}</span>}
          {stats.importados > 0 && <span className="badge badge-imported">Importado · {stats.importados}</span>}
          {stats.rechazados > 0 && <span className="badge badge-rejected">Rechazado · {stats.rechazados}</span>}
        </div>
      )}

      <div className="perforated mb-3" />

      {comprobantes.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-display-tight text-xl text-ink-2 mb-2">Sin cargas todavía</p>
          <p className="text-sm text-ink-3 mb-6">Empezá cargando tu primer comprobante.</p>
          <button onClick={onVolverACargar} className="btn-primary mx-auto">
            <Check size={16} strokeWidth={2.5} /> Cargar comprobante
          </button>
        </div>
      ) : (
        <div>
          {comprobantes.map((c, i) => (
            <div key={c.id}>
              <ComprobanteRow
                c={c}
                plantillaNombre={plantillaPorId[c.plantilla_id] ?? '—'}
                contactoNombre={c.contacto_id ? contactoPorId[c.contacto_id] : null}
              />
              {i < comprobantes.length - 1 && <div className="perforated mx-1" />}
            </div>
          ))}
        </div>
      )}

      {comprobantes.length > 0 && (
        <>
          <div className="perforated mt-4 mb-3" />
          <p className="font-mono text-[11px] text-ink-3 text-center">
            {comprobantes.length} comprobante{comprobantes.length === 1 ? '' : 's'} · más recientes arriba
          </p>
        </>
      )}
    </div>
  )
}

function ComprobanteRow({
  c, plantillaNombre, contactoNombre,
}: {
  c: ComprobanteRemoto
  plantillaNombre: string
  contactoNombre: string | null
}) {
  const tachado = c.estado === 'rechazado'
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 px-2 py-3.5 rounded-lg hover:bg-paper-2 transition-colors">
      <div>
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-ink-3">{c.numero_borrador ?? '—'}</span>
          <EstadoBadge estado={c.estado} />
        </div>
        <div className="font-display-tight text-base font-medium">{plantillaNombre}</div>
        <div className="text-[13px] text-ink-2 mt-0.5">
          {contactoNombre ?? '—'} · {formatFecha(c.fecha)}
          {c.motivo_rechazo && (
            <>
              {' · '}
              <span className="text-status-no">{c.motivo_rechazo}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className={`font-mono text-lg font-medium leading-tight ${tachado ? 'text-ink-3 line-through' : ''}`}>
          {simboloMoneda(c.moneda_codigo)} {formatMonto(c.monto_total)}
        </div>
        <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider mt-0.5">
          {c.moneda_codigo}
        </div>
      </div>
    </div>
  )
}

function EstadoBadge({ estado }: { estado: EstadoComprobante }) {
  const cls = estado === 'pendiente' ? 'badge-pending'
    : estado === 'importado' ? 'badge-imported'
    : 'badge-rejected'
  const label = estado === 'pendiente' ? 'Pendiente'
    : estado === 'importado' ? 'Importado'
    : 'Rechazado'
  return <span className={`badge ${cls}`}>{label}</span>
}
