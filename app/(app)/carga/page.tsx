'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  ArrowDown,
  ArrowUp,
  RefreshCw,
  CloudOff,
  UploadCloud,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { Highlight } from '@/components/Highlight'
import { HaberLogo } from '@/components/HaberLogo'
import { useApp } from '@/lib/app-context'
import { useOnlineStatus } from '@/lib/useOnlineStatus'
import {
  type ColaItem,
  type ColaItemDisplay,
  type ColaRpc,
  type ColaTipo,
  agregarACola,
  actualizarEnCola,
  eliminarDeCola,
  esErrorDeRed,
  generarIdLocal,
  listarCola,
} from '@/lib/offlineQueue'
import type {
  PlantillaRemota,
  ContactoRemoto,
  ComprobanteRemoto,
  EstadoComprobante,
  HaberOption,
  CuentaRemota,
  TipoComprobanteRemoto,
} from '@/lib/types'
import {
  formatMonto,
  formatFecha,
  hoyISO,
  simboloMoneda,
  onMontoInput,
  normalizarMonto,
  evaluarMonto,
  esExpresionMonto,
} from '@/lib/format'

const MONEDAS = ['UYU', 'USD'] as const
type Moneda = (typeof MONEDAS)[number]
type Tab = 'cargar' | 'general' | 'ultimos'

const PAGE_SIZE = 20

const HABER_PREF_KEY = (userId: string, plantillaId: string) =>
  `haberPref:${userId}:${plantillaId}`

const PLANTILLA_USO_KEY = (userId: string) => `plantillaUso:${userId}`
const TOP_PLANTILLAS = 5

type PlantillaUsoMap = Record<string, number>

