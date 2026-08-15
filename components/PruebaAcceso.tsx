/**
 * La pantalla del token de prueba: qué respondió cada tramo del acceso.
 *
 * No es una pantalla para el socio —a esta URL sólo llega quien la abre desde el
 * mail de prueba que manda el desktop—, así que dice lo que un socio no
 * necesita: el nombre de la RPC, el mensaje de error crudo, la variable de
 * entorno que falta. Es lo que convierte "el link no anda" en algo accionable.
 *
 * Vive en `components/` y no dentro de una ruta porque la usan las dos: la de
 * votación y la de convocatorias. Lo único que cambia entre ellas es la etiqueta.
 *
 * Ver `lib/prueba-acceso.ts` para qué se prueba y qué no.
 */

import type { ModuloPrueba, ResultadoPrueba } from '@/lib/prueba-acceso'

const ETIQUETA: Record<ModuloPrueba, { seccion: string; pie: string; real: string }> = {
  votacion: {
    seccion: 'Votación',
    pie: 'CONTASYSTEM · VOTACIÓN · PRUEBA',
    real: 'la credencial de un votante',
  },
  convocatoria: {
    seccion: 'Convocatoria',
    pie: 'CONTASYSTEM · CONVOCATORIA · PRUEBA',
    real: 'el link personal de un invitado',
  },
}

function Paso({ ok, titulo, detalle }: { ok: boolean; titulo: string; detalle: string }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={`font-mono text-sm leading-7 shrink-0 ${ok ? 'text-status-ok' : 'text-status-no'}`}
      >
        {ok ? '✓' : '✕'}
      </span>
      <div className="min-w-0">
        <p className="font-medium leading-7">
          {titulo}
          <span className="sr-only">{ok ? ' — funciona' : ' — falla'}</span>
        </p>
        <p className="text-ink-2 text-[15px] leading-relaxed">{detalle}</p>
      </div>
    </li>
  )
}

export function PruebaAcceso({
  modulo,
  resultado,
}: {
  modulo: ModuloPrueba
  resultado: ResultadoPrueba
}) {
  const etiqueta = ETIQUETA[modulo]

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-5 sm:px-6 py-10 sm:py-14">
        <header className="rise mb-8">
          <span className="label-mono">{etiqueta.seccion} · prueba de acceso</span>
          <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] mt-3 mb-4">
            {resultado.ok ? 'El acceso funciona' : 'El acceso no está funcionando'}
          </h1>
          <p className="text-ink-2 text-[17px] leading-relaxed">
            Este link es de prueba y no pertenece a ninguna persona: no hay credencial que abrir
            ni voto que emitir. Sirve para ver, desde afuera, que el camino que recorre un link
            real llega hasta el final.
          </p>
          <div className="perforated mt-8" />
        </header>

        <div className="rise">
          <div
            className={`voto-aviso voto-aviso--${resultado.ok ? 'ok' : 'alto'} mb-8`}
            role="status"
          >
            <h2 className="font-display text-2xl font-medium leading-tight mb-2">
              {resultado.ok ? 'Todo respondió como tiene que responder' : 'Hay un tramo cortado'}
            </h2>
            <p className="text-ink-2 text-[17px] leading-relaxed">
              {resultado.ok
                ? `Un link real —${etiqueta.real}— recorre este mismo camino. Lo que falta ` +
                  'comprobar es la credencial en sí, y eso sólo lo dice abrirla.'
                : 'El detalle está abajo. Mientras siga así, un link real va a fallar por el ' +
                  'mismo motivo, aunque la persona lea otro mensaje.'}
            </p>
          </div>

          <section className="card p-6 mb-8" aria-labelledby="pasos-titulo">
            <h2 id="pasos-titulo" className="label-mono mb-4">
              Qué respondió cada tramo
            </h2>
            <ul className="space-y-4">
              {resultado.pasos.map((p) => (
                <Paso key={p.titulo} ok={p.ok} titulo={p.titulo} detalle={p.detalle} />
              ))}
            </ul>
          </section>

          {/* Sin esto la pantalla promete de más: alguien la ve en verde y da por
              probado el padrón, que es lo único que esta prueba no toca. */}
          <section className="card p-6" aria-labelledby="limite-titulo">
            <h2 id="limite-titulo" className="label-mono mb-3">
              Qué no prueba esto
            </h2>
            <p className="text-ink-2 text-[15px] leading-relaxed">
              Que {etiqueta.real} resuelva. La base contestó que este token no existe, que es la
              respuesta correcta para un token inventado, y eso no dice nada sobre el padrón ni
              sobre el segundo factor. Para comprobarlos hay que abrir un link real.
            </p>
          </section>
        </div>

        <footer className="font-mono text-[11px] text-ink-3 mt-14">{etiqueta.pie}</footer>
      </div>
    </main>
  )
}
