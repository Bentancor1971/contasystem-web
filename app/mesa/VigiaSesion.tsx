'use client'

/**
 * El cierre por inactividad del puesto (79_), del lado de la pantalla.
 *
 * Quien decide es la base: la sesión se cierra a los N minutos sin actividad,
 * con N de la elección, que la comisión cambia desde el desktop. Esto hace tres
 * cosas nada más:
 *
 *  · Avisa a la base que hay alguien: un toque o una tecla, como mucho uno
 *    cada 20 s. El refresco automático del padrón no cuenta, y por eso existe
 *    este latido aparte.
 *  · Pregunta cada 30 s cuándo vence, para enterarse si la comisión cambió los
 *    minutos o cerró la sesión, y muestra la cuenta regresiva el último minuto
 *    con un "Sigo acá".
 *  · Cuando la sesión terminó, tapa la pantalla y dice por qué.
 *
 * Sin 79_ en la base la ruta contesta `sin_control` y esto no hace nada.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { mensajeErrorMesa } from '@/lib/mesa-types'
import { Aviso } from './Marco'

/** Como mucho un latido por toque cada tanto: el operador toca la pantalla todo el tiempo. */
const TOQUE_MIN_MS = 20_000
const CONSULTA_MS = 30_000
/** La cuenta regresiva aparece el último minuto. */
const AVISO_ANTES_MS = 60_000

export function VigiaSesion() {
  /** Cuándo se cierra si nadie toca nada, en el reloj de ESTE dispositivo. */
  const [venceAt, setVenceAt] = useState<number | null>(null)
  /** La sesión terminó: el motivo de la base, o '' si no vino. */
  const [fin, setFin] = useState<string | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())

  const ultimoToque = useRef(0)
  /** false = sin 79_ o la sesión ya terminó: no se manda nada más. */
  const vigilando = useRef(true)
  const confirmando = useRef(false)

  const latir = useCallback(async (tocar: boolean) => {
    if (!vigilando.current) return
    if (tocar) ultimoToque.current = Date.now()
    try {
      const r = await fetch('/api/mesa/actividad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tocar }),
        cache: 'no-store',
      })
      if (r.status >= 500) return
      const d = (await r.json()) as Record<string, unknown>
      if (d.sin_control === true) {
        vigilando.current = false
        setVenceAt(null)
        return
      }
      if (d.ok === true) {
        // El vencimiento viene en el reloj del servidor: se corre por el
        // desfase del dispositivo, que en una tablet prestada puede ser de
        // minutos.
        const desfase = Date.now() - new Date(String(d.ahora)).getTime()
        const vence = new Date(String(d.vence_at)).getTime()
        if (!isNaN(vence)) setVenceAt(vence + (isNaN(desfase) ? 0 : desfase))
        return
      }
      if (d.error === 'sesion_invalida') {
        vigilando.current = false
        setFin(typeof d.motivo === 'string' ? d.motivo : '')
      }
    } catch {
      // Sin conexión: se vuelve a probar en la próxima consulta.
    } finally {
      confirmando.current = false
    }
  }, [])

  // Entrar a la pantalla es actividad.
  useEffect(() => {
    void latir(true)
  }, [latir])

  useEffect(() => {
    const uso = () => {
      if (Date.now() - ultimoToque.current >= TOQUE_MIN_MS) void latir(true)
    }
    window.addEventListener('pointerdown', uso, { passive: true })
    window.addEventListener('keydown', uso)
    const t = setInterval(() => void latir(false), CONSULTA_MS)
    return () => {
      window.removeEventListener('pointerdown', uso)
      window.removeEventListener('keydown', uso)
      clearInterval(t)
    }
  }, [latir])

  // El reloj de la cuenta regresiva. Al llegar a cero se le pregunta a la base
  // en vez de darla por cerrada: pudo haber actividad desde otro lado.
  useEffect(() => {
    if (venceAt === null || fin !== null) return
    const t = setInterval(() => {
      const n = Date.now()
      setAhora(n)
      if (n >= venceAt && !confirmando.current) {
        confirmando.current = true
        void latir(false)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [venceAt, fin, latir])

  if (fin !== null) {
    const m = mensajeErrorMesa({ error: 'sesion_invalida', motivo: fin || undefined })
    return (
      <div className="fixed inset-0 z-50 bg-paper overflow-auto">
        <div className="mx-auto w-full max-w-md px-4 sm:px-6 py-10">
          <Aviso titulo={m.titulo} detalle={m.detalle} tono="alto">
            <button
              type="button"
              className="btn-primary w-full mt-4"
              onClick={async () => {
                try {
                  await fetch('/api/mesa/salir', { method: 'POST', cache: 'no-store' })
                } catch {
                  // La cookie apunta a una sesión que ya no sirve: /mesa lo resuelve.
                }
                window.location.replace('/mesa')
              }}
            >
              Volver a entrar
            </button>
          </Aviso>
        </div>
      </div>
    )
  }

  const restante = venceAt === null ? null : venceAt - ahora
  if (restante === null || restante > AVISO_ANTES_MS || restante <= 0) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4" role="alert">
      <div className="voto-aviso voto-aviso--medio mx-auto max-w-xl flex items-center gap-3 shadow-lg">
        <p className="flex-1 text-[15px] leading-snug">
          Por inactividad, la sesión se cierra en <strong>{Math.ceil(restante / 1000)} s</strong>.
        </p>
        <button type="button" className="btn-primary shrink-0" onClick={() => void latir(true)}>
          Sigo acá
        </button>
      </div>
    </div>
  )
}