function leerPlantillaUso(userId: string): PlantillaUsoMap {
  try {
    const raw = window.localStorage.getItem(PLANTILLA_USO_KEY(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: PlantillaUsoMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && v > 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function escribirPlantillaUso(userId: string, mapa: PlantillaUsoMap): void {
  try {
    window.localStorage.setItem(PLANTILLA_USO_KEY(userId), JSON.stringify(mapa))
  } catch {
    // localStorage bloqueado — ignorar
  }
}

function opcionesHaber(p: PlantillaRemota | null): HaberOption[] {
  if (!p || !p.cuenta_haber_id || !p.cuenta_haber_nombre) return []
  const base: HaberOption = {
    id: p.cuenta_haber_id,
    nombre: p.cuenta_haber_nombre,
    moneda: p.cuenta_haber_moneda,
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

/**
 * Devuelve un mensaje de warning si la moneda elegida no coincide con la
 * moneda de alguna de las cuentas involucradas. Si las cuentas no tienen
 * `moneda` (plantillas viejas, antes de la migración), no valida.
 */
function warningMoneda(
  monedaElegida: string,
  cuentas: { label: string; moneda: string | null | undefined }[],
): string | null {
  const conflictos = cuentas.filter(
    (c) => c.moneda && c.moneda !== monedaElegida,
  )
  if (conflictos.length === 0) return null
  const detalle = conflictos
    .map((c) => `${c.label} es ${c.moneda}`)
    .join(' · ')
  return `Atención: cargás en ${monedaElegida} pero ${detalle}.`
}

export default function CargaPage() {
  const { empresa, userId } = useApp()
  const [plantillas, setPlantillas] = useState<PlantillaRemota[]>([])
  const [contactos, setContactos] = useState<ContactoRemoto[]>([])
  const [cuentas, setCuentas] = useState<CuentaRemota[]>([])
  const [tiposComprobante, setTiposComprobante] = useState<TipoComprobanteRemoto[]>([])
  const [comprobantes, setComprobantes] = useState<ComprobanteRemoto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [tab, setTab] = useState<Tab>('cargar')
  // Filtro de autoría en "Últimos": por defecto solo los comprobantes que
  // cargó este usuario; "todos" muestra los de toda la empresa. Filtra del lado
  // del servidor para que paginación y contadores reflejen el subconjunto.
  const [filtroAutor, setFiltroAutor] = useState<'mios' | 'todos'>('mios')
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const lastRefetchRef = useRef(0)
  const REFETCH_THROTTLE_MS = 30_000

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
  // Contacto: lo setea el useEffect de plantillaSeleccionada (pre-fill del
  // plantilla.contacto_id si existe). El usuario lo puede sobreescribir con
  // "cambiar" cuando viene bloqueado por la plantilla.
  const [contactoId, setContactoId] = useState<string>('')
  const [contactoLocked, setContactoLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [anulandoId, setAnulandoId] = useState<string | null>(null)
  const [plantillaUso, setPlantillaUso] = useState<PlantillaUsoMap>({})

  useEffect(() => {
    setPlantillaUso(leerPlantillaUso(userId))
  }, [userId])

  // ── Cola offline (cargas que no llegaron a Supabase) ─────────────────────
  const online = useOnlineStatus()
  const [enCola, setEnCola] = useState<ColaItem[]>([])
  const [sincronizando, setSincronizando] = useState(false)
  const enColaRef = useRef<ColaItem[]>([])
  const sincronizandoRef = useRef(false)
  useEffect(() => { enColaRef.current = enCola }, [enCola])
  useEffect(() => { sincronizandoRef.current = sincronizando }, [sincronizando])

  // Form (general) — usa cuentas habilitadas para web con selects nativos.
  // Mismo backend que Libre (upsert_comprobante_libre_web).
  const [fechaGeneral, setFechaGeneral] = useState(hoyISO())
  const [montoGeneral, setMontoGeneral] = useState('')
  const [monedaGeneral, setMonedaGeneral] = useState<Moneda>(
    (empresa.moneda_base_codigo as Moneda) ?? 'UYU',
  )
  const [descripcionGeneral, setDescripcionGeneral] = useState('')
  const [cuentaDebeGeneralId, setCuentaDebeGeneralId] = useState<string>('')
  const [cuentaHaberGeneralId, setCuentaHaberGeneralId] = useState<string>('')
  const [tipoComprobanteGeneralId, setTipoComprobanteGeneralId] = useState<string>('')
  const [busyGeneral, setBusyGeneral] = useState(false)
  const [editandoGeneralId, setEditandoGeneralId] = useState<string | null>(null)

  // ── Carga de datos de la pantalla ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const empresaId = empresa.empresa_id

      let cmpQuery = supabase
        .from('comprobantes_remoto')
        .select('*')
        .eq('empresa_id', empresaId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      // En el primer load el filtro siempre arranca en 'mios' (default).
      if (filtroAutor === 'mios') cmpQuery = cmpQuery.eq('created_by', userId)

      const [plRes, ctRes, cuRes, tcRes, cmpRes] = await Promise.all([
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
          .from('tipos_comprobante_remoto')
          .select('*')
          .eq('empresa_id', empresaId)
          .eq('activo', 1)
          .order('abreviacion'),
        cmpQuery,
      ])

      if (plRes.data) setPlantillas(plRes.data as PlantillaRemota[])
      if (ctRes.data) setContactos(ctRes.data as ContactoRemoto[])
      if (cuRes.data) setCuentas(cuRes.data as CuentaRemota[])
      if (tcRes.data) setTiposComprobante(tcRes.data as TipoComprobanteRemoto[])
      if (cmpRes.data) {
        const rows = cmpRes.data as ComprobanteRemoto[]
        setComprobantes(rows)
        setHasMore(rows.length === PAGE_SIZE)
      }
      setLoading(false)
    }
    void load()
    // filtroAutor/userId se leen con su valor inicial ('mios'); el cambio de
    // filtro se maneja en su propio effect, no recargando toda la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa])

  async function cargarMas() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const supabase = createClient()
      const desde = comprobantes.length
      let q = supabase
        .from('comprobantes_remoto')
        .select('*')
        .eq('empresa_id', empresa.empresa_id)
        .order('created_at', { ascending: false })
        .range(desde, desde + PAGE_SIZE - 1)
      if (filtroAutor === 'mios') q = q.eq('created_by', userId)
      const { data, error } = await q
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

  // Refetch del listado para sincronizar cambios de estado (ej: el contador
  // importó un comprobante desde el desktop). Mantiene el tamaño de página
  // actual del usuario.
  const refetchComprobantes = useCallback(
    async (opts: { silencioso?: boolean; forzar?: boolean; reset?: boolean } = {}) => {
      if (refreshingRef.current) return
      const ahora = Date.now()
      if (!opts.forzar && ahora - lastRefetchRef.current < REFETCH_THROTTLE_MS) {
        return
      }
      refreshingRef.current = true
      if (!opts.silencioso) setRefreshing(true)
      try {
        const supabase = createClient()
        // reset (ej: cambio de filtro) vuelve a la primera página; si no, se
        // mantiene la ventana ya cargada por el usuario.
        const limit = opts.reset
          ? PAGE_SIZE
          : Math.max(comprobantes.length, PAGE_SIZE)
        let q = supabase
          .from('comprobantes_remoto')
          .select('*')
          .eq('empresa_id', empresa.empresa_id)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (filtroAutor === 'mios') q = q.eq('created_by', userId)
        const { data, error } = await q
        if (error) throw new Error(error.message)
        const rows = (data ?? []) as ComprobanteRemoto[]
        setComprobantes(rows)
        if (opts.reset) setHasMore(rows.length === PAGE_SIZE)
        lastRefetchRef.current = Date.now()
      } catch (err) {
        if (!opts.silencioso) {
          toast.error(
            err instanceof Error ? err.message : 'No se pudo actualizar',
          )
        }
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
      }
    },
    [comprobantes.length, empresa.empresa_id, filtroAutor, userId],
  )

  // ── Convertir items de la cola a la forma de ComprobanteRemoto para
  //    poder reutilizar la fila/badge/render de la lista. El `id` local
  //    arranca con "local-" para que el resto del código pueda distinguirlos
  //    si necesita; pero la fuente de verdad es `estado === 'en_cola'`.
  function colaItemAComprobante(item: ColaItem): ComprobanteRemoto {
    return {
      id: item.id,
      empresa_id: item.empresaId,
      plantilla_id: item.display.plantilla_id,
      contacto_id: item.display.contacto_id,
      fecha: item.display.fecha,
      moneda_codigo: item.display.moneda_codigo,
      monto_total: item.display.monto_total,
      descripcion: item.display.descripcion,
      cuenta_haber_override_id: item.display.cuenta_haber_override_id,
      cuenta_haber_override_nombre: item.display.cuenta_haber_override_nombre,
      cuenta_debe_libre_id: item.display.cuenta_debe_libre_id,
      cuenta_debe_libre_nombre: item.display.cuenta_debe_libre_nombre,
      cuenta_haber_libre_id: item.display.cuenta_haber_libre_id,
      cuenta_haber_libre_nombre: item.display.cuenta_haber_libre_nombre,
      contacto_nombre: item.display.contacto_nombre,
      tipo_comprobante_id: item.display.tipo_comprobante_id,
      tipo_comprobante_nombre: item.display.tipo_comprobante_nombre,
      numero_borrador: null,
      numero_oficial: null,
      estado: 'en_cola',
      asiento_id_local: null,
      motivo_rechazo: item.ultimoError,
      anulacion_solicitada_at: null,
      anulacion_motivo: null,
      anulacion_confirmada_at: null,
      nota_credito_asiento_id: null,
      created_by: item.userId,
      created_at: item.createdAt,
      impactado_at: null,
      row_updated_at: item.createdAt,
    }
  }

  // ── Cargar cola persistida al montar / cambiar empresa ───────────────────
  useEffect(() => {
    void (async () => {
      const items = await listarCola(empresa.empresa_id)
      setEnCola(items)
    })()
  }, [empresa.empresa_id])

  // ── Encolar un payload que no se pudo subir ahora ────────────────────────
  const encolar = useCallback(
    async (args: {
      tipo: ColaTipo
      rpc: ColaRpc
      payload: Record<string, unknown>
      display: ColaItemDisplay
    }) => {
      const item: ColaItem = {
        id: generarIdLocal(),
        empresaId: empresa.empresa_id,
        userId,
        tipo: args.tipo,
        rpc: args.rpc,
        payload: args.payload,
        createdAt: new Date().toISOString(),
        intentos: 0,
        ultimoError: null,
        display: args.display,
      }
      try {
        await agregarACola(item)
        setEnCola((prev) => [item, ...prev])
        return true
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `No se pudo guardar en cola: ${err.message}`
            : 'No se pudo guardar en cola',
        )
        return false
      }
    },
    [empresa.empresa_id, userId],
  )

  // ── Sincronizar la cola contra Supabase ──────────────────────────────────
  const sincronizarCola = useCallback(
    async (opts: { silencioso?: boolean } = {}) => {
      if (sincronizandoRef.current) return
      const pendientes = enColaRef.current
      if (pendientes.length === 0) return
      setSincronizando(true)
      const supabase = createClient()
      let okCount = 0
      let failCount = 0
      const updated: ColaItem[] = []
      for (const item of pendientes) {
        try {
          const { data, error } = await supabase.rpc(item.rpc, {
            p_row: item.payload,
          })
          if (error) throw new Error(error.message)
          const guardado = data as ComprobanteRemoto
          try { await eliminarDeCola(item.id) } catch { /* ignorar */ }
          setComprobantes((prev) => {
            // Evitar duplicar si refetch ya lo trajo
            if (prev.some((c) => c.id === guardado.id)) return prev
            return [guardado, ...prev]
          })
          okCount++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const next: ColaItem = {
            ...item,
            intentos: item.intentos + 1,
            ultimoError: msg,
          }
          try { await actualizarEnCola(next) } catch { /* ignorar */ }
          updated.push(next)
          failCount++
          // Si es error de red, no tiene sentido seguir intentando los demás
          if (esErrorDeRed(err)) {
            // mantener los restantes intactos
            const restantes = pendientes.slice(pendientes.indexOf(item) + 1)
            updated.push(...restantes)
            break
          }
        }
      }
      setEnCola((prev) => {
        // Reconstruir respetando lo que actualizamos arriba; los items que
        // se subieron ya no figuran en `updated`.
        const updMap = new Map(updated.map((x) => [x.id, x]))
        return prev
          .filter((x) => updMap.has(x.id))
          .map((x) => updMap.get(x.id)!)
      })
      setSincronizando(false)
      if (!opts.silencioso) {
        if (okCount > 0) {
          toast.success(
            okCount === 1
              ? '1 comprobante subido'
              : `${okCount} comprobantes subidos`,
          )
        }
        if (failCount > 0 && okCount === 0) {
          toast.error(
            failCount === 1
              ? 'No se pudo subir el comprobante en cola'
              : `No se pudieron subir ${failCount} comprobantes`,
          )
        }
      }
    },
    [],
  )

  // Auto-sincronizar al recuperar conexión
  useEffect(() => {
    function onOnline() {
      if (enColaRef.current.length > 0 && !sincronizandoRef.current) {
        void sincronizarCola({ silencioso: false })
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [sincronizarCola])

  // Al montar (o al cambiar el tab a "ultimos"), si hay cola y estamos online,
  // intentar un sync en background.
  useEffect(() => {
    if (loading) return
    if (!online) return
    if (enCola.length === 0) return
    if (sincronizando) return
    void sincronizarCola({ silencioso: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, online])

  // Refetch al cambiar a "Últimos"
  useEffect(() => {
    if (tab !== 'ultimos' || loading) return
    void refetchComprobantes({ silencioso: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loading])

  // Re-buscar (primera página) al cambiar el filtro míos/todos. Se saltea el
  // primer render porque el load inicial ya trae el subconjunto 'mios'.
  const filtroInicialRef = useRef(true)
  useEffect(() => {
    if (filtroInicialRef.current) {
      filtroInicialRef.current = false
      return
    }
    void refetchComprobantes({ forzar: true, reset: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroAutor])

  // Refetch al recuperar foco / volver a la pestaña del navegador
  useEffect(() => {
    if (loading) return
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void refetchComprobantes({ silencioso: true })
      }
    }
    function onFocus() {
      void refetchComprobantes({ silencioso: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [loading, refetchComprobantes])

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
      setContactoId('')
      setContactoLocked(false)
      return
    }
    if (!descripcionTocada) {
      setDescripcion(plantillaSeleccionada.descripcion_default ?? '')
    }

    // Si la plantilla tiene contacto asociado, pre-rellenar y bloquear.
    // Si es genérica, dejar el selector libre.
    if (plantillaSeleccionada.contacto_id) {
      setContactoId(plantillaSeleccionada.contacto_id)
      setContactoLocked(true)
    } else {
      setContactoId('')
      setContactoLocked(false)
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

  // Auto-sync de moneda: al elegir un Haber con moneda conocida (USD/UYU/etc),
  // alinear el selector de moneda para que coincida. Evita el caso de cargar un
  // gasto con tarjeta USD pero dejar la moneda en UYU (silenciosamente rompía
  // la conciliación de tarjetas y dejaba el monto descalibrado).
  useEffect(() => {
    if (!haberId) return
    const haberSel = haberOpciones.find((o) => o.id === haberId)
    const monedaHaber = haberSel?.moneda
    if (monedaHaber && (MONEDAS as readonly string[]).includes(monedaHaber) && monedaHaber !== moneda) {
      setMoneda(monedaHaber as Moneda)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haberId, haberOpciones])

  const plantillaPorId = useMemo(
    () => Object.fromEntries(plantillas.map((p) => [p.id, p.nombre])),
    [plantillas],
  )

  // Plantillas reordenadas: top por uso (desc) + resto en orden alfabético.
  // Si nunca se usó nada, top queda vacío y el selector se ve como antes.
  const plantillasOrdenadas = useMemo(() => {
    const top: PlantillaRemota[] = []
    const usadas = new Set<string>()
    const idsPorUso = Object.entries(plantillaUso)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
    for (const id of idsPorUso) {
      if (top.length >= TOP_PLANTILLAS) break
      const p = plantillas.find((x) => x.id === id)
      if (p) {
        top.push(p)
        usadas.add(p.id)
      }
    }
    const resto = plantillas.filter((p) => !usadas.has(p.id))
    return { top, resto }
  }, [plantillas, plantillaUso])
  const contactoPorId = useMemo(
    () =>
      Object.fromEntries(contactos.map((c) => [c.id, c.nombre_razon_social])),
    [contactos],
  )
  const cuentaPorId = useMemo(
    () => Object.fromEntries(cuentas.map((c) => [c.id, c])),
    [cuentas],
  )

  // Auto-sync de moneda en el form "Carga libre": al elegir cuenta del Haber con
  // moneda conocida, alinear el selector. Mismo motivo que en plantillas: evita
  // grabar el comprobante con moneda distinta a la de la cuenta de pago.
  useEffect(() => {
    if (!cuentaHaberGeneralId) return
    const monedaHaber = cuentaPorId[cuentaHaberGeneralId]?.moneda_codigo
    if (monedaHaber && (MONEDAS as readonly string[]).includes(monedaHaber) && monedaHaber !== monedaGeneral) {
      setMonedaGeneral(monedaHaber as Moneda)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentaHaberGeneralId, cuentaPorId])

  const stats = useMemo(() => {
    const pendientes = comprobantes.filter((c) => c.estado === 'pendiente').length
    const importados = comprobantes.filter((c) => c.estado === 'importado').length
    const rechazados = comprobantes.filter((c) => c.estado === 'rechazado').length
    const anulSolicitada = comprobantes.filter(
      (c) => c.estado === 'anulacion_solicitada',
    ).length
    const anulados = comprobantes.filter((c) => c.estado === 'anulado').length
    return {
      pendientes,
      importados,
      rechazados,
      anulSolicitada,
      anulados,
      enCola: enCola.length,
    }
  }, [comprobantes, enCola.length])

  // Lista combinada: en cola primero (más recientes que cualquier server),
  // luego los del servidor. Se la pasamos a ListaUltimos como un único array.
  const comprobantesUI = useMemo<ComprobanteRemoto[]>(
    () => [...enCola.map(colaItemAComprobante), ...comprobantes],
    // colaItemAComprobante es puro sobre su argumento, no necesita estar en deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enCola, comprobantes],
  )

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
    setContactoId('')
    setContactoLocked(false)
    setEditandoId(null)
  }

  function resetFormGeneral() {
    setFechaGeneral(hoyISO())
    setMontoGeneral('')
    setMonedaGeneral((empresa.moneda_base_codigo as Moneda) ?? 'UYU')
    setDescripcionGeneral('')
    setCuentaDebeGeneralId('')
    setCuentaHaberGeneralId('')
    setTipoComprobanteGeneralId('')
    setEditandoGeneralId(null)
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
    // Contacto: respetar lo que se guardó (puede ser override del default de
    // la plantilla, o cualquier valor si la plantilla era genérica).
    if (c.contacto_id) {
      setContactoId(c.contacto_id)
      // Si difiere del default de la plantilla, dejarlo desbloqueado para
      // que se vea que fue elegido manualmente.
      const pl = plantillas.find((p) => p.id === c.plantilla_id)
      setContactoLocked(!!pl?.contacto_id && pl.contacto_id === c.contacto_id)
    } else {
      setContactoId('')
      setContactoLocked(false)
    }
  }

  function precargarGeneral(c: ComprobanteRemoto) {
    setFechaGeneral(c.fecha)
    setMontoGeneral(formatMonto(c.monto_total))
    setMonedaGeneral((c.moneda_codigo as Moneda) ?? 'UYU')
    setDescripcionGeneral(c.descripcion ?? '')
    setCuentaDebeGeneralId(c.cuenta_debe_libre_id ?? '')
    setCuentaHaberGeneralId(c.cuenta_haber_libre_id ?? '')
    setTipoComprobanteGeneralId(c.tipo_comprobante_id ?? '')
  }

  function modificarPendiente(c: ComprobanteRemoto) {
    if (c.estado !== 'pendiente') return
    if (c.plantilla_id) {
      setEditandoId(c.id)
      precargarPlantilla(c)
      setTab('cargar')
    } else {
      setEditandoGeneralId(c.id)
      precargarGeneral(c)
      setTab('general')
    }
  }

  function duplicarComoNuevo(c: ComprobanteRemoto) {
    if (c.plantilla_id) {
      setEditandoId(null)
      precargarPlantilla(c)
      setFecha(hoyISO())
      setTab('cargar')
    } else {
      setEditandoGeneralId(null)
      precargarGeneral(c)
      setFechaGeneral(hoyISO())
      setTab('general')
    }
    toast.success('Datos cargados — revisá y guardá')
  }

  function cancelarEdicion() {
    resetForm()
  }

  async function eliminarPendiente(c: ComprobanteRemoto) {
    if (c.estado === 'en_cola') {
      const ok = window.confirm(
        '¿Eliminar este comprobante de la cola? Todavía no se subió al servidor.',
      )
      if (!ok) return
      try {
        await eliminarDeCola(c.id)
        setEnCola((prev) => prev.filter((x) => x.id !== c.id))
        toast.success('Eliminado de la cola')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se pudo eliminar de la cola')
      }
      return
    }
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

  async function reintentarEnCola(_c: ComprobanteRemoto) {
    if (!online) {
      toast.error('Sin conexión — no se puede sincronizar ahora')
      return
    }
    await sincronizarCola({ silencioso: false })
  }

  async function confirmarAnulacion(motivo: string) {
    if (!anulandoId) return
    if (!online) {
      toast.error('Sin conexión — la anulación se solicita al recuperar la red')
      return
    }
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

  async function guardarGeneral(e: React.FormEvent) {
    e.preventDefault()
    if (!cuentaDebeGeneralId || !cuentaHaberGeneralId) {
      toast.error('Elegí cuenta del Debe y del Haber')
      return
    }
    if (cuentaDebeGeneralId === cuentaHaberGeneralId) {
      toast.error('Debe y Haber no pueden ser la misma cuenta')
      return
    }
    const montoNum = evaluarMonto(montoGeneral)
    if (!isFinite(montoNum) || montoNum === 0) {
      toast.error('Monto inválido')
      return
    }
    const cuentaDebe = cuentaPorId[cuentaDebeGeneralId]
    const cuentaHaber = cuentaPorId[cuentaHaberGeneralId]
    if (!cuentaDebe || !cuentaHaber) {
      toast.error('Cuenta no encontrada')
      return
    }

    const tipoCompSel = tipoComprobanteGeneralId
      ? tiposComprobante.find((t) => t.id === tipoComprobanteGeneralId) ?? null
      : null

    const payload = {
      ...(editandoGeneralId ? { id: editandoGeneralId } : {}),
      empresa_id: empresa.empresa_id,
      fecha: fechaGeneral,
      moneda_codigo: monedaGeneral,
      monto_total: montoNum,
      descripcion: descripcionGeneral.trim() || null,
      cuenta_debe_libre_id: cuentaDebe.id,
      cuenta_debe_libre_nombre: cuentaDebe.nombre,
      cuenta_haber_libre_id: cuentaHaber.id,
      cuenta_haber_libre_nombre: cuentaHaber.nombre,
      contacto_id: null,
      contacto_nombre: null,
      tipo_comprobante_id: tipoCompSel?.id ?? null,
      tipo_comprobante_nombre: tipoCompSel
        ? `${tipoCompSel.abreviacion} - ${tipoCompSel.nombre}`
        : null,
    }

    const display: ColaItemDisplay = {
      fecha: fechaGeneral,
      moneda_codigo: monedaGeneral,
      monto_total: montoNum,
      descripcion: descripcionGeneral.trim() || null,
      plantilla_id: null,
      contacto_id: null,
      contacto_nombre: null,
      cuenta_debe_libre_id: cuentaDebe.id,
      cuenta_debe_libre_nombre: cuentaDebe.nombre,
      cuenta_haber_libre_id: cuentaHaber.id,
      cuenta_haber_libre_nombre: cuentaHaber.nombre,
      cuenta_haber_override_id: null,
      cuenta_haber_override_nombre: null,
      tipo_comprobante_id: tipoCompSel?.id ?? null,
      tipo_comprobante_nombre: tipoCompSel
        ? `${tipoCompSel.abreviacion} - ${tipoCompSel.nombre}`
        : null,
    }

    if (!online) {
      if (editandoGeneralId) {
        toast.error('Sin conexión — no se puede modificar un comprobante ya guardado')
        return
      }
      setBusyGeneral(true)
      try {
        const ok = await encolar({
          tipo: 'libre',
          rpc: 'upsert_comprobante_libre_web',
          payload,
          display,
        })
        if (ok) {
          toast.success('Guardado en cola · se subirá al recuperar la conexión', {
            duration: 4500,
          })
          resetFormGeneral()
        }
      } finally {
        setBusyGeneral(false)
      }
      return
    }

    setBusyGeneral(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc(
        'upsert_comprobante_libre_web',
        { p_row: payload },
      )
      if (error) throw new Error(error.message)
      const guardado = data as ComprobanteRemoto
      if (editandoGeneralId) {
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
      resetFormGeneral()
    } catch (err) {
      if (!editandoGeneralId && esErrorDeRed(err)) {
        const ok = await encolar({
          tipo: 'libre',
          rpc: 'upsert_comprobante_libre_web',
          payload,
          display,
        })
        if (ok) {
          toast.success('Sin red · guardado en cola para reintentar', {
            duration: 4500,
          })
          resetFormGeneral()
          return
        }
      }
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusyGeneral(false)
    }
  }

  function cancelarEdicionGeneral() {
    resetFormGeneral()
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!plantillaId) {
      toast.error('Elegí una plantilla')
      return
    }
    const montoNum = evaluarMonto(monto)
    if (!isFinite(montoNum) || montoNum === 0) {
      toast.error('Monto inválido')
      return
    }

    const defaultHaberId = plantillaSeleccionada?.cuenta_haber_id ?? null
    const haberElegido = haberOpciones.find((o) => o.id === haberId) ?? null
    const esOverride =
      !!haberElegido && !!defaultHaberId && haberElegido.id !== defaultHaberId

    const payload = {
      ...(editandoId ? { id: editandoId } : {}),
      empresa_id: empresa.empresa_id,
      plantilla_id: plantillaId,
      contacto_id: contactoId || null,
      fecha,
      moneda_codigo: moneda,
      monto_total: montoNum,
      descripcion: descripcion.trim() || null,
      cuenta_haber_override_id: esOverride ? haberElegido!.id : null,
      cuenta_haber_override_nombre: esOverride ? haberElegido!.nombre : null,
    }

    const display: ColaItemDisplay = {
      fecha,
      moneda_codigo: moneda,
      monto_total: montoNum,
      descripcion: descripcion.trim() || null,
      plantilla_id: plantillaId,
      contacto_id: contactoId || null,
      contacto_nombre:
        contactos.find((c) => c.id === contactoId)?.nombre_razon_social ?? null,
      cuenta_debe_libre_id: null,
      cuenta_debe_libre_nombre: null,
      cuenta_haber_libre_id: null,
      cuenta_haber_libre_nombre: null,
      cuenta_haber_override_id: esOverride ? haberElegido!.id : null,
      cuenta_haber_override_nombre: esOverride ? haberElegido!.nombre : null,
      tipo_comprobante_id: null,
      tipo_comprobante_nombre: null,
    }

    const persistirHaberPref = () => {
      if (haberElegido) {
        try {
          window.localStorage.setItem(
            HABER_PREF_KEY(userId, plantillaId),
            haberElegido.id,
          )
        } catch {
          // localStorage bloqueado — ignorar
        }
      }
    }

    // Solo cuenta como uso cuando es una carga nueva (no al editar pendientes).
    const registrarUsoPlantilla = () => {
      if (editandoId) return
      setPlantillaUso((prev) => {
        const next = { ...prev, [plantillaId]: (prev[plantillaId] ?? 0) + 1 }
        escribirPlantillaUso(userId, next)
        return next
      })
    }

    // Sin conexión: si es edición de un pendiente, no se puede; si es nueva
    // carga, la encolamos para subir cuando vuelva la red.
    if (!online) {
      if (editandoId) {
        toast.error('Sin conexión — no se puede modificar un comprobante ya guardado')
        return
      }
      setBusy(true)
      try {
        const ok = await encolar({
          tipo: 'plantilla',
          rpc: 'upsert_comprobante_web',
          payload,
          display,
        })
        if (ok) {
          persistirHaberPref()
          registrarUsoPlantilla()
          toast.success('Guardado en cola · se subirá al recuperar la conexión', {
            duration: 4500,
          })
          resetForm()
        }
      } finally {
        setBusy(false)
      }
      return
    }

    setBusy(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('upsert_comprobante_web', {
        p_row: payload,
      })
      if (error) throw new Error(error.message)
      const guardado = data as ComprobanteRemoto
      persistirHaberPref()
      registrarUsoPlantilla()
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
      // Si fue caída de red durante el request y no estamos editando,
      // encolamos en vez de perder la carga.
      if (!editandoId && esErrorDeRed(err)) {
        const ok = await encolar({
          tipo: 'plantilla',
          rpc: 'upsert_comprobante_web',
          payload,
          display,
        })
        if (ok) {
          persistirHaberPref()
          registrarUsoPlantilla()
          toast.success('Sin red · guardado en cola para reintentar', {
            duration: 4500,
          })
          resetForm()
          return
        }
      }
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
              aria-selected={tab === 'general'}
              onClick={() => setTab('general')}
            >
              General
            </button>
            <button
              className="tab"
              aria-selected={tab === 'ultimos'}
              onClick={() => setTab('ultimos')}
            >
              Últimos {comprobantesUI.length > 0 && `· ${comprobantesUI.length}`}
            </button>
          </div>
        </div>
      </div>

      <BannerCola
        online={online}
        enColaCount={enCola.length}
        sincronizando={sincronizando}
        onSincronizar={() => sincronizarCola({ silencioso: false })}
      />

      <main className="max-w-3xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
        {tab === 'general' ? (
          <FormularioGeneral
            fecha={fechaGeneral}
            setFecha={setFechaGeneral}
            moneda={monedaGeneral}
            setMoneda={setMonedaGeneral}
            monto={montoGeneral}
            setMonto={setMontoGeneral}
            descripcion={descripcionGeneral}
            setDescripcion={setDescripcionGeneral}
            cuentas={cuentas}
            cuentaDebeId={cuentaDebeGeneralId}
            setCuentaDebeId={setCuentaDebeGeneralId}
            cuentaHaberId={cuentaHaberGeneralId}
            setCuentaHaberId={setCuentaHaberGeneralId}
            busy={busyGeneral}
            onSubmit={guardarGeneral}
            tiposComprobante={tiposComprobante}
            tipoComprobanteId={tipoComprobanteGeneralId}
            setTipoComprobanteId={setTipoComprobanteGeneralId}
            editando={!!editandoGeneralId}
            onCancelarEdicion={cancelarEdicionGeneral}
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
              {plantillaSeleccionada && (() => {
                const haberSel = haberOpciones.find((o) => o.id === haberId)
                const msg = warningMoneda(moneda, [
                  { label: 'Debe', moneda: plantillaSeleccionada.cuenta_debe_moneda },
                  { label: 'Haber', moneda: haberSel?.moneda ?? plantillaSeleccionada.cuenta_haber_moneda },
                ])
                return msg ? (
                  <p className="mt-2 text-[11px] font-mono text-amber-deep">
                    {msg}
                  </p>
                ) : null
              })()}
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
                  {plantillasOrdenadas.top.length === 0 ? (
                    plantillas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.iva_porcentaje > 0 ? ` · IVA ${p.iva_porcentaje}%` : ''}
                      </option>
                    ))
                  ) : (
                    <>
                      <optgroup label="Más usadas">
                        {plantillasOrdenadas.top.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                            {p.iva_porcentaje > 0 ? ` · IVA ${p.iva_porcentaje}%` : ''}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Todas">
                        {plantillasOrdenadas.resto.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                            {p.iva_porcentaje > 0 ? ` · IVA ${p.iva_porcentaje}%` : ''}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  )}
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

              {/* Contacto — sólo si hay plantilla elegida. Si la plantilla tiene
                  contacto asociado, se pre-rellena y bloquea (con link "cambiar"
                  para esta carga puntual). Si la plantilla es genérica, selector
                  libre opcional. */}
              {plantillaSeleccionada && (
                <div>
                  <label htmlFor="contacto" className="label-mono block mb-2">
                    Contacto {contactoLocked ? '' : '(opcional)'}
                  </label>
                  {contactoLocked && contactoId ? (
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-line bg-paper-2">
                      <span className="text-[14px] text-ink-1 truncate">
                        {plantillaSeleccionada.contacto_nombre ??
                          contactos.find((c) => c.id === contactoId)?.nombre_razon_social ??
                          '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setContactoLocked(false)}
                        disabled={busy}
                        className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-1 transition-colors"
                      >
                        cambiar
                      </button>
                    </div>
                  ) : (
                    <>
                      <select
                        id="contacto"
                        className="field"
                        value={contactoId}
                        onChange={(e) => setContactoId(e.target.value)}
                        disabled={busy}
                      >
                        <option value="">— Sin contacto —</option>
                        {contactos
                          .filter((c) => c.tipo === 'proveedor' || c.tipo === 'otro')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre_razon_social}
                              {c.rut_ci ? ` · ${c.rut_ci}` : ''}
                            </option>
                          ))}
                      </select>
                      {plantillaSeleccionada.contacto_id && (
                        <button
                          type="button"
                          onClick={() => {
                            setContactoId(plantillaSeleccionada.contacto_id!)
                            setContactoLocked(true)
                          }}
                          disabled={busy}
                          className="mt-2 font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-1 transition-colors"
                        >
                          ← volver al contacto de la plantilla
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

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
                    inputMode="text"
                    className="font-mono text-[26px] font-medium bg-transparent border-0 outline-none w-full leading-none p-0"
                    placeholder="0,00"
                    value={monto}
                    onChange={(e) => setMonto(onMontoInput(e.target.value))}
                    onBlur={(e) => setMonto(normalizarMonto(e.target.value))}
                    disabled={busy}
                    required
                  />
                </div>
                <MontoPreview monto={monto} moneda={moneda} />
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
            comprobantes={comprobantesUI}
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
            onReintentar={reintentarEnCola}
            onActualizar={() => refetchComprobantes({ forzar: true })}
            refreshing={refreshing}
            sincronizando={sincronizando}
            filtroAutor={filtroAutor}
            onCambiarFiltro={setFiltroAutor}
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
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Vista previa del importe: muestra el resultado cuando se escribe una
// operación (suma, resta, etc.) o cuando el valor es negativo, y avisa si
// la expresión es inválida.
// ──────────────────────────────────────────────────────────────────────

function MontoPreview({ monto, moneda }: { monto: string; moneda: string }) {
  const texto = monto.trim()
  if (!texto) return null
  const n = evaluarMonto(monto)
  const esExpr = esExpresionMonto(monto)

  if (!isFinite(n)) {
    // Solo marcar error cuando claramente hay una operación a medio escribir.
    if (!esExpr) return null
    return (
      <p className="mt-1.5 font-mono text-[12px] text-status-no">
        Expresión inválida
      </p>
    )
  }

  // Mostrar el resultado cuando hay operación o cuando el número es negativo.
  if (!esExpr && n >= 0) return null

  return (
    <p className="mt-1.5 font-mono text-[12px] text-ink-3">
      = {simboloMoneda(moneda)} {formatMonto(n)}
    </p>
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
  onReintentar,
  onActualizar,
  refreshing,
  sincronizando,
  filtroAutor,
  onCambiarFiltro,
}: {
  comprobantes: ComprobanteRemoto[]
  stats: {
    pendientes: number
    importados: number
    rechazados: number
    anulSolicitada: number
    anulados: number
    enCola: number
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
  onReintentar: (c: ComprobanteRemoto) => void
  onActualizar: () => void
  refreshing: boolean
  sincronizando: boolean
  filtroAutor: 'mios' | 'todos'
  onCambiarFiltro: (f: 'mios' | 'todos') => void
}) {
  return (
    <div className="card p-6 lg:p-10">
      <div className="flex items-baseline justify-between gap-3 mb-5">
        <div>
          <p className="label-mono mb-2">Tu actividad</p>
          <h2 className="font-display text-3xl font-medium">
            Últimos {comprobantes.length}
          </h2>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {stats.enCola > 0 && (
            <span className="font-mono text-xs font-semibold" style={{ color: '#3d4a7a' }}>
              {sincronizando ? 'Sincronizando…' : `${stats.enCola} en cola`}
            </span>
          )}
          {stats.pendientes > 0 && (
            <span className="font-mono text-xs text-amber-deep font-semibold">
              {stats.pendientes} pendiente{stats.pendientes === 1 ? '' : 's'}
            </span>
          )}
          <button
            type="button"
            onClick={onActualizar}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-white hover:border-ink-3 hover:bg-paper-2 transition-colors font-mono text-[11px] uppercase tracking-wider text-ink-2 disabled:opacity-60 disabled:cursor-not-allowed"
            aria-label="Actualizar lista"
            title="Actualizar lista"
          >
            <RefreshCw
              size={12}
              strokeWidth={2.5}
              className={refreshing ? 'animate-spin' : ''}
            />
            Actualizar
          </button>
        </div>
      </div>

      {comprobantes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {stats.enCola > 0 && (
            <span className="badge badge-encola">En cola · {stats.enCola}</span>
          )}
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

      <div className="flex items-center gap-2.5 mb-4">
        <span className="label-mono">Ver</span>
        <div className="pill-group" role="group" aria-label="Filtrar por autor">
          <button
            type="button"
            className="pill"
            aria-pressed={filtroAutor === 'mios'}
            onClick={() => onCambiarFiltro('mios')}
            disabled={refreshing}
          >
            Míos
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={filtroAutor === 'todos'}
            onClick={() => onCambiarFiltro('todos')}
            disabled={refreshing}
          >
            Todos
          </button>
        </div>
      </div>

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
                onReintentar={onReintentar}
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
  onReintentar,
}: {
  c: ComprobanteRemoto
  plantillaNombre: string | null
  contactoNombre: string | null
  onModificar: (c: ComprobanteRemoto) => void
  onEliminar: (c: ComprobanteRemoto) => void
  onDuplicar: (c: ComprobanteRemoto) => void
  onSolicitarAnulacion: (c: ComprobanteRemoto) => void
  onReintentar: (c: ComprobanteRemoto) => void
}) {
  const tachado = c.estado === 'rechazado' || c.estado === 'anulado'
  const esGeneral = !c.plantilla_id
  const tituloPrincipal = esGeneral
    ? (c.cuenta_debe_libre_nombre ?? 'Carga general')
    : (plantillaNombre ?? '—')
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 px-2 py-3.5 rounded-lg hover:bg-paper-2 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-ink-3">
            {c.numero_borrador ?? '—'}
          </span>
          <EstadoBadge estado={c.estado} />
          {esGeneral && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 bg-paper-2 border border-line px-1.5 py-0.5 rounded">
              General
            </span>
          )}
        </div>
        <div className="font-display-tight text-base font-medium truncate">
          {tituloPrincipal}
        </div>
        {esGeneral && c.cuenta_haber_libre_nombre && (
          <div className="text-[12px] text-ink-3 truncate">
            Haber: {c.cuenta_haber_libre_nombre}
          </div>
        )}
        <div className="text-[13px] text-ink-2 mt-0.5">
          {contactoNombre ?? '—'} · {formatFecha(c.fecha)}
          {c.estado === 'rechazado' && c.motivo_rechazo && (
            <>
              {' · '}
              <span className="text-status-no">{c.motivo_rechazo}</span>
            </>
          )}
          {c.estado === 'en_cola' && c.motivo_rechazo && (
            <>
              {' · '}
              <span className="text-amber-deep">
                Reintento falló: {c.motivo_rechazo}
              </span>
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
          onReintentar={onReintentar}
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
  onReintentar,
}: {
  c: ComprobanteRemoto
  onModificar: (c: ComprobanteRemoto) => void
  onEliminar: (c: ComprobanteRemoto) => void
  onDuplicar: (c: ComprobanteRemoto) => void
  onSolicitarAnulacion: (c: ComprobanteRemoto) => void
  onReintentar: (c: ComprobanteRemoto) => void
}) {
  const acciones: {
    key: string
    label: string
    icon: React.ReactNode
    onClick: () => void
    variant?: 'danger' | 'default'
  }[] = []

  if (c.estado === 'en_cola') {
    acciones.push({
      key: 'retry',
      label: 'Reintentar',
      icon: <UploadCloud size={12} strokeWidth={2.5} />,
      onClick: () => onReintentar(c),
    })
    acciones.push({
      key: 'del-local',
      label: 'Eliminar',
      icon: <Trash2 size={12} strokeWidth={2.5} />,
      onClick: () => onEliminar(c),
      variant: 'danger',
    })
  } else if (c.estado === 'pendiente') {
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
    en_cola: { cls: 'badge-encola', label: 'En cola' },
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
// Banner de estado de conexión / cola offline
// ──────────────────────────────────────────────────────────────────────

function BannerCola({
  online,
  enColaCount,
  sincronizando,
  onSincronizar,
}: {
  online: boolean
  enColaCount: number
  sincronizando: boolean
  onSincronizar: () => void
}) {
  if (online && enColaCount === 0) return null

  if (!online) {
    return (
      <div
        className="border-b border-line"
        style={{ background: '#fff4e0' }}
        role="status"
        aria-live="polite"
      >
        <div className="max-w-3xl mx-auto px-5 md:px-8 py-2.5 flex items-center gap-2.5">
          <CloudOff size={14} strokeWidth={2.5} className="text-amber-deep shrink-0" />
          <span className="text-[13px] text-ink-1">
            <strong>Sin conexión.</strong>{' '}
            {enColaCount > 0 ? (
              <>
                Tenés {enColaCount} comprobante{enColaCount === 1 ? '' : 's'} en cola.
                Se subirá{enColaCount === 1 ? '' : 'n'} automáticamente al recuperar la red.
              </>
            ) : (
              <>Tus cargas quedarán en cola y se subirán cuando vuelva la red.</>
            )}
          </span>
        </div>
      </div>
    )
  }

  // Online con cola pendiente (ej: hubo errores que no eran de red)
  return (
    <div
      className="border-b border-line"
      style={{ background: '#eef1fb' }}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-3xl mx-auto px-5 md:px-8 py-2.5 flex items-center justify-between gap-3">
        <span className="text-[13px] text-ink-1 flex items-center gap-2.5 min-w-0">
          <UploadCloud size={14} strokeWidth={2.5} className="shrink-0" style={{ color: '#3d4a7a' }} />
          <span className="truncate">
            <strong>{enColaCount}</strong> en cola — pendiente{enColaCount === 1 ? '' : 's'} de subir
          </span>
        </span>
        <button
          type="button"
          onClick={onSincronizar}
          disabled={sincronizando}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line bg-white hover:border-ink-3 hover:bg-paper-2 transition-colors font-mono text-[11px] uppercase tracking-wider text-ink-2 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        >
          {sincronizando ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Sincronizando…
            </>
          ) : (
            <>
              <UploadCloud size={12} strokeWidth={2.5} />
              Sincronizar
            </>
          )}
        </button>
      </div>
    </div>
  )
}


// ──────────────────────────────────────────────────────────────────────
// Formulario General (sin plantilla, Debe + Haber elegidos con select
// nativo desde las cuentas habilitadas para carga web)
// ──────────────────────────────────────────────────────────────────────

function FormularioGeneral({
  fecha,
  setFecha,
  moneda,
  setMoneda,
  monto,
  setMonto,
  descripcion,
  setDescripcion,
  cuentas,
  cuentaDebeId,
  setCuentaDebeId,
  cuentaHaberId,
  setCuentaHaberId,
  busy,
  onSubmit,
  tiposComprobante,
  tipoComprobanteId,
  setTipoComprobanteId,
  editando,
  onCancelarEdicion,
}: {
  fecha: string
  setFecha: (s: string) => void
  moneda: Moneda
  setMoneda: (m: Moneda) => void
  monto: string
  setMonto: (s: string) => void
  descripcion: string
  setDescripcion: (s: string) => void
  cuentas: CuentaRemota[]
  cuentaDebeId: string
  setCuentaDebeId: (s: string) => void
  cuentaHaberId: string
  setCuentaHaberId: (s: string) => void
  busy: boolean
  onSubmit: (e: React.FormEvent) => void
  tiposComprobante: TipoComprobanteRemoto[]
  tipoComprobanteId: string
  setTipoComprobanteId: (s: string) => void
  editando: boolean
  onCancelarEdicion: () => void
}) {
  const cuentaDebe = cuentas.find((c) => c.id === cuentaDebeId) ?? null
  const cuentaHaber = cuentas.find((c) => c.id === cuentaHaberId) ?? null
  const cuentasDebe = cuentas.filter((c) => c.id !== cuentaHaberId)
  const cuentasHaber = cuentas.filter((c) => c.id !== cuentaDebeId)

  return (
    <form onSubmit={onSubmit} className="card p-6 lg:p-10 rise">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="label-mono mb-2">{editando ? 'Editando' : 'Carga general'}</p>
          <h2 className="font-display text-3xl md:text-4xl font-medium leading-tight">
            {editando ? (
              <>Modificá tu <Highlight thin>comprobante</Highlight></>
            ) : (
              <>Cargá tu <Highlight thin>comprobante</Highlight></>
            )}
          </h2>
          {!editando && (
            <p className="font-mono text-[11px] text-ink-3 mt-2 leading-relaxed">
              Elegí las cuentas del Debe y del Haber entre las habilitadas para
              carga web.
            </p>
          )}
        </div>
        {editando && (
          <button
            type="button"
            onClick={onCancelarEdicion}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line bg-white hover:border-ink-3 hover:bg-paper-2 transition-colors font-mono text-[11px] uppercase tracking-wider text-ink-2"
            aria-label="Cancelar edición"
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
        {(() => {
          const msg = warningMoneda(moneda, [
            { label: 'Debe', moneda: cuentaDebe?.moneda_codigo },
            { label: 'Haber', moneda: cuentaHaber?.moneda_codigo },
          ])
          return msg ? (
            <p className="mt-2 text-[11px] font-mono text-amber-deep">
              {msg}
            </p>
          ) : null
        })()}
      </div>

      <div className="space-y-7">
        {/* Fecha */}
        <div>
          <label htmlFor="fecha-general" className="label-mono block mb-2">
            Fecha *
          </label>
          <input
            id="fecha-general"
            type="date"
            className="field"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        {/* Comprobante */}
        <div>
          <label htmlFor="tipo-comp-general" className="label-mono block mb-2">
            Comprobante
          </label>
          <select
            id="tipo-comp-general"
            className="field"
            value={tipoComprobanteId}
            onChange={(e) => setTipoComprobanteId(e.target.value)}
            disabled={busy || tiposComprobante.length === 0}
          >
            <option value="">— Seleccionar tipo —</option>
            {tiposComprobante.map((t) => (
              <option key={t.id} value={t.id}>
                {t.abreviacion} - {t.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Importe */}
        <div>
          <label htmlFor="monto-general" className="label-mono block mb-2">
            Importe *
          </label>
          <div className="flex items-baseline gap-2 border-b-[1.5px] border-ink py-1.5">
            <span className="font-mono text-ink-3 text-lg">
              {simboloMoneda(moneda)}
            </span>
            <input
              id="monto-general"
              inputMode="text"
              className="font-mono text-[26px] font-medium bg-transparent border-0 outline-none w-full leading-none p-0"
              placeholder="0,00"
              value={monto}
              onChange={(e) => setMonto(onMontoInput(e.target.value))}
              onBlur={(e) => setMonto(normalizarMonto(e.target.value))}
              disabled={busy}
              required
            />
          </div>
          <MontoPreview monto={monto} moneda={moneda} />
        </div>

        {/* Cuenta (Debe) */}
        <div>
          <label htmlFor="cuenta-debe-general" className="label-mono block mb-2 inline-flex items-center gap-1.5">
            <ArrowDown size={14} strokeWidth={2.5} />
            Cuenta (Debe) *
          </label>
          <select
            id="cuenta-debe-general"
            className="field"
            value={cuentaDebeId}
            onChange={(e) => setCuentaDebeId(e.target.value)}
            disabled={busy || cuentas.length === 0}
            required
          >
            <option value="">— Elegir cuenta —</option>
            {cuentasDebe.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          {cuentas.length === 0 && (
            <p className="mt-2 text-[11px] font-mono text-ink-3">
              No hay cuentas habilitadas para carga web. El contador las marca en ContaSystem.
            </p>
          )}
        </div>

        {/* Paga con (Haber) */}
        <div>
          <label htmlFor="cuenta-haber-general" className="label-mono block mb-2 inline-flex items-center gap-1.5">
            <ArrowUp size={14} strokeWidth={2.5} />
            Paga con (Haber) *
          </label>
          <select
            id="cuenta-haber-general"
            className="field"
            value={cuentaHaberId}
            onChange={(e) => setCuentaHaberId(e.target.value)}
            disabled={busy || cuentas.length === 0}
            required
          >
            <option value="">— Elegir cuenta —</option>
            {cuentasHaber.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Detalle */}
        <div>
          <label htmlFor="descripcion-general" className="label-mono block mb-2">
            Detalle
          </label>
          <textarea
            id="descripcion-general"
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

