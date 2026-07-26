'use client'

/**
 * Resultado del escaneo, a pantalla completa.
 *
 * Se lee de pie, a un brazo de distancia y con mala luz: manda el color de
 * fondo y el nombre grande. El verde y el ámbar tienen que distinguirse de un
 * vistazo — un 'ya_presente' suele ser alguien intentando entrar dos veces con
 * el mismo QR, y confundirlo con un ingreso nuevo es el peor error posible acá.
 *
 * Se cierra tocando en cualquier lado, además del cierre automático que maneja
 * el padre: quien va rápido no espera al timer.
 */

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  RefreshCw,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { formatHoraUY } from '@/lib/format'
import type { EntradaRemota, ResultadoCheckin } from '@/lib/entradas-types'

interface Estilo {
  fondo: string
  texto: string
  Icono: typeof CheckCircle2
  titulo: string
}

function estiloDe(resultado: ResultadoCheckin, entrada: EntradaRemota | null): Estilo {
  switch (resultado) {
    case 'ok':
      return {
        fondo: 'bg-status-ok',
        texto: 'text-white',
        Icono: CheckCircle2,
        titulo: 'Ingreso registrado',
      }
    case 'ya_presente': {
      const hora = formatHoraUY(entrada?.asistio_at)
      return {
        fondo: 'bg-amber',
        texto: 'text-ink',
        Icono: Clock3,
        titulo: hora ? `Ya ingresó a las ${hora}` : 'Ya había ingresado',
      }
    }
    case 'anulada':
      return {
        fondo: 'bg-status-no',
        texto: 'text-white',
        Icono: XCircle,
        titulo: 'Inscripción anulada',
      }
    case 'otro_evento':
      return {
        fondo: 'bg-status-no',
        texto: 'text-white',
        Icono: AlertTriangle,
        titulo: 'Entrada de otro evento',
      }
    default:
      return {
        fondo: 'bg-status-no',
        texto: 'text-white',
        Icono: HelpCircle,
        titulo: 'QR no reconocido',
      }
  }
}

interface ResultadoOverlayProps {
  resultado: ResultadoCheckin
  entrada: EntradaRemota | null
  onCerrar: () => void
}

export function ResultadoOverlay({ resultado, entrada, onCerrar }: ResultadoOverlayProps) {
  const { fondo, texto, Icono, titulo } = estiloDe(resultado, entrada)
  const secundario = [entrada?.categoria_nombre, entrada?.rol_nombre]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      role="alert"
      onClick={onCerrar}
      className={`fixed inset-0 z-50 ${fondo} ${texto} flex flex-col items-center justify-center gap-5 px-7 text-center cursor-pointer select-none`}
    >
      <Icono size={80} strokeWidth={2.2} />

      <p className="font-mono text-sm uppercase tracking-[0.14em] opacity-90">{titulo}</p>

      {entrada ? (
        <>
          <p className="font-display text-[2.6rem] leading-[1.05] font-medium break-words max-w-full">
            {entrada.nombre_completo}
          </p>
          {secundario && <p className="text-lg opacity-90 -mt-2">{secundario}</p>}

          <div className="font-mono text-sm opacity-80 space-y-1">
            {entrada.documento && <p>Doc. {entrada.documento}</p>}
            {entrada.numero && <p>N° {entrada.numero}</p>}
            {resultado === 'otro_evento' && <p>{entrada.evento_nombre}</p>}
            {resultado === 'ya_presente' && entrada.asistio_por && (
              <p className="opacity-80">Marcó {entrada.asistio_por}</p>
            )}
          </div>
        </>
      ) : (
        <p className="text-lg opacity-90 max-w-xs leading-snug">
          El código no corresponde a ninguna entrada de este evento.
        </p>
      )}

      <p className="absolute bottom-8 font-mono text-xs uppercase tracking-[0.14em] opacity-70">
        Tocá para continuar
      </p>
    </div>
  )
}

interface ErrorOverlayProps {
  mensaje: string
  reintentando: boolean
  onReintentar: () => void
  onCerrar: () => void
}

/**
 * Falla de red al marcar.
 *
 * NO se auto-cierra ni se pinta de verde: un falso "listo" hace entrar a alguien
 * que nunca quedó registrado, y eso no se descubre hasta que el desktop baja los
 * escaneos y falta gente.
 */
export function ErrorOverlay({
  mensaje,
  reintentando,
  onReintentar,
  onCerrar,
}: ErrorOverlayProps) {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-50 bg-ink text-paper flex flex-col items-center justify-center gap-5 px-7 text-center"
    >
      <WifiOff size={72} className="text-amber" />
      <p className="font-mono text-sm uppercase tracking-[0.14em] text-amber">
        No se pudo registrar
      </p>
      <p className="text-lg leading-snug max-w-xs">{mensaje}</p>
      <p className="text-sm opacity-75 max-w-xs leading-snug">
        La asistencia NO quedó marcada. Reintentá antes de dejar pasar a la persona.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs mt-2">
        <button
          type="button"
          className="btn-primary w-full"
          onClick={onReintentar}
          disabled={reintentando}
        >
          <RefreshCw size={18} className={reintentando ? 'animate-spin' : undefined} />
          {reintentando ? 'Reintentando…' : 'Reintentar'}
        </button>
        <button type="button" className="btn-secondary w-full" onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
