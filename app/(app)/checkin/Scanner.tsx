'use client'

/**
 * Visor de QR del escáner de asistencia.
 *
 * Sólo LEE: entrega el texto crudo del QR al padre y no sabe nada de tokens ni
 * de la API. El anti-rebote y el marcado viven en page.tsx.
 *
 * Dos motores de decodificación:
 *   1. `BarcodeDetector` — nativo (Chrome/Android). Decodifica sobre el propio
 *      <video>, sin copiar píxeles: es notoriamente más rápido y gasta menos
 *      batería.
 *   2. `jsQR` — fallback en todo lo demás, empezando por Safari/iOS, que no
 *      tiene BarcodeDetector. Se importa dinámicamente para que los ~40 KB no
 *      entren al bundle de quien no los necesita.
 *
 * La cámara exige contexto seguro: HTTPS o localhost. En HTTP no hay visor y se
 * dice explícitamente, porque el síntoma sin explicación (pantalla negra) manda
 * a cualquiera a buscar el problema donde no está.
 *
 * Por la misma razón se vigila la luminancia del frame: el obturador de
 * privacidad de muchas laptops (y una cámara tapada con cinta) no hace fallar
 * `getUserMedia` — el stream queda vivo y entrega negro o ruido de sensor. Sin
 * ese chequeo el visor se ve idéntico a uno que funciona pero no encuentra QR.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, EyeOff, Flashlight, Loader2, RefreshCw } from 'lucide-react'

/** Cada cuánto se intenta decodificar. ~8 lecturas/s alcanza y de sobra. */
const INTERVALO_MS = 120
/** Ancho al que se reduce el frame para jsQR: más que esto no mejora la lectura. */
const ANCHO_ANALISIS = 640

/** Cada cuánto se mide la luminancia. Es un problema estable: no urge detectarlo. */
const INTERVALO_LUZ_MS = 700
/** Lado del muestreo de luminancia. 32px de ancho alcanza y cuesta nada. */
const ANCHO_LUZ = 32
/**
 * Luminancia media (0-255) por debajo de la cual el frame no tiene imagen
 * aprovechable. Bien abajo a propósito: una puerta de noche mal iluminada da
 * ~30-50 y ahí el QR todavía se lee. El obturador cerrado da <5, y el ruido de
 * sensor con la ganancia al máximo ronda 8-10.
 */
const LUZ_MINIMA = 12
/**
 * Mediciones ciegas seguidas antes de avisar (~2s). El auto-exposición tarda
 * un momento en abrir al arrancar y sin esta espera el aviso parpadearía en
 * cada encendido.
 */
const MEDICIONES_CIEGAS = 3

interface CodigoDetectado {
  rawValue: string
}
interface DetectorLike {
  detect(source: CanvasImageSource): Promise<CodigoDetectado[]>
}
type DetectorCtor = new (opts?: { formats?: string[] }) => DetectorLike

type EstadoCamara = 'inactiva' | 'iniciando' | 'activa' | 'error'

interface ScannerProps {
  /** false = el visor sigue vivo pero no decodifica (hay un resultado en pantalla). */
  activo: boolean
  /**
   * Enciende sola al montar. El padre la pone en true recién DESPUÉS de un
   * encendido manual exitoso: para entonces el permiso ya está concedido y
   * volver de la lista a la cámara no cuesta un toque más.
   */
  autoIniciar?: boolean
  onDetectar: (raw: string) => void
  /** Se llama en el gesto de encendido, para desbloquear el audio. */
  onEncender?: () => void
}

