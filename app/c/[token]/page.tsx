/**
 * /c/[token] — Validación PÚBLICA de un certificado (destino del QR).
 * Server Component: resuelve el certificado por token con service_role.
 */

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { CheckCircle2, XCircle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCertificado } from '@/lib/certificados'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Validación de certificado' }

function formatFechaLarga(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return iso
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return `${d} de ${meses[m - 1]} de ${y}`
}

export default async function CertificadoPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const admin = createAdminClient()
  const cert = await loadCertificado(admin, token)
  if (!cert) notFound()

  const valido = cert.estado === 'valido'
  const fechaEvento = formatFechaLarga(cert.evento_fecha)
  const emitido = formatFechaLarga(cert.emitido_at)

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rise">
        <div className="card p-8">
          {/* Estado */}
          <div className="flex flex-col items-center text-center mb-6">
            {valido ? (
              <>
                <CheckCircle2 className="text-status-ok mb-3" size={48} />
                <span className="label-mono text-status-ok">Certificado válido</span>
              </>
            ) : (
              <>
                <XCircle className="text-status-no mb-3" size={48} />
                <span className="label-mono text-status-no">Certificado anulado</span>
              </>
            )}
          </div>

          <div className="perforated mb-6" />

          <h1 className="font-display text-2xl font-medium leading-tight text-center mb-1">
            {cert.nombre_completo}
          </h1>
          {cert.categoria_nombre && (
            <p className="text-center text-ink-2 mb-6">{cert.categoria_nombre}</p>
          )}

          <dl className="font-mono text-sm space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-3">Evento</dt>
              <dd className="text-right font-medium">{cert.evento_nombre}</dd>
            </div>
            {fechaEvento && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Fecha</dt>
                <dd className="text-right">{fechaEvento}</dd>
              </div>
            )}
            {cert.evento_lugar && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Lugar</dt>
                <dd className="text-right">{cert.evento_lugar}</dd>
              </div>
            )}
            {cert.numero && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">N° inscripción</dt>
                <dd className="text-right">{cert.numero}</dd>
              </div>
            )}
            {emitido && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Emitido</dt>
                <dd className="text-right">{emitido}</dd>
              </div>
            )}
          </dl>
        </div>

        <p className="text-center font-mono text-[11px] text-ink-3 mt-6">
          CONTASYSTEM · VALIDACIÓN DE CERTIFICADO
        </p>
      </div>
    </main>
  )
}
