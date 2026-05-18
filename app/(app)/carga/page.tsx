'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Save,
  Loader2,
  Check,
  ChevronDown,
  Pencil,
  Trash2,
  Copy,
  Ban,
  X,
  Search,
  ArrowDown,
  ArrowUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { Highlight } from '@/components/Highlight'
import { HaberLogo } from '@/components/HaberLogo'
import { useApp } from '@/lib/app-context'
import type {
  PlantillaRemota,
  ContactoRemoto,
  ComprobanteRemoto,
  EstadoComprobante,
  HaberOption,
  CuentaRemota,
  TipoCuenta,
} from '@/lib/types'
import {
  formatMonto,
  formatMontoLive,
  parseMonto,
  formatFecha,
  hoyISO,
  simboloMoneda,
} from '@/lib/format'

const MONEDAS = ['UYU', 'USD'] as const
type Moneda = (typeof MONEDAS)[number]
type Tab = 'cargar' | 'libre' | 'ultimos'

const PAGE_SIZE = 20

const HABER_PREF_KEY = (userId: string, plantillaId: string) =>
  `haberPref:${userId}:${plantillaId}`

function opcionesHaber(p: PlantillaRemota | null): HaberOption[] {
  if (!p || !p.cuenta_haber_id || !p.cuenta_haber_nombre) return []
  const base: HaberOption = {
    id: p.cuenta_haber_id,
    nombre: p.cuenta_haber_nombre,
    medio_tipo: p.cuenta_haber_medio_tipo,
    sello: p.cuenta_haber_sello,
    emisor: p.cuenta_haber_emisor,
    logo_key: p.cuenta_haber_logo_key,
    es_credito: p.cuenta_haber_es_credito,
  }
  const alt = Array.isArray(p.haberes_alternativos) ? p.haberes_alternativos : []
  // Deduplicar por id, respetando el orden (default primero)
  const seen = new Set<string>([base.id])
  const extras = alt.filter((o) => o && o.id && !seen.has(o.id) && (seen.add(o.id), true))
  return [base, ...extras]
}