export function Scanner({ activo, autoIniciar = false, onDetectar, onEncender }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Canvas propio del medidor de luz: es de 32px y no conviene mezclarlo. */
  const canvasLuzRef = useRef<HTMLCanvasElement | null>(null)
  const ultimaLuzRef = useRef(0)
  const ciegasRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectorRef = useRef<DetectorLike | null>(null)
  const jsqrRef = useRef<typeof import('jsqr').default | null>(null)
  const ultimoIntentoRef = useRef(0)
  const ocupadoRef = useRef(false)
  /** Falso entre el desmontaje y un getUserMedia que todavía no resolvió. */
  const montadoRef = useRef(false)
  /** Hubo un fallo al abrir: sólo se reintenta desde el botón, no solo. */
  const falloRef = useRef(false)

  // El loop lee estos refs en vez de cerrar sobre las props: así cambiar
  // `activo` no obliga a reiniciar la cámara (reiniciarla tarda ~1s y se
  // perderían lecturas entre persona y persona).
  const activoRef = useRef(activo)
  const onDetectarRef = useRef(onDetectar)
  const onEncenderRef = useRef(onEncender)
  /** Sólo se lee al montar (ver el efecto de ciclo de vida). */
  const autoIniciarRef = useRef(autoIniciar)
  useEffect(() => {
    activoRef.current = activo
  }, [activo])
  useEffect(() => {
    onDetectarRef.current = onDetectar
    onEncenderRef.current = onEncender
  }, [onDetectar, onEncender])

  const [estado, setEstado] = useState<EstadoCamara>('inactiva')
  const [error, setError] = useState<string>('')
  const [torchDisponible, setTorchDisponible] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  /** El stream vive pero los frames no traen imagen (obturador, cinta, oscuridad). */
  const [sinImagen, setSinImagen] = useState(false)

  const detener = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setTorchDisponible(false)
    setTorchOn(false)
    ciegasRef.current = 0
    setSinImagen(false)
  }, [])

  /**
   * Luminancia media del frame sobre una miniatura. Distingue "no hay QR
   * enfrente" de "la cámara no entrega imagen", que a ojo son el mismo
   * rectángulo negro. No decide nada sobre el escaneo: seguir intentando es
   * gratis y si el obturador se abre el visor se recupera solo.
   */
  const medirLuz = useCallback((video: HTMLVideoElement) => {
    if (!canvasLuzRef.current) canvasLuzRef.current = document.createElement('canvas')
    const canvas = canvasLuzRef.current
    const alto = Math.max(1, Math.round((ANCHO_LUZ * video.videoHeight) / video.videoWidth))
    if (canvas.width !== ANCHO_LUZ || canvas.height !== alto) {
      canvas.width = ANCHO_LUZ
      canvas.height = alto
    }
    const g = canvas.getContext('2d', { willReadFrequently: true })
    if (!g) return
    g.drawImage(video, 0, 0, ANCHO_LUZ, alto)
    const { data } = g.getImageData(0, 0, ANCHO_LUZ, alto)

    let suma = 0
    for (let i = 0; i < data.length; i += 4) {
      suma += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
    }
    const media = suma / (data.length / 4)

    if (media >= LUZ_MINIMA) {
      ciegasRef.current = 0
      setSinImagen(false)
      return
    }
    ciegasRef.current += 1
    if (ciegasRef.current >= MEDICIONES_CIEGAS) setSinImagen(true)
  }, [])

  /** Un frame: decodifica y avisa al padre si encontró algo. */
  const analizar = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth) return

    // Antes de decodificar, y a su propio ritmo: el camino nativo no pasa por
    // canvas, así que este es el único lugar por el que pasan los dos motores.
    const ahora = performance.now()
    if (ahora - ultimaLuzRef.current >= INTERVALO_LUZ_MS) {
      ultimaLuzRef.current = ahora
      medirLuz(video)
    }

    // Camino nativo.
    if (detectorRef.current) {
      const codigos = await detectorRef.current.detect(video)
      const raw = codigos[0]?.rawValue
      if (raw) onDetectarRef.current(raw)
      return
    }

    // Camino jsQR: hay que pasar por un canvas para tener los píxeles.
    const jsQR = jsqrRef.current
    if (!jsQR) return
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    const escala = Math.min(1, ANCHO_ANALISIS / video.videoWidth)
    const w = Math.round(video.videoWidth * escala)
    const h = Math.round(video.videoHeight * escala)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const g = canvas.getContext('2d', { willReadFrequently: true })
    if (!g) return
    g.drawImage(video, 0, 0, w, h)
    const img = g.getImageData(0, 0, w, h)
    const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
    if (res?.data) onDetectarRef.current(res.data)
  }, [medirLuz])

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop)
    if (!activoRef.current || ocupadoRef.current) return

    const ahora = performance.now()
    if (ahora - ultimoIntentoRef.current < INTERVALO_MS) return
    ultimoIntentoRef.current = ahora

    ocupadoRef.current = true
    void analizar()
      .catch(() => {
        /* un frame ilegible no es un error: se reintenta en el siguiente */
      })
      .finally(() => {
        ocupadoRef.current = false
      })
  }, [analizar])

  /**
   * Arranque real. Idempotente: si ya hay stream no hace nada, y un fallo previo
   * sólo se reintenta desde el botón (`manual`), para que el auto-encendido no
   * quede pidiendo la cámara en loop cuando el permiso está denegado.
   */
  const arrancar = useCallback(
    async (manual: boolean) => {
      if (streamRef.current) return
      if (falloRef.current && !manual) return

      onEncenderRef.current?.()
      falloRef.current = false
      setError('')
      setEstado('iniciando')
      // Reintentar después de destapar el lente tiene que empezar de cero.
      ciegasRef.current = 0
      ultimaLuzRef.current = 0
      setSinImagen(false)

      const fallar = (msg: string) => {
        falloRef.current = true
        setEstado('error')
        setError(msg)
      }

      if (typeof window !== 'undefined' && !window.isSecureContext) {
        fallar(
          'La cámara sólo funciona sobre HTTPS (o en localhost). Abrí esta pantalla con https:// y volvé a intentar.',
        )
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fallar('Este navegador no permite usar la cámara. Probá con Chrome o Safari actualizados.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        // El permiso puede resolverse después de desmontar (o entre el montaje
        // doble de StrictMode): sin esto quedaría la cámara prendida sin dueño.
        const video = videoRef.current
        if (!montadoRef.current || !video) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        video.srcObject = stream
        await video.play()

        // Linterna: en varios teléfonos es lo que hace la diferencia entre leer
        // y no leer un QR en una puerta de noche.
        const track = stream.getVideoTracks()[0]
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined
        setTorchDisponible(Boolean(caps?.torch))

        // Motor de decodificación: nativo si existe, jsQR si no.
        const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
        if (Ctor) {
          try {
            detectorRef.current = new Ctor({ formats: ['qr_code'] })
          } catch {
            detectorRef.current = null
          }
        }
        if (!detectorRef.current) {
          jsqrRef.current = (await import('jsqr')).default
        }

        setEstado('activa')
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(loop)
      } catch (err) {
        detener()
        const nombre = err instanceof DOMException ? err.name : ''
        if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
          fallar(
            'Permiso de cámara denegado. Habilitalo desde el candado de la barra de direcciones y reintentá. Mientras tanto podés usar el modo lista.',
          )
        } else if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
          fallar('No se encontró ninguna cámara disponible en este dispositivo.')
        } else {
          fallar(err instanceof Error ? err.message : 'No se pudo abrir la cámara.')
        }
      }
    },
    [detener, loop],
  )

  /**
   * Serializa los arranques en una cadena: si dos disparos se pisan (el montaje
   * doble de StrictMode, o un toque impaciente sobre "Reintentar"), el segundo
   * corre recién cuando el primero terminó y ahí ve el estado real.
   */
  const cadenaRef = useRef<Promise<void>>(Promise.resolve())
  const encender = useCallback(
    (manual = false) => {
      cadenaRef.current = cadenaRef.current.then(() => arrancar(manual)).catch(() => {})
      return cadenaRef.current
    },
    [arrancar],
  )

  const alternarTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const siguiente = !torchOn
    try {
      await track.applyConstraints({
        advanced: [{ torch: siguiente } as unknown as MediaTrackConstraintSet],
      })
      setTorchOn(siguiente)
    } catch {
      setTorchDisponible(false)
    }
  }, [torchOn])

  // Ciclo de vida en un solo efecto: enciende sola al montar si el padre ya vio
  // un encendido exitoso, y apaga al desmontar. `arrancar` es idempotente, así
  // que el montaje doble de StrictMode no deja la cámara colgada ni duplicada.
  //
  // Deps vacías a propósito: esto es montaje/desmontaje. Si `autoIniciar`
  // estuviera acá, pasar a true justo después del encendido manual apagaría y
  // volvería a abrir la cámara — un parpadeo de un segundo en plena puerta.
  useEffect(() => {
    montadoRef.current = true
    if (autoIniciarRef.current) void encender()
    return () => {
      montadoRef.current = false
      detener()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative w-full aspect-[3/4] max-h-[62vh] bg-ink rounded-xl overflow-hidden border border-line">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        // iOS ignora el stream si el video no está en línea y silenciado.
        autoPlay
      />

      {/* Mira: ayuda a encuadrar sin tapar el centro */}
      {estado === 'activa' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-[62%] aspect-square relative">
            {['top-0 left-0 border-t-4 border-l-4', 'top-0 right-0 border-t-4 border-r-4',
              'bottom-0 left-0 border-b-4 border-l-4', 'bottom-0 right-0 border-b-4 border-r-4',
            ].map((pos) => (
              <span
                key={pos}
                className={`absolute w-8 h-8 border-amber rounded-[3px] ${pos}`}
              />
            ))}
          </div>
        </div>
      )}

      {/*
        Aviso de frame ciego. Banda arriba y no overlay completo: el visor tiene
        que seguir viéndose para notar la recuperación en cuanto se destape el
        lente, y el botón de linterna queda accesible abajo.
      */}
      {estado === 'activa' && sinImagen && (
        <div className="absolute inset-x-0 top-0 px-3 py-2.5 bg-ink/85 backdrop-blur-sm border-b border-amber/40">
          <p className="flex items-start gap-2 text-[12px] leading-snug text-paper text-left">
            <EyeOff size={16} className="shrink-0 mt-0.5 text-amber" />
            <span>
              La cámara está prendida pero no llega imagen. Revisá el obturador de privacidad
              (la tapita sobre la pantalla o la tecla con ícono de cámara) y la luz del lugar.
              {torchDisponible && ' Probá la linterna.'} Mientras tanto podés usar el modo
              lista.
            </span>
          </p>
        </div>
      )}

      {/* Linterna */}
      {estado === 'activa' && torchDisponible && (
        <button
          type="button"
          onClick={() => void alternarTorch()}
          aria-pressed={torchOn}
          className={`absolute bottom-3 right-3 p-3 rounded-full border-2 transition-colors ${
            torchOn
              ? 'bg-amber text-ink border-ink'
              : 'bg-ink/60 text-paper border-paper/40'
          }`}
          aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
        >
          <Flashlight size={20} />
        </button>
      )}

      {/* Estados que tapan el visor */}
      {estado !== 'activa' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center bg-ink">
          {estado === 'inactiva' && (
            <>
              <Camera className="text-paper/70" size={40} />
              <p className="text-paper/80 text-sm leading-snug">
                Activá la cámara para empezar a escanear.
              </p>
              <button type="button" className="btn-primary" onClick={() => void encender(true)}>
                <Camera size={18} />
                Activar cámara
              </button>
            </>
          )}

          {estado === 'iniciando' && (
            <>
              <Loader2 className="animate-spin text-amber" size={32} />
              <p className="text-paper/80 text-sm">Abriendo la cámara…</p>
            </>
          )}

          {estado === 'error' && (
            <>
              <CameraOff className="text-status-no" size={40} />
              <p className="text-paper/90 text-sm leading-snug max-w-xs">{error}</p>
              <button type="button" className="btn-secondary" onClick={() => void encender(true)}>
                <RefreshCw size={16} />
                Reintentar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
