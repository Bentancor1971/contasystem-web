/**
 * Sonido y vibración del escáner.
 *
 * En la puerta no se mira la pantalla en cada persona: se apunta, suena, y se
 * pasa al siguiente. Por eso cada resultado tiene un sonido DISTINTO — un
 * 'ya_presente' que suene igual que un 'ok' es peor que no sonar.
 *
 * Se sintetiza con WebAudio en vez de servir archivos: son tres bips, no
 * justifica un fetch que puede fallar justo cuando no hay señal.
 */

type Ctor = typeof AudioContext

let ctx: AudioContext | null = null

/**
 * Hay que llamarla desde un gesto del usuario (el botón de activar la cámara):
 * iOS y Chrome crean el AudioContext suspendido y no lo dejan sonar hasta que
 * hubo una interacción real.
 */
export function desbloquearAudio(): void {
  try {
    if (!ctx) {
      const AC: Ctor | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
      if (!AC) return
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // Sin audio se sigue trabajando: la pantalla ya distingue los casos por color.
    ctx = null
  }
}

/** Un bip. `en` es el offset en segundos desde ahora. */
function bip(freq: number, dur: number, en = 0, vol = 0.22): void {
  if (!ctx) return
  const t0 = ctx.currentTime + en
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  // Ataque y caída cortos: sin esto se oye un "click" en cada extremo.
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012)
  gain.gain.setValueAtTime(vol, t0 + dur - 0.02)
  gain.gain.linearRampToValueAtTime(0, t0 + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function vibrar(patron: number | number[]): void {
  try {
    navigator.vibrate?.(patron)
  } catch {
    /* iOS no tiene vibrate; el sonido y el color alcanzan */
  }
}

/** Ingreso registrado: dos notas ascendentes, cortas y alegres. */
export function feedbackOk(): void {
  desbloquearAudio()
  bip(880, 0.09)
  bip(1320, 0.11, 0.1)
  vibrar(60)
}

/** Ya había ingresado: dos notas IGUALES, más graves. No se confunde con el ok. */
export function feedbackAviso(): void {
  desbloquearAudio()
  bip(620, 0.13)
  bip(620, 0.13, 0.19)
  vibrar([70, 70, 70])
}

/** Rechazo (anulada / no reconocida / otro evento): una nota grave y larga. */
export function feedbackError(): void {
  desbloquearAudio()
  bip(200, 0.42, 0, 0.26)
  vibrar(320)
}
