'use client'

/**
 * Resultado de un sorteo publicado (docs/supabase/69_sorteos.sql, repo desktop).
 *
 * Muestra titulares y suplentes con su número y "Nombre I." —la cédula nunca
 * sale— y ofrece la consulta por cédula para que cada uno sepa lo suyo. Abajo,
 * plegado, lo necesario para verificar el sorteo contra el acta: el hash de la
 * lista sellada y la semilla.
 */

import { useState } from 'react'
import { FileText, Gift, Loader2, Search, ShieldCheck } from 'lucide-react'
import type { ConsultaSorteoPublica, SorteoResultadoPublico } from '@/lib/eventos-types'

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} de ${MESES[m - 1]} de ${y}`
}

function textoConsulta(r: ConsultaSorteoPublica): { titulo: string; detalle: string; ok: boolean } {
  const num = r.numero_texto ? `Tu número, el ${r.numero_texto}, ` : 'Tu número '
  if (r.resultado === 'titular') {
    return { ok: true, titulo: '¡Resultaste sorteado!', detalle: `${num}salió en el lugar ${r.posicion}. La organización se va a comunicar con vos.` }
  }
  if (r.resultado === 'suplente') {
    return { ok: true, titulo: `Quedaste como suplente ${r.posicion}`, detalle: `${num}quedó en la lista de suplentes. Si se libera un cupo, la organización te avisa en ese orden.` }
  }
  if (r.resultado === 'ninguno') {
    return {
      ok: false,
      titulo: 'No resultaste sorteado',
      detalle: r.numero_texto
        ? `Tu número ${r.numero_texto} no salió entre los sorteados. ¡Gracias por participar!`
        : 'Esta cédula no figura entre los sorteados. ¡Gracias por participar!',
    }
  }
  return { ok: false, titulo: 'No figura entre los sorteados', detalle: 'No encontramos un registro al sorteo con esta cédula.' }
}

function Lista({ titulo, filas }: { titulo: string; filas: SorteoResultadoPublico['titulares'] }) {
  if (filas.length === 0) return null
  return (
    <div>
      <p className="label-mono mb-2">{titulo}</p>
      <ol className="space-y-1.5">
        {filas.map((f, i) => (
          <li key={f.orden} className="flex items-baseline gap-3 text-sm">
            <span className="w-6 shrink-0 text-right font-mono text-ink-3">{i + 1}.</span>
            <span className="font-mono font-semibold">{f.numero_texto}</span>
            <span className="text-ink-2">{f.nombre_publico}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ResultadoSorteo({ slug, sorteo }: { slug: string; sorteo: SorteoResultadoPublico }) {
  const [documento, setDocumento] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [respuesta, setRespuesta] = useState<ConsultaSorteoPublica | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function consultar() {
    if (!documento.trim() || consultando) return
    setConsultando(true)
    setError(null)
    setRespuesta(null)
    try {
      const res = await fetch(`/api/eventos/${slug}/sorteo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: documento.trim() }),
      })
      const data = await res.json()
      if (!res.ok) setError(typeof data?.error === 'string' ? data.error : 'No se pudo consultar.')
      else setRespuesta(data as ConsultaSorteoPublica)
    } catch {
      setError('Error de conexión')
    } finally {
      setConsultando(false)
    }
  }

  const desiertos = sorteo.cantidad_cupos - sorteo.titulares.length
  const r = respuesta ? textoConsulta(respuesta) : null

  return (
    <section className="card p-6 sm:p-8 mb-8 rise">
      <div className="flex items-start gap-3 mb-5">
        <Gift className="w-5 h-5 mt-1 shrink-0 text-amber-deep" />
        <div>
          <span className="label-mono">Resultado del sorteo</span>
          <h2 className="font-display text-2xl font-medium leading-tight mt-1">
            {sorteo.premio_descripcion || sorteo.nombre}
          </h2>
          <p className="font-mono text-xs text-ink-2 mt-1">
            Sorteado el {fechaLarga(sorteo.fecha)} entre {sorteo.cantidad_participantes} participante
            {sorteo.cantidad_participantes === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Lista titulo={sorteo.cantidad_cupos === 1 ? 'Sorteado' : 'Sorteados'} filas={sorteo.titulares} />
        <Lista titulo="Suplentes, en orden" filas={sorteo.suplentes} />
      </div>
      {desiertos > 0 && (
        <p className="text-sm text-ink-2 mt-3">
          {desiertos === 1 ? 'Un cupo quedó desierto' : `${desiertos} cupos quedaron desiertos`}: no hubo participantes suficientes.
        </p>
      )}

      {/* ¿Salí sorteado? */}
      <div className="border-t border-line mt-6 pt-5">
        <label htmlFor={`sorteo-doc-${sorteo.id}`} className="label-mono block mb-1">¿Participaste? Consultá con tu cédula</label>
        <div className="flex items-end gap-3">
          <input
            id={`sorteo-doc-${sorteo.id}`}
            inputMode="numeric"
            className="field"
            placeholder="1.234.567-2"
            value={documento}
            onChange={(e) => { setDocumento(e.target.value); setRespuesta(null); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); consultar() } }}
            disabled={consultando}
          />
          <button type="button" className="btn-primary shrink-0" onClick={consultar} disabled={consultando}>
            {consultando ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {consultando ? 'Buscando…' : 'Consultar'}
          </button>
        </div>
        {error && <p className="text-sm text-status-no mt-3">{error}</p>}
        {r && (
          <div className={`rounded-lg border px-4 py-3 mt-3 ${r.ok ? 'border-status-ok' : 'border-line'} bg-paper-2`}>
            <p className={`font-medium ${r.ok ? 'text-status-ok' : ''}`}>{r.titulo}</p>
            <p className="text-sm text-ink-2 mt-0.5">{r.detalle}</p>
          </div>
        )}
      </div>

      {sorteo.acta_url && (
        <a href={sorteo.acta_url} target="_blank" rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-ink-2 underline underline-offset-2 hover:text-ink">
          <FileText size={15} /> Descargar el acta del sorteo (PDF)
        </a>
      )}

      <details className="mt-5 text-xs text-ink-3">
        <summary className="cursor-pointer inline-flex items-center gap-1.5">
          <ShieldCheck size={13} /> Cómo verificar este sorteo
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            El sorteo se hizo por sistema. Primero se selló la lista de participantes y se calculó su hash; después se
            generó una semilla al azar. Cada número se ordenó por SHA-256 de &quot;semilla:número&quot;, de menor a mayor.
            Con la lista del acta y estos dos datos, cualquiera puede reproducir el resultado.
          </p>
          <p className="break-all font-mono">Hash de la lista: {sorteo.participantes_hash}</p>
          <p className="break-all font-mono">Semilla: {sorteo.semilla}</p>
        </div>
      </details>
    </section>
  )
}
