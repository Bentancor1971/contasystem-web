'use client'

/**
 * /configuracion/personas — Listado y búsqueda de socios.
 * Filtros: empresa, mes de cumpleaños, búsqueda por nombre/apellido.
 * Lee /api/admin/socios.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  Search,
  Users,
  Cake,
  Building2,
  Mail,
  MailX,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useApp } from '@/lib/app-context'
import { canSeeConfig } from '@/lib/roles'
import { formatFecha } from '@/lib/format'
import { esEstadoActivo } from '@/lib/birthday-template-store'

interface EmpresaItem {
  empresaId: string
  nombre: string
  slug: string | null
}

interface Socio {
  id: string
  nombre: string | null
  apellido: string | null
  mail: string | null
  fecha_nacimiento: string | null
  empresa_id: string | null
  estado_registro_nombre: string | null
}

interface Respuesta {
  empresas: EmpresaItem[]
  socios: Socio[]
  total: number
  limit: number
  estados: string[]
  tieneSinEstado: boolean
}

const ESTADO_NULL_SENTINEL = '__none__'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

/** Mes-día del cumpleaños (MM-DD) o null si la fecha es inválida. */
function mesDia(fecha: string | null): string | null {
  if (!fecha) return null
  const m = fecha.match(/^\d{4}-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : null
}

/** Nombre formateado: capitaliza palabras (la base puede venir en MAYÚSCULAS). */
function formatNombreCompleto(nombre: string | null, apellido: string | null): string {
  const partes = [apellido, nombre]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ')
  if (!partes) return 'Sin nombre'
  return partes
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export default function PersonasPage() {
  const router = useRouter()
  const { empresa, permisos } = useApp()

  const [data, setData] = useState<Respuesta | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterEmpresa, setFilterEmpresa] = useState<string>('')
  const [mes, setMes] = useState<string>('')
  const [estado, setEstado] = useState<string>('')
  const [q, setQ] = useState<string>('')
  const [qDebounced, setQDebounced] = useState<string>('')

  useEffect(() => {
    if (!canSeeConfig(permisos)) router.replace('/configuracion')
  }, [permisos, router])

  // Debounce de la búsqueda — 300ms.
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ empresa_id: empresa.empresa_id })
      if (filterEmpresa) params.set('filter_empresa', filterEmpresa)
      if (mes) params.set('mes', mes)
      if (estado) params.set('estado', estado)
      if (qDebounced) params.set('q', qDebounced)

      const res = await fetch(`/api/admin/socios?${params.toString()}`, {
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as
        | Respuesta
        | { error?: string }
      if (!res.ok) {
        toast.error((json as { error?: string }).error ?? `Error · ${res.status}`)
        return
      }
      setData(json as Respuesta)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [empresa.empresa_id, filterEmpresa, mes, estado, qDebounced])

  useEffect(() => {
    if (canSeeConfig(permisos)) void cargar()
  }, [cargar, permisos])

  // Orden client-side por mes-día (los sin fecha al final).
  const sociosOrdenados = useMemo(() => {
    if (!data) return []
    return [...data.socios].sort((a, b) => {
      const ma = mesDia(a.fecha_nacimiento)
      const mb = mesDia(b.fecha_nacimiento)
      if (ma && mb) return ma.localeCompare(mb)
      if (ma) return -1
      if (mb) return 1
      return 0
    })
  }, [data])

  const empresasIndex = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of data?.empresas ?? []) m.set(e.empresaId, e.nombre)
    return m
  }, [data])

  if (!canSeeConfig(permisos)) return null

  const truncado = !!data && data.total > data.socios.length
  const sinFiltrosResultados =
    !!data && data.socios.length === 0 && !loading

  return (
    <main className="max-w-4xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1.5 label-mono text-ink-2 hover:text-ink mb-5"
      >
        <ArrowLeft size={12} /> Configuración
      </Link>

      <div className="mb-7 rise">
        <p className="label-mono mb-2">Listado</p>
        <h1 className="font-display text-4xl font-medium leading-tight">
          Personas
        </h1>
        <p className="text-ink-2 mt-3 text-base max-w-xl">
          Socios cargados en el sistema. Filtrá por empresa, mes de
          cumpleaños o buscá por nombre.
        </p>
      </div>

      {/* Filtros */}
      <section className="card p-4 lg:p-5 mb-4 rise">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr] gap-3">
          <FiltroSelect
            label="Empresa"
            value={filterEmpresa}
            onChange={setFilterEmpresa}
            options={[
              { value: '', label: 'Todas' },
              ...(data?.empresas ?? []).map((e) => ({
                value: e.empresaId,
                label: e.nombre,
              })),
            ]}
          />
          <FiltroSelect
            label="Estado"
            value={estado}
            onChange={setEstado}
            options={[
              { value: '', label: 'Todos' },
              ...(data?.estados ?? []).map((e) => ({
                value: e,
                label: e,
              })),
              ...(data?.tieneSinEstado
                ? [{ value: ESTADO_NULL_SENTINEL, label: '(sin estado)' }]
                : []),
            ]}
          />
          <FiltroSelect
            label="Mes de cumpleaños"
            value={mes}
            onChange={setMes}
            options={[
              { value: '', label: 'Todos' },
              ...MESES.map((m, i) => ({
                value: String(i + 1),
                label: m,
              })),
            ]}
          />
          <FiltroBusqueda value={q} onChange={setQ} />
        </div>
      </section>

      {/* Resumen */}
      {data && (
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <span className="label-mono text-ink-2">
            {data.total === 0
              ? 'Sin resultados'
              : truncado
              ? `Mostrando ${data.socios.length} de ${data.total}`
              : `${data.total} ${data.total === 1 ? 'persona' : 'personas'}`}
          </span>
          {loading && <Loader2 size={14} className="animate-spin text-amber" />}
        </div>
      )}

      {/* Lista */}
      {data === null ? (
        <div className="py-16 flex justify-center">
          <Loader2 size={24} className="animate-spin text-amber" />
        </div>
      ) : sinFiltrosResultados ? (
        <div className="card p-10 text-center">
          <Users size={28} className="mx-auto text-ink-3 mb-3" />
          <p className="text-ink-2 text-sm">
            No se encontraron socios con esos filtros.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rise">
          {sociosOrdenados.map((s) => (
            <SocioCard
              key={s.id}
              socio={s}
              empresaNombre={
                s.empresa_id ? empresasIndex.get(s.empresa_id) ?? null : null
              }
              mostrarEmpresa={!filterEmpresa}
            />
          ))}
        </div>
      )}

      {truncado && (
        <p className="font-mono text-[11px] text-ink-3 text-center mt-4">
          Se muestran las primeras {data!.socios.length} coincidencias. Afiná
          los filtros para encontrar socios específicos.
        </p>
      )}
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────
// Subcomponentes
// ────────────────────────────────────────────────────────────────────

function FiltroSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="block">
      <span className="label-mono block mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-line rounded-lg px-3 py-2 text-[15px] bg-white outline-none focus:border-amber-deep"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function FiltroBusqueda({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <label className="block">
      <span className="label-mono block mb-1.5">Buscar por nombre</span>
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
        />
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nombre o apellido…"
          className="w-full border border-line rounded-lg pl-9 pr-3 py-2 text-[15px] bg-white outline-none focus:border-amber-deep"
        />
      </div>
    </label>
  )
}

function SocioCard({
  socio,
  empresaNombre,
  mostrarEmpresa,
}: {
  socio: Socio
  empresaNombre: string | null
  mostrarEmpresa: boolean
}) {
  const tieneMail = !!socio.mail?.trim()
  const estado = socio.estado_registro_nombre?.trim() ?? null
  return (
    <div className="card p-4 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-display-tight text-base font-medium">
          {formatNombreCompleto(socio.nombre, socio.apellido)}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-ink-2">
          {tieneMail ? (
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Mail size={12} className="text-ink-3 shrink-0" />
              <span className="truncate">{socio.mail}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              <MailX size={12} />
              <span className="text-xs italic">sin mail</span>
            </span>
          )}
          {socio.fecha_nacimiento && (
            <span className="inline-flex items-center gap-1.5">
              <Cake size={12} className="text-ink-3" />
              <span className="font-mono text-xs">
                {formatFecha(socio.fecha_nacimiento)}
              </span>
            </span>
          )}
          {mostrarEmpresa && empresaNombre && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={12} className="text-ink-3" />
              <span className="text-xs">{empresaNombre}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {estado && (
          <span
            className={`badge ${
              esEstadoActivo(estado) ? 'badge-imported' : 'badge-anulado'
            }`}
          >
            {estado}
          </span>
        )}
        {!tieneMail && (
          <span className="badge badge-pending">sin mail</span>
        )}
      </div>
    </div>
  )
}
