/**
 * /a/[token] — Vista PÚBLICA de una entrada a un evento (destino del QR).
 *
 * ⚠️ Esta pantalla NO marca asistencia, y no debe hacerlo nunca. La marca la
 * hace personal del evento desde /checkin, autenticado. Si bastara con abrir el
 * link, cualquiera se autoregistraría desde su casa — y un preview de link de
 * WhatsApp o Gmail lo dispararía solo, sin que nadie tocara nada.
 *
 * Server Component: resuelve la entrada por token con service_role (la tabla no
 * está expuesta a `anon`) vía el RPC `buscar_entrada`, que es de sólo lectura.
 *
 * El prefijo es /a/ y no /e/ porque /e/{slug} ya es la inscripción pública.
 */

import type { Metadata } from 'next'
import { CheckCircle2, Clock3, XCircle, HelpCircle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarEntrada } from '@/lib/entradas'
import { extraerToken } from '@/lib/checkin-token'
import { formatFechaHoraUY } from '@/lib/format'
import { origenPublicoDesdeHeaders, qrSvg } from '@/lib/qr'
import type { EntradaRemota, ResultadoEntrada } from '@/lib/entradas-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Entrada',
  // El QR se comparte por mail y WhatsApp: que no lo indexe nadie.
  robots: { index: false, follow: false },
}

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

interface Presentacion {
  Icono: typeof CheckCircle2
  color: string
  titulo: string
  detalle: string
}

function presentar(resultado: ResultadoEntrada, entrada: EntradaRemota | null): Presentacion {
  switch (resultado) {
    case 'valida':
      return {
        Icono: CheckCircle2,
        color: 'text-status-ok',
        titulo: 'Entrada válida',
        detalle: 'Mostrá este código en la entrada del evento.',
      }
    case 'ya_presente': {
      const hora = formatFechaHoraUY(entrada?.asistio_at)
      return {
        Icono: Clock3,
        color: 'text-status-pending',
        titulo: 'Ya registrada',
        detalle: hora
          ? `El ingreso quedó registrado el ${hora} h.`
          : 'El ingreso ya quedó registrado.',
      }
    }
    case 'anulada':
      return {
        Icono: XCircle,
        color: 'text-status-no',
        titulo: 'Inscripción anulada',
        detalle: 'Esta entrada fue dada de baja. Consultá con la organización.',
      }
    default:
      return {
        Icono: HelpCircle,
        color: 'text-status-no',
        titulo: 'Entrada no reconocida',
        detalle: 'El código no corresponde a ninguna entrada emitida.',
      }
  }
}

export default async function EntradaPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token: tokenCrudo } = await params

  // Mismo saneo que usa el escáner: un token con forma imposible ni siquiera
  // llega a la base.
  const token = extraerToken(tokenCrudo)

  const { resultado, entrada } = token
    ? await buscarEntrada(createAdminClient(), token)
    : { resultado: 'no_encontrada' as ResultadoEntrada, entrada: undefined }

  const e = entrada ?? null
  const { Icono, color, titulo, detalle } = presentar(resultado, e)

  const fechaEvento = formatFechaLarga(e?.evento_fecha ?? null)

  // Re-dibujamos el QR sobre la URL canónica: sirve de respaldo para quien
  // abrió el link pero no tiene a mano la imagen del mail.
  const origen = await origenPublicoDesdeHeaders()
  const svg =
    e && resultado !== 'no_encontrada'
      ? await qrSvg(origen ? `${origen}/a/${e.token}` : e.token)
      : null

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rise">
        <div className="card p-8">
          {/* Estado */}
          <div className="flex flex-col items-center text-center mb-6">
            <Icono className={`${color} mb-3`} size={48} />
            <span className={`label-mono ${color}`}>{titulo}</span>
            <p className="text-sm text-ink-2 mt-2 leading-snug">{detalle}</p>
          </div>

          {e && (
            <>
              <div className="perforated mb-6" />

              <h1 className="font-display text-2xl font-medium leading-tight text-center mb-1">
                {e.nombre_completo}
              </h1>
              {(e.categoria_nombre || e.rol_nombre) && (
                <p className="text-center text-ink-2 mb-6">
                  {[e.categoria_nombre, e.rol_nombre].filter(Boolean).join(' · ')}
                </p>
              )}

              <dl className="font-mono text-sm space-y-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-3">Evento</dt>
                  <dd className="text-right font-medium">{e.evento_nombre}</dd>
                </div>
                {fechaEvento && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-3">Fecha</dt>
                    <dd className="text-right">{fechaEvento}</dd>
                  </div>
                )}
                {e.evento_lugar && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-3">Lugar</dt>
                    <dd className="text-right">{e.evento_lugar}</dd>
                  </div>
                )}
                {e.documento && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-3">Documento</dt>
                    <dd className="text-right">{e.documento}</dd>
                  </div>
                )}
                {e.numero && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-3">N°</dt>
                    <dd className="text-right">{e.numero}</dd>
                  </div>
                )}
              </dl>

              {svg && (
                <>
                  <div className="perforated my-6" />
                  <div
                    className="qr-box mx-auto"
                    aria-label="Código QR de la entrada"
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                </>
              )}
            </>
          )}
        </div>

        <p className="text-center text-[12px] text-ink-3 mt-5 leading-relaxed px-4">
          Abrir esta página no registra tu ingreso: la asistencia la marca el
          personal del evento al escanear el código.
        </p>

        <p className="text-center font-mono text-[11px] text-ink-3 mt-4">
          CONTASYSTEM · ENTRADA
        </p>
      </div>
    </main>
  )
}