export default function CargaPage() {
  const { empresa, userId } = useApp()
  const [plantillas, setPlantillas] = useState<PlantillaRemota[]>([])
  const [contactos, setContactos] = useState<ContactoRemoto[]>([])
  const [cuentas, setCuentas] = useState<CuentaRemota[]>([])
  const [comprobantes, setComprobantes] = useState<ComprobanteRemoto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [tab, setTab] = useState<Tab>('cargar')

  // Form (plantilla)
  const [fecha, setFecha] = useState(hoyISO())
  const [plantillaId, setPlantillaId] = useState<string>('')
  const [monto, setMonto] = useState('')
  const [moneda, setMoneda] = useState<Moneda>(
    (empresa.moneda_base_codigo as Moneda) ?? 'UYU',
  )
  const [descripcion, setDescripcion] = useState('')
  const [descripcionTocada, setDescripcionTocada] = useState(false)
  const [haberId, setHaberId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [anulandoId, setAnulandoId] = useState<string | null>(null)

  // Form (libre) — estado independiente, no se cruza con plantilla
  const [fechaLibre, setFechaLibre] = useState(hoyISO())
  const [montoLibre, setMontoLibre] = useState('')
  const [monedaLibre, setMonedaLibre] = useState<Moneda>(
    (empresa.moneda_base_codigo as Moneda) ?? 'UYU',
  )
  const [descripcionLibre, setDescripcionLibre] = useState('')
  const [cuentaDebeLibreId, setCuentaDebeLibreId] = useState<string>('')
  const [cuentaHaberLibreId, setCuentaHaberLibreId] = useState<string>('')
  const [pickerLibre, setPickerLibre] = useState<null | 'debe' | 'haber'>(null)
  const [busyLibre, setBusyLibre] = useState(false)
  const [editandoLibreId, setEditandoLibreId] = useState<string | null>(null)

  // ── Carga de datos de la pantalla ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const empresaId = empresa.empresa_id

      const [plRes, ctRes, cuRes, cmpRes] = await Promise.all([
        supabase
          .from('plantillas_remoto')
          .select('*')
          .eq('empresa_id', empresaId)
          .eq('activo', 1)
          .order('nombre'),
        supabase
          .from('contactos_remoto')
          .select('*')
          .or(
            `empresa_id.eq.${empresaId},grupo_id.eq.${empresa.grupo_id ?? '___none___'}`,
          )
          .eq('activo', 1)
          .eq('visible_web', 1)
          .order('nombre_razon_social'),
        supabase
          .from('cuentas_remoto')
          .select('*')
          .eq('empresa_id', empresaId)
          .eq('activo', 1)
          .order('codigo'),
        supabase
          .from('comprobantes_remoto')
          .select('*')
          .eq('empresa_id', empresaId)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE),
      ])

      if (plRes.data) setPlantillas(plRes.data as PlantillaRemota[])
      if (ctRes.data) setContactos(ctRes.data as ContactoRemoto[])
      if (cuRes.data) setCuentas(cuRes.data as CuentaRemota[])
      if (cmpRes.data) {
        const rows = cmpRes.data as ComprobanteRemoto[]
        setComprobantes(rows)
        setHasMore(rows.length === PAGE_SIZE)
      }
      setLoading(false)
    }
    void load()
  }, [empresa])

  async function cargarMas() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const supabase = createClient()
      const desde = comprobantes.length
      const { data, error } = await supabase
        .from('comprobantes_remoto')
        .select('*')
        .eq('empresa_id', empresa.empresa_id)
        .order('created_at', { ascending: false })
        .range(desde, desde + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as ComprobanteRemoto[]
      setComprobantes((prev) => [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar más')
    } finally {
      setLoadingMore(false)
    }
  }

  const plantillaSeleccionada = useMemo(
    () => plantillas.find((p) => p.id === plantillaId) ?? null,
    [plantillas, plantillaId],
  )

  const haberOpciones = useMemo(
    () => opcionesHaber(plantillaSeleccionada),
    [plantillaSeleccionada],
  )

  // Pre-llenar descripción + restaurar preferencia de Haber al elegir plantilla
  useEffect(() => {
    if (!plantillaSeleccionada) {
      setHaberId('')
      return
    }
    if (!descripcionTocada) {
      setDescripcion(plantillaSeleccionada.descripcion_default ?? '')
    }

    const defaultId = plantillaSeleccionada.cuenta_haber_id ?? ''
    let elegido = defaultId
    try {
      const stored = window.localStorage.getItem(
        HABER_PREF_KEY(userId, plantillaSeleccionada.id),
      )
      if (stored && haberOpciones.some((o) => o.id === stored)) {
        elegido = stored
      }
    } catch {
      // localStorage no disponible — usar default
    }
    setHaberId(elegido)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantillaSeleccionada])

  const plantillaPorId = useMemo(
    () => Object.fromEntries(plantillas.map((p) => [p.id, p.nombre])),
    [plantillas],
  )
  const contactoPorId = useMemo(
    () =>
      Object.fromEntries(contactos.map((c) => [c.id, c.nombre_razon_social])),
    [contactos],
  )
  const cuentaPorId = useMemo(
    () => Object.fromEntries(cuentas.map((c) => [c.id, c])),
    [cuentas],
  )

  const cuentaDebeLibre = cuentaPorId[cuentaDebeLibreId] ?? null
  const cuentaHaberLibre = cuentaPorId[cuentaHaberLibreId] ?? null

  const stats = useMemo(() => {
    const pendientes = comprobantes.filter((c) => c.estado === 'pendiente').length
    const importados = comprobantes.filter((c) => c.estado === 'importado').length
    const rechazados = comprobantes.filter((c) => c.estado === 'rechazado').length
    const anulSolicitada = comprobantes.filter(
      (c) => c.estado === 'anulacion_solicitada',
    ).length
    const anulados = comprobantes.filter((c) => c.estado === 'anulado').length
    return { pendientes, importados, rechazados, anulSolicitada, anulados }
  }, [comprobantes])

  // ── Auto-reset por inactividad (3 min sin tocar nada) ────────────────────
  // Si el form tiene datos sin grabar, avisamos a los 2:30 y reseteamos a los 3:00.
  // Cualquier cambio en plantilla/monto/descripción/etc reinicia el contador.
  const formularioSucio =
    plantillaId !== '' ||
    monto !== '' ||
    (descripcionTocada && descripcion.trim() !== '')

  useEffect(() => {
    if (!formularioSucio || tab !== 'cargar' || busy) return

    const TOAST_ID = 'auto-reset-warning'
    const warnTimer = setTimeout(() => {
      toast('Se reiniciará el formulario en 30 seg por inactividad', {
        id: TOAST_ID,
        icon: '⏱️',
        duration: 30_000,
      })
    }, 2.5 * 60 * 1000)

    const resetTimer = setTimeout(() => {
      resetForm()
      toast.dismiss(TOAST_ID)
      toast('Formulario reiniciado por inactividad', { icon: '🔄' })
    }, 3 * 60 * 1000)

    return () => {
      clearTimeout(warnTimer)
      clearTimeout(resetTimer)
      toast.dismiss(TOAST_ID)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formularioSucio,
    plantillaId, monto, descripcion, descripcionTocada,
    haberId, fecha, moneda,
    tab, busy,
  ])

  function resetForm() {
    setFecha(hoyISO())
    setPlantillaId('')
    setMonto('')
    setMoneda((empresa.moneda_base_codigo as Moneda) ?? 'UYU')
    setDescripcion('')
    setDescripcionTocada(false)
    setHaberId('')
    setEditandoId(null)
  }

  function resetFormLibre() {
    setFechaLibre(hoyISO())
    setMontoLibre('')
    setMonedaLibre((empresa.moneda_base_codigo as Moneda) ?? 'UYU')
    setDescripcionLibre('')
    setCuentaDebeLibreId('')
    setCuentaHaberLibreId('')
    setEditandoLibreId(null)
  }

  function precargarPlantilla(c: ComprobanteRemoto) {
    if (c.plantilla_id == null) return
    setFecha(c.fecha)
    setPlantillaId(c.plantilla_id)
    setMonto(formatMonto(c.monto_total))
    setMoneda((c.moneda_codigo as Moneda) ?? 'UYU')
    setDescripcion(c.descripcion ?? '')
    setDescripcionTocada(true)
    // El haberId definitivo lo setea el useEffect de plantillaSeleccionada
    // si el override existe entre las opciones; lo forzamos acá si vino override.
    if (c.cuenta_haber_override_id) {
      setHaberId(c.cuenta_haber_override_id)
    }
  }

  function precargarLibre(c: ComprobanteRemoto) {
    setFechaLibre(c.fecha)
    setMontoLibre(formatMonto(c.monto_total))
    setMonedaLibre((c.moneda_codigo as Moneda) ?? 'UYU')
    setDescripcionLibre(c.descripcion ?? '')
    setCuentaDebeLibreId(c.cuenta_debe_libre_id ?? '')
    setCuentaHaberLibreId(c.cuenta_haber_libre_id ?? '')
  }

  function modificarPendiente(c: ComprobanteRemoto) {
    if (c.estado !== 'pendiente') return
    if (c.plantilla_id) {
      setEditandoId(c.id)
      precargarPlantilla(c)
      setTab('cargar')
    } else {
      setEditandoLibreId(c.id)
      precargarLibre(c)
      setTab('libre')
    }
  }

  function duplicarComoNuevo(c: ComprobanteRemoto) {
    if (c.plantilla_id) {
      setEditandoId(null)
      precargarPlantilla(c)
      setFecha(hoyISO())
      setTab('cargar')
    } else {
      setEditandoLibreId(null)
      precargarLibre(c)
      setFechaLibre(hoyISO())
      setTab('libre')
    }
    toast.success('Datos cargados — revisá y guardá')
  }

  function cancelarEdicion() {
    resetForm()
  }

  function cancelarEdicionLibre() {
    resetFormLibre()
  }

  async function eliminarPendiente(c: ComprobanteRemoto) {
    if (c.estado !== 'pendiente') return
    const ok = window.confirm(
      `¿Eliminar el comprobante ${c.numero_borrador ?? ''}? Esta acción no se puede deshacer.`,
    )
    if (!ok) return
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('comprobantes_remoto')
        .delete()
        .eq('id', c.id)
      if (error) throw new Error(error.message)
      setComprobantes((prev) => prev.filter((x) => x.id !== c.id))
      if (editandoId === c.id) cancelarEdicion()
      toast.success('Comprobante eliminado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  async function confirmarAnulacion(motivo: string) {
    if (!anulandoId) return
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc(
        'solicitar_anulacion_comprobante_web',
        { p_id: anulandoId, p_motivo: motivo || null },
      )
      if (error) throw new Error(error.message)
      const actualizado = data as ComprobanteRemoto
      setComprobantes((prev) =>
        prev.map((x) => (x.id === actualizado.id ? actualizado : x)),
      )
      setAnulandoId(null)
      toast.success('Anulación solicitada al contador')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo solicitar la anulación')
    }
  }

  async function guardarLibre(e: React.FormEvent) {
    e.preventDefault()
    if (!cuentaDebeLibreId || !cuentaHaberLibreId) {
      toast.error('Elegí cuenta del Debe y del Haber')
      return
    }
    if (cuentaDebeLibreId === cuentaHaberLibreId) {
      toast.error('Debe y Haber no pueden ser la misma cuenta')
      return
    }
    const montoNum = parseMonto(montoLibre)
    if (!isFinite(montoNum) || montoNum <= 0) {
      toast.error('Monto inválido')
      return
    }
    const cuentaDebe = cuentaPorId[cuentaDebeLibreId]
    const cuentaHaber = cuentaPorId[cuentaHaberLibreId]
    if (!cuentaDebe || !cuentaHaber) {
      toast.error('Cuenta no encontrada')
      return
    }

    setBusyLibre(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc(
        'upsert_comprobante_libre_web',
        {
          p_row: {
            ...(editandoLibreId ? { id: editandoLibreId } : {}),
            empresa_id: empresa.empresa_id,
            fecha: fechaLibre,
            moneda_codigo: monedaLibre,
            monto_total: montoNum,
            descripcion: descripcionLibre.trim() || null,
            cuenta_debe_libre_id: cuentaDebe.id,
            cuenta_debe_libre_nombre: cuentaDebe.nombre,
            cuenta_haber_libre_id: cuentaHaber.id,
            cuenta_haber_libre_nombre: cuentaHaber.nombre,
          },
        },
      )
      if (error) throw new Error(error.message)
      const guardado = data as ComprobanteRemoto
      if (editandoLibreId) {
        toast.success(`Actualizado · ${guardado.numero_borrador ?? 'WEB-…'}`, {
          duration: 4000,
        })
        setComprobantes((prev) =>
          prev.map((x) => (x.id === guardado.id ? guardado : x)),
        )
      } else {
        toast.success(`Guardado · ${guardado.numero_borrador ?? 'WEB-…'}`, {
          duration: 4000,
        })
        setComprobantes((prev) => [guardado, ...prev])
      }
      resetFormLibre()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusyLibre(false)
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!plantillaId) {
      toast.error('Elegí una plantilla')
      return
    }
    const montoNum = parseMonto(monto)
    if (!isFinite(montoNum) || montoNum <= 0) {
      toast.error('Monto inválido')
      return
    }

    const defaultHaberId = plantillaSeleccionada?.cuenta_haber_id ?? null
    const haberElegido = haberOpciones.find((o) => o.id === haberId) ?? null
    const esOverride =
      !!haberElegido && !!defaultHaberId && haberElegido.id !== defaultHaberId

    setBusy(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('upsert_comprobante_web', {
        p_row: {
          ...(editandoId ? { id: editandoId } : {}),
          empresa_id: empresa.empresa_id,
          plantilla_id: plantillaId,
          contacto_id: null,
          fecha,
          moneda_codigo: moneda,
          monto_total: montoNum,
          descripcion: descripcion.trim() || null,
          cuenta_haber_override_id: esOverride ? haberElegido!.id : null,
          cuenta_haber_override_nombre: esOverride ? haberElegido!.nombre : null,
        },
      })
      if (error) throw new Error(error.message)
      const guardado = data as ComprobanteRemoto
      // Persistir preferencia para la próxima carga (per user + plantilla)
      if (haberElegido) {
        try {
          window.localStorage.setItem(
            HABER_PREF_KEY(userId, plantillaId),
            haberElegido.id,
          )
        } catch {
          // localStorage bloqueado — la carga ya se hizo, no rompemos por esto
        }
      }
      if (editandoId) {
        toast.success(`Actualizado · ${guardado.numero_borrador ?? 'WEB-…'}`, {
          duration: 4000,
        })
        setComprobantes((prev) =>
          prev.map((x) => (x.id === guardado.id ? guardado : x)),
        )
      } else {
        toast.success(`Guardado · ${guardado.numero_borrador ?? 'WEB-…'}`, {
          duration: 4000,
        })
        setComprobantes((prev) => [guardado, ...prev])
      }
      resetForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber" size={32} />
      </main>
    )
  }

  return (
    <>
      {/* Tabs */}
      <div className="bg-white border-b border-line">
        <div className="max-w-3xl mx-auto px-5 md:px-8">
          <div className="flex">
            <button
              className="tab"
              aria-selected={tab === 'cargar'}
              onClick={() => setTab('cargar')}
            >
              Cargar
            </button>
            <button
              className="tab"
              aria-selected={tab === 'libre'}
              onClick={() => setTab('libre')}
            >
              Libre
            </button>
            <button
              className="tab"
              aria-selected={tab === 'ultimos'}
              onClick={() => setTab('ultimos')}
            >
              Últimos {comprobantes.length > 0 && `· ${comprobantes.length}`}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
        {tab === 'libre' ? (
          <FormularioLibre
            fecha={fechaLibre}
            setFecha={setFechaLibre}
            moneda={monedaLibre}
            setMoneda={setMonedaLibre}
            monto={montoLibre}
            setMonto={setMontoLibre}
            descripcion={descripcionLibre}
            setDescripcion={setDescripcionLibre}
            cuentaDebe={cuentaDebeLibre}
            cuentaHaber={cuentaHaberLibre}
            onAbrirPicker={(modo) => setPickerLibre(modo)}
            busy={busyLibre}
            editando={!!editandoLibreId}
            onCancelarEdicion={cancelarEdicionLibre}
            onSubmit={guardarLibre}
            cuentasDisponibles={cuentas.length}
          />
        ) : tab === 'cargar' ? (
          <form onSubmit={guardar} className="card p-6 lg:p-10 rise">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <p className="label-mono mb-2">{editandoId ? 'Editando' : 'Nuevo'}</p>
                <h2 className="font-display text-3xl md:text-4xl font-medium leading-tight">
                  {editandoId ? (
                    <>Modificá tu <Highlight thin>comprobante</Highlight></>
                  ) : (
                    <>Cargá tu <Highlight thin>comprobante</Highlight></>
                  )}
                </h2>
              </div>
              {editandoId && (
                <button
                  type="button"
                  onClick={cancelarEdicion}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line bg-white hover:border-ink-3 hover:bg-paper-2 transition-colors font-mono text-[11px] uppercase tracking-wider text-ink-2"
                  aria-label="Cancelar edición"
                >
                  <X size={14} strokeWidth={2.5} />
                  Cancelar
                </button>
              )}
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
                <label htmlFor="fecha" className="label-mono block mb-2">
                  Fecha *
                </label>
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
                <label htmlFor="plantilla" className="label-mono block mb-2">
                  Plantilla *
                </label>
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
                {plantillaSeleccionada && (
                  <CuentasPlantilla
                    plantilla={plantillaSeleccionada}
                    haberId={haberId}
                  />
                )}
              </div>

              {/* Modalidad de pago (cuenta Haber) — solo si hay alternativas */}
              {plantillaSeleccionada && haberOpciones.length > 1 && (
                <div>
                  <span className="label-mono block mb-2">Modalidad de pago</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
                    {haberOpciones.map((o) => {
                      const elegido = o.id === haberId
                      const esDefault = o.id === plantillaSeleccionada.cuenta_haber_id
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role="radio"
                          aria-checked={elegido}
                          onClick={() => {
                            setHaberId(o.id)
                            try {
                              window.localStorage.setItem(
                                HABER_PREF_KEY(userId, plantillaSeleccionada.id),
                                o.id,
                              )
                            } catch {
                              // localStorage no disponible — ignorar
                            }
                          }}
                          disabled={busy}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-colors ${
                            elegido
                              ? 'border-ink bg-paper-2'
                              : 'border-line bg-white hover:border-ink-3'
                          }`}
                        >
                          <HaberLogo
                            logoKey={o.logo_key}
                            medioTipo={o.medio_tipo}
                            size={28}
                            className="shrink-0"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14px] text-ink-1 truncate">
                              {o.nombre}
                            </span>
                            <span className="flex items-center gap-2 mt-0.5">
                              {esDefault && (
                                <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider">
                                  Por defecto
                                </span>
                              )}
                              {o.es_credito && (
                                <span className="font-mono text-[10px] text-amber-deep uppercase tracking-wider bg-amber/20 px-1.5 py-0.5 rounded">
                                  Crédito
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {(() => {
                    const elegido = haberOpciones.find((o) => o.id === haberId)
                    if (!elegido?.es_credito) {
                      return (
                        <p className="mt-2 text-[11px] font-mono text-ink-3">
                          Se recuerda tu última elección para esta plantilla.
                        </p>
                      )
                    }
                    // Pagado con tarjeta crédito → se promueve a Compra Crédito
                    if (plantillaSeleccionada?.tipo_credito_nombre) {
                      return (
                        <p className="mt-2 text-[12px] text-amber-deep">
                          Al pagar con <strong>{elegido.nombre}</strong>, el comprobante se
                          registrará como <strong>{plantillaSeleccionada.tipo_credito_nombre}</strong> (compra crédito).
                        </p>
                      )
                    }
                    // Tarjeta crédito sin tipo_credito configurado → error al importar
                    return (
                      <p className="mt-2 text-[12px] text-status-no">
                        Esta plantilla no tiene configurado un tipo para compras crédito.
                        El contador debe configurarlo para que esta tarjeta pueda usarse.
                      </p>
                    )
                  })()}
                </div>
              )}

              {/* Total con IVA */}
              <div>
                <label htmlFor="monto" className="label-mono block mb-2">
                  Total con IVA *
                </label>
                <div className="flex items-baseline gap-2 border-b-[1.5px] border-ink py-1.5">
                  <span className="font-mono text-ink-3 text-lg">
                    {simboloMoneda(moneda)}
                  </span>
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
                <label htmlFor="descripcion" className="label-mono block mb-2">
                  Descripción
                </label>
                <textarea
                  id="descripcion"
                  rows={3}
                  className="w-full bg-paper-2 border border-line rounded-md px-3 py-2.5 text-[15px] resize-none focus:outline-none focus:border-ink-2 transition-colors font-sans"
                  value={descripcion}
                  onChange={(e) => {
                    setDescripcion(e.target.value)
                    setDescripcionTocada(true)
                  }}
                  disabled={busy}
                  placeholder="Detalle opcional…"
                />
              </div>

              {/* Submit */}
              <div className="pt-2">
                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy
                    ? editandoId
                      ? 'Actualizando…'
                      : 'Guardando…'
                    : editandoId
                      ? 'Guardar cambios'
                      : 'Guardar comprobante'}
                  {!busy && <Save size={16} strokeWidth={2.5} />}
                </button>
                <p className="font-mono text-[11px] text-ink-3 mt-3 text-center leading-relaxed">
                  {editandoId ? (
                    <>Tu cambio se va a reflejar en la carga pendiente.</>
                  ) : (
                    <>
                      El contador verá tu carga en ContaSystem
                      <br />y la importará al sistema.
                    </>
                  )}
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
            onCargarMas={cargarMas}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onModificar={modificarPendiente}
            onEliminar={eliminarPendiente}
            onDuplicar={duplicarComoNuevo}
            onSolicitarAnulacion={(c) => setAnulandoId(c.id)}
          />
        )}
      </main>
      {anulandoId && (
        <ModalAnulacion
          comprobante={
            comprobantes.find((c) => c.id === anulandoId) ?? null
          }
          onConfirmar={confirmarAnulacion}
          onCerrar={() => setAnulandoId(null)}
        />
      )}
      {pickerLibre && (
        <CuentaPickerModal
          modo={pickerLibre}
          cuentas={cuentas}
          seleccionadaId={
            pickerLibre === 'debe' ? cuentaDebeLibreId : cuentaHaberLibreId
          }
          excluirId={
            pickerLibre === 'debe' ? cuentaHaberLibreId : cuentaDebeLibreId
          }
          onElegir={(c) => {
            if (pickerLibre === 'debe') setCuentaDebeLibreId(c.id)
            else setCuentaHaberLibreId(c.id)
            setPickerLibre(null)
          }}
          onCerrar={() => setPickerLibre(null)}
        />
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Lista "Últimos 20"
// ──────────────────────────────────────────────────────────────────────

function ListaUltimos({
  comprobantes,
  stats,
  plantillaPorId,
  contactoPorId,
  onVolverACargar,
  onCargarMas,
  hasMore,
  loadingMore,
  onModificar,
  onEliminar,
  onDuplicar,
  onSolicitarAnulacion,
}: {
  comprobantes: ComprobanteRemoto[]
  stats: {
    pendientes: number
    importados: number
    rechazados: number
    anulSolicitada: number
    anulados: number
  }
  plantillaPorId: Record<string, string>
  contactoPorId: Record<string, string>
  onVolverACargar: () => void
  onCargarMas: () => void
  hasMore: boolean
  loadingMore: boolean
  onModificar: (c: ComprobanteRemoto) => void
  onEliminar: (c: ComprobanteRemoto) => void
  onDuplicar: (c: ComprobanteRemoto) => void
  onSolicitarAnulacion: (c: ComprobanteRemoto) => void
}) {
  return (
    <div className="card p-6 lg:p-10">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <p className="label-mono mb-2">Tu actividad</p>
          <h2 className="font-display text-3xl font-medium">
            Últimos {comprobantes.length}
          </h2>
        </div>
        {stats.pendientes > 0 && (
          <span className="font-mono text-xs text-amber-deep font-semibold">
            {stats.pendientes} pendiente{stats.pendientes === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {comprobantes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {stats.pendientes > 0 && (
            <span className="badge badge-pending">Pendiente · {stats.pendientes}</span>
          )}
          {stats.importados > 0 && (
            <span className="badge badge-imported">Importado · {stats.importados}</span>
          )}
          {stats.rechazados > 0 && (
            <span className="badge badge-rejected">Rechazado · {stats.rechazados}</span>
          )}
          {stats.anulSolicitada > 0 && (
            <span className="badge badge-anulacion-solicitada">
              Anul. solicitada · {stats.anulSolicitada}
            </span>
          )}
          {stats.anulados > 0 && (
            <span className="badge badge-anulado">Anulado · {stats.anulados}</span>
          )}
        </div>
      )}

      <div className="perforated mb-3" />

      {comprobantes.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-display-tight text-xl text-ink-2 mb-2">
            Sin cargas todavía
          </p>
          <p className="text-sm text-ink-3 mb-6">
            Empezá cargando tu primer comprobante.
          </p>
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
                plantillaNombre={
                  c.plantilla_id ? (plantillaPorId[c.plantilla_id] ?? '—') : null
                }
                contactoNombre={c.contacto_id ? contactoPorId[c.contacto_id] : null}
                onModificar={onModificar}
                onEliminar={onEliminar}
                onDuplicar={onDuplicar}
                onSolicitarAnulacion={onSolicitarAnulacion}
              />
              {i < comprobantes.length - 1 && <div className="perforated mx-1" />}
            </div>
          ))}
        </div>
      )}

      {comprobantes.length > 0 && (
        <>
          <div className="perforated mt-4 mb-3" />
          {hasMore && (
            <div className="flex justify-center mb-3">
              <button
                type="button"
                onClick={onCargarMas}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-line bg-white hover:border-ink-3 hover:bg-paper-2 transition-colors font-mono text-[12px] uppercase tracking-wider text-ink-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Cargando…
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} strokeWidth={2.5} />
                    Cargar {PAGE_SIZE} más
                  </>
                )}
              </button>
            </div>
          )}
          <p className="font-mono text-[11px] text-ink-3 text-center">
            {comprobantes.length} comprobante{comprobantes.length === 1 ? '' : 's'}
            {hasMore ? ' cargados' : ''} · más recientes arriba
          </p>
        </>
      )}
    </div>
  )
}

function ComprobanteRow({
  c,
  plantillaNombre,
  contactoNombre,
  onModificar,
  onEliminar,
  onDuplicar,
  onSolicitarAnulacion,
}: {
  c: ComprobanteRemoto
  plantillaNombre: string | null
  contactoNombre: string | null
  onModificar: (c: ComprobanteRemoto) => void
  onEliminar: (c: ComprobanteRemoto) => void
  onDuplicar: (c: ComprobanteRemoto) => void
  onSolicitarAnulacion: (c: ComprobanteRemoto) => void
}) {
  const tachado = c.estado === 'rechazado' || c.estado === 'anulado'
  const esLibre = !c.plantilla_id
  const tituloPrincipal = esLibre
    ? (c.cuenta_debe_libre_nombre ?? 'Carga libre')
    : (plantillaNombre ?? '—')
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 px-2 py-3.5 rounded-lg hover:bg-paper-2 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-ink-3">
            {c.numero_borrador ?? '—'}
          </span>
          <EstadoBadge estado={c.estado} />
          {esLibre && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 bg-paper-2 border border-line px-1.5 py-0.5 rounded">
              Libre
            </span>
          )}
        </div>
        <div className="font-display-tight text-base font-medium truncate">
          {tituloPrincipal}
        </div>
        {esLibre && c.cuenta_haber_libre_nombre && (
          <div className="text-[12px] text-ink-3 truncate">
            Haber: {c.cuenta_haber_libre_nombre}
          </div>
        )}
        <div className="text-[13px] text-ink-2 mt-0.5">
          {contactoNombre ?? '—'} · {formatFecha(c.fecha)}
          {c.motivo_rechazo && (
            <>
              {' · '}
              <span className="text-status-no">{c.motivo_rechazo}</span>
            </>
          )}
          {c.estado === 'anulacion_solicitada' && c.anulacion_motivo && (
            <>
              {' · '}
              <span className="text-amber-deep">{c.anulacion_motivo}</span>
            </>
          )}
        </div>
        <AccionesComprobante
          c={c}
          onModificar={onModificar}
          onEliminar={onEliminar}
          onDuplicar={onDuplicar}
          onSolicitarAnulacion={onSolicitarAnulacion}
        />
      </div>
      <div className="text-right">
        <div
          className={`font-mono text-lg font-medium leading-tight ${
            tachado ? 'text-ink-3 line-through' : ''
          }`}
        >
          {simboloMoneda(c.moneda_codigo)} {formatMonto(c.monto_total)}
        </div>
        <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider mt-0.5">
          {c.moneda_codigo}
        </div>
      </div>
    </div>
  )
}

function AccionesComprobante({
  c,
  onModificar,
  onEliminar,
  onDuplicar,
  onSolicitarAnulacion,
}: {
  c: ComprobanteRemoto
  onModificar: (c: ComprobanteRemoto) => void
  onEliminar: (c: ComprobanteRemoto) => void
  onDuplicar: (c: ComprobanteRemoto) => void
  onSolicitarAnulacion: (c: ComprobanteRemoto) => void
}) {
  const acciones: {
    key: string
    label: string
    icon: React.ReactNode
    onClick: () => void
    variant?: 'danger' | 'default'
  }[] = []

  if (c.estado === 'pendiente') {
    acciones.push({
      key: 'mod',
      label: 'Modificar',
      icon: <Pencil size={12} strokeWidth={2.5} />,
      onClick: () => onModificar(c),
    })
    acciones.push({
      key: 'del',
      label: 'Eliminar',
      icon: <Trash2 size={12} strokeWidth={2.5} />,
      onClick: () => onEliminar(c),
      variant: 'danger',
    })
  } else if (c.estado === 'importado') {
    acciones.push({
      key: 'anul',
      label: 'Solicitar anulación',
      icon: <Ban size={12} strokeWidth={2.5} />,
      onClick: () => onSolicitarAnulacion(c),
      variant: 'danger',
    })
  } else if (c.estado === 'rechazado') {
    acciones.push({
      key: 'dup',
      label: 'Duplicar como nuevo',
      icon: <Copy size={12} strokeWidth={2.5} />,
      onClick: () => onDuplicar(c),
    })
  }
  // anulacion_solicitada y anulado: sin acciones, solo lectura

  if (acciones.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {acciones.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={a.onClick}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border font-mono text-[10px] uppercase tracking-wider transition-colors ${
            a.variant === 'danger'
              ? 'border-line bg-white text-status-no hover:bg-status-no-bg hover:border-status-no'
              : 'border-line bg-white text-ink-2 hover:border-ink-3 hover:bg-paper-2'
          }`}
        >
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  )
}

function ModalAnulacion({
  comprobante,
  onConfirmar,
  onCerrar,
}: {
  comprobante: ComprobanteRemoto | null
  onConfirmar: (motivo: string) => void
  onCerrar: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  if (!comprobante) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4"
      onClick={onCerrar}
    >
      <div
        className="card max-w-md w-full p-6 lg:p-8 rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5">
          <p className="label-mono mb-2">Solicitar anulación</p>
          <h3 className="font-display text-2xl font-medium leading-tight">
            ¿Anular comprobante?
          </h3>
        </div>
        <div className="rounded-md bg-paper-2 border border-line px-3 py-2.5 mb-5">
          <div className="font-mono text-[11px] text-ink-3 mb-1">
            {comprobante.numero_borrador ?? '—'}
          </div>
          <div className="font-display-tight text-base font-medium">
            {simboloMoneda(comprobante.moneda_codigo)} {formatMonto(comprobante.monto_total)}{' '}
            <span className="font-mono text-[10px] text-ink-3 uppercase ml-1">
              {comprobante.moneda_codigo}
            </span>
          </div>
          <div className="text-[12px] text-ink-2">
            {formatFecha(comprobante.fecha)}
          </div>
        </div>
        <p className="text-[13px] text-ink-2 mb-4 leading-relaxed">
          El contador recibirá la solicitud y, al confirmarla en ContaSystem,
          generará la nota de crédito que reversa este comprobante.
        </p>
        <div className="mb-5">
          <label htmlFor="motivo-anul" className="label-mono block mb-2">
            Motivo (opcional)
          </label>
          <textarea
            id="motivo-anul"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={busy}
            placeholder="Ej: error en el monto, comprobante duplicado…"
            className="w-full bg-paper-2 border border-line rounded-md px-3 py-2.5 text-[14px] resize-none focus:outline-none focus:border-ink-2 transition-colors font-sans"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCerrar}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-line bg-white hover:border-ink-3 hover:bg-paper-2 transition-colors font-mono text-[12px] uppercase tracking-wider text-ink-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirmar(motivo.trim())
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-status-no text-white hover:bg-status-no/90 transition-colors font-mono text-[12px] uppercase tracking-wider disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Enviando…
              </>
            ) : (
              <>
                <Ban size={14} strokeWidth={2.5} />
                Solicitar anulación
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function CuentasPlantilla({
  plantilla,
  haberId,
}: {
  plantilla: PlantillaRemota
  haberId: string
}) {
  const opciones = opcionesHaber(plantilla)
  const opcionHaber = opciones.find((o) => o.id === haberId)
  const haberNombre = opcionHaber?.nombre ?? plantilla.cuenta_haber_nombre
  const haberLogoKey = opcionHaber?.logo_key ?? plantilla.cuenta_haber_logo_key
  const haberMedioTipo = opcionHaber?.medio_tipo ?? plantilla.cuenta_haber_medio_tipo

  // Renderizamos Debe y IVA como filas simples; Haber con logo si aplica.
  const hayAlguna =
    !!plantilla.cuenta_debe_nombre ||
    !!haberNombre ||
    (plantilla.iva_porcentaje > 0 && !!plantilla.cuenta_iva_nombre)
  if (!hayAlguna) return null

  return (
    <div className="mt-3 rounded-md bg-paper-2 border border-line px-3 py-2.5">
      <p className="label-mono mb-1.5 text-ink-3">Cuentas asignadas</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px] items-center">
        <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Debe</dt>
        <dd className="text-ink-2">{plantilla.cuenta_debe_nombre ?? '—'}</dd>

        <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Haber</dt>
        <dd className="text-ink-2 flex items-center gap-2 min-w-0">
          {haberNombre && (
            <HaberLogo
              logoKey={haberLogoKey}
              medioTipo={haberMedioTipo}
              size={18}
              className="shrink-0"
            />
          )}
          <span className="truncate">{haberNombre ?? '—'}</span>
        </dd>

        {plantilla.iva_porcentaje > 0 && (
          <>
            <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-3">IVA</dt>
            <dd className="text-ink-2">{plantilla.cuenta_iva_nombre ?? '—'}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

function EstadoBadge({ estado }: { estado: EstadoComprobante }) {
  const map: Record<EstadoComprobante, { cls: string; label: string }> = {
    pendiente: { cls: 'badge-pending', label: 'Pendiente' },
    importado: { cls: 'badge-imported', label: 'Importado' },
    rechazado: { cls: 'badge-rejected', label: 'Rechazado' },
    anulacion_solicitada: {
      cls: 'badge-anulacion-solicitada',
      label: 'Anul. solicitada',
    },
    anulado: { cls: 'badge-anulado', label: 'Anulado' },
  }
  const { cls, label } = map[estado]
  return <span className={`badge ${cls}`}>{label}</span>
}

// ──────────────────────────────────────────────────────────────────────
// Formulario de carga libre (sin plantilla, Debe + Haber elegidos del
// plan de cuentas — solo cuentas de Ingreso y Egreso)
// ──────────────────────────────────────────────────────────────────────

function FormularioLibre({
  fecha,
  setFecha,
  moneda,
  setMoneda,
  monto,
  setMonto,
  descripcion,
  setDescripcion,
  cuentaDebe,
  cuentaHaber,
  onAbrirPicker,
  busy,
  editando,
  onCancelarEdicion,
  onSubmit,
  cuentasDisponibles,
}: {
  fecha: string
  setFecha: (s: string) => void
  moneda: Moneda
  setMoneda: (m: Moneda) => void
  monto: string
  setMonto: (s: string) => void
  descripcion: string
  setDescripcion: (s: string) => void
  cuentaDebe: CuentaRemota | null
  cuentaHaber: CuentaRemota | null
  onAbrirPicker: (modo: 'debe' | 'haber') => void
  busy: boolean
  editando: boolean
  onCancelarEdicion: () => void
  onSubmit: (e: React.FormEvent) => void
  cuentasDisponibles: number
}) {
  return (
    <form onSubmit={onSubmit} className="card p-6 lg:p-10 rise">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="label-mono mb-2">
            {editando ? 'Editando libre' : 'Carga libre'}
          </p>
          <h2 className="font-display text-3xl md:text-4xl font-medium leading-tight">
            {editando ? (
              <>Modificá tu <Highlight thin>comprobante</Highlight></>
            ) : (
              <>Cargá sin <Highlight thin>plantilla</Highlight></>
            )}
          </h2>
          <p className="font-mono text-[11px] text-ink-3 mt-2 leading-relaxed">
            Elegí vos las cuentas del Debe y del Haber del plan de cuentas
            (solo cuentas de Ingreso y Egreso).
          </p>
        </div>
        {editando && (
          <button
            type="button"
            onClick={onCancelarEdicion}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line bg-white hover:border-ink-3 hover:bg-paper-2 transition-colors font-mono text-[11px] uppercase tracking-wider text-ink-2"
          >
            <X size={14} strokeWidth={2.5} />
            Cancelar
          </button>
        )}
      </div>

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
        <div>
          <label htmlFor="fecha-libre" className="label-mono block mb-2">
            Fecha *
          </label>
          <input
            id="fecha-libre"
            type="date"
            className="field"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        <CuentaSelector
          label="Debe *"
          icon={<ArrowDown size={14} strokeWidth={2.5} />}
          cuenta={cuentaDebe}
          onAbrir={() => onAbrirPicker('debe')}
          disabled={busy}
          cuentasDisponibles={cuentasDisponibles}
        />

        <CuentaSelector
          label="Haber *"
          icon={<ArrowUp size={14} strokeWidth={2.5} />}
          cuenta={cuentaHaber}
          onAbrir={() => onAbrirPicker('haber')}
          disabled={busy}
          cuentasDisponibles={cuentasDisponibles}
        />

        <div>
          <label htmlFor="monto-libre" className="label-mono block mb-2">
            Monto *
          </label>
          <div className="flex items-baseline gap-2 border-b-[1.5px] border-ink py-1.5">
            <span className="font-mono text-ink-3 text-lg">
              {simboloMoneda(moneda)}
            </span>
            <input
              id="monto-libre"
              inputMode="decimal"
              className="font-mono text-[26px] font-medium bg-transparent border-0 outline-none w-full leading-none p-0"
              placeholder="0,00"
              value={monto}
              onChange={(e) => setMonto(formatMontoLive(e.target.value))}
              disabled={busy}
              required
            />
          </div>
          <p className="mt-2 text-[11px] font-mono text-ink-3">
            Sin IVA — el monto va al Debe y al Haber tal cual.
          </p>
        </div>

        <div>
          <label htmlFor="descripcion-libre" className="label-mono block mb-2">
            Descripción
          </label>
          <textarea
            id="descripcion-libre"
            rows={3}
            className="w-full bg-paper-2 border border-line rounded-md px-3 py-2.5 text-[15px] resize-none focus:outline-none focus:border-ink-2 transition-colors font-sans"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            disabled={busy}
            placeholder="Detalle opcional…"
          />
        </div>

        <div className="pt-2">
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy
              ? editando
                ? 'Actualizando…'
                : 'Guardando…'
              : editando
                ? 'Guardar cambios'
                : 'Guardar comprobante'}
            {!busy && <Save size={16} strokeWidth={2.5} />}
          </button>
          <p className="font-mono text-[11px] text-ink-3 mt-3 text-center leading-relaxed">
            {editando ? (
              <>Tu cambio se va a reflejar en la carga pendiente.</>
            ) : (
              <>
                El contador verá tu carga en ContaSystem
                <br />y la importará al sistema.
              </>
            )}
          </p>
        </div>
      </div>
    </form>
  )
}

function CuentaSelector({
  label,
  icon,
  cuenta,
  onAbrir,
  disabled,
  cuentasDisponibles,
}: {
  label: string
  icon: React.ReactNode
  cuenta: CuentaRemota | null
  onAbrir: () => void
  disabled: boolean
  cuentasDisponibles: number
}) {
  const sinCuentas = cuentasDisponibles === 0
  return (
    <div>
      <span className="label-mono block mb-2 inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <button
        type="button"
        onClick={onAbrir}
        disabled={disabled || sinCuentas}
        className={`w-full text-left px-3 py-3 rounded-md border transition-colors flex items-center gap-3 min-w-0 ${
          cuenta
            ? 'border-ink bg-paper-2 hover:bg-paper-3'
            : 'border-line bg-white hover:border-ink-3'
        } ${(disabled || sinCuentas) ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <span className="flex-1 min-w-0">
          {cuenta ? (
            <>
              <span className="block font-mono text-[11px] text-ink-3 uppercase tracking-wider">
                {cuenta.codigo} · {cuenta.tipo}
              </span>
              <span className="block text-[15px] text-ink-1 truncate">
                {cuenta.nombre}
              </span>
            </>
          ) : (
            <span className="text-[14px] text-ink-3">— Elegir cuenta —</span>
          )}
        </span>
        <Search size={16} strokeWidth={2.25} className="text-ink-3 shrink-0" />
      </button>
      {sinCuentas && (
        <p className="mt-2 text-[11px] font-mono text-ink-3">
          Sin cuentas de Ingreso/Egreso todavía. El contador las habilita en ContaSystem.
        </p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Modal: grilla del plan de cuentas (Ingreso/Egreso) con búsqueda
// ──────────────────────────────────────────────────────────────────────

function CuentaPickerModal({
  modo,
  cuentas,
  seleccionadaId,
  excluirId,
  onElegir,
  onCerrar,
}: {
  modo: 'debe' | 'haber'
  cuentas: CuentaRemota[]
  seleccionadaId: string
  excluirId: string
  onElegir: (c: CuentaRemota) => void
  onCerrar: () => void
}) {
  const [filtro, setFiltro] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoCuenta | 'todos'>('todos')

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return cuentas.filter((c) => {
      if (c.id === excluirId) return false
      if (tipoFiltro !== 'todos' && c.tipo !== tipoFiltro) return false
      if (!q) return true
      return (
        c.nombre.toLowerCase().includes(q) ||
        c.codigo.toLowerCase().includes(q)
      )
    })
  }, [cuentas, filtro, tipoFiltro, excluirId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/40 backdrop-blur-sm px-4 py-6 sm:py-12"
      onClick={onCerrar}
    >
      <div
        className="card w-full max-w-2xl p-0 rise overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-line">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="label-mono mb-1.5">Plan de cuentas</p>
              <h3 className="font-display text-2xl font-medium leading-tight">
                Elegí cuenta del {modo === 'debe' ? 'Debe' : 'Haber'}
              </h3>
            </div>
            <button
              type="button"
              onClick={onCerrar}
              className="p-2 -mr-2 hover:bg-paper-2 rounded transition-colors"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
          <div className="relative">
            <Search
              size={14}
              strokeWidth={2.25}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
            />
            <input
              type="text"
              autoFocus
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar por código o nombre…"
              className="w-full bg-paper-2 border border-line rounded-md pl-8 pr-3 py-2 text-[14px] focus:outline-none focus:border-ink-2 transition-colors"
            />
          </div>
          <div className="pill-group mt-3" role="group">
            {(['todos', 'ingreso', 'egreso'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="pill"
                aria-pressed={tipoFiltro === t}
                onClick={() => setTipoFiltro(t)}
              >
                {t === 'todos' ? 'Todas' : t === 'ingreso' ? 'Ingreso' : 'Egreso'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {filtradas.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-display-tight text-base text-ink-2 mb-1">
                Sin resultados
              </p>
              <p className="text-[12px] text-ink-3">
                Probá con otro código o nombre.
              </p>
            </div>
          ) : (
            <ul role="listbox">
              {filtradas.map((c) => {
                const elegida = c.id === seleccionadaId
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onElegir(c)}
                      role="option"
                      aria-selected={elegida}
                      className={`w-full text-left px-6 py-3 border-b border-line/60 flex items-center gap-3 transition-colors ${
                        elegida ? 'bg-paper-2' : 'hover:bg-paper-2'
                      }`}
                    >
                      <span className="font-mono text-[11px] text-ink-3 uppercase tracking-wider w-32 shrink-0">
                        {c.codigo}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[14px] text-ink-1">
                        {c.nombre}
                      </span>
                      <span
                        className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                          c.tipo === 'ingreso'
                            ? 'bg-status-yes-bg text-status-yes'
                            : 'bg-amber/20 text-amber-deep'
                        }`}
                      >
                        {c.tipo}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-line text-center">
          <p className="font-mono text-[10px] text-ink-3 uppercase tracking-wider">
            {filtradas.length} de {cuentas.length} cuentas
          </p>
        </div>
      </div>
    </div>
  )
}
