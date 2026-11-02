/**
 * `/mesa/ayuda` — cómo se usa la mesa, para quien la atiende.
 *
 * Versión corta del procedimiento del desktop (docs/procedimientos/mesa-del-local.md):
 * sólo lo que hacen el operador y el presidente en el local. Lo de la comisión
 * (crear mesas, llaves, horarios) queda en el manual del sistema.
 *
 * No pide sesión: se abre desde el login antes de entrar. Si hay sesión, el
 * "volver" lleva al padrón en vez de al login.
 */

import { leerInfoMesa } from '@/lib/mesa-sesion'
import { Marco } from '../Marco'
import { BotonPdf } from './BotonPdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Cómo se usa la mesa' }

function Paso({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-2 py-2">
      <span className="font-mono text-sm text-ink-3 pt-0.5">{n}</span>
      <div className="text-[16px] leading-relaxed text-ink-2 min-w-0">{children}</div>
    </li>
  )
}

/** Un botón tal como se ve en la pantalla, para nombrarlo sin ambigüedad. */
function Boton({ children, sec = false }: { children: React.ReactNode; sec?: boolean }) {
  return (
    <span
      className={`inline-block align-baseline whitespace-nowrap rounded-md border-[1.5px] border-ink px-2 text-[14px] font-semibold text-ink ${
        sec ? 'bg-paper' : 'bg-amber'
      }`}
    >
      {children}
    </span>
  )
}

function Seccion({
  titulo,
  quien,
  children,
}: {
  titulo: string
  quien?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-line pt-7 mt-7">
      {quien && <span className="label-mono">{quien}</span>}
      <h2 className="font-display text-2xl font-medium leading-tight mt-1 mb-3">{titulo}</h2>
      {children}
    </section>
  )
}

export default async function AyudaMesaPage() {
  const info = await leerInfoMesa()
  const volver = info ? { href: '/mesa/padron', texto: 'Volver al padrón' } : { href: '/mesa', texto: 'Ir a entrar' }

  return (
    <Marco ancho="xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="label-mono">Mesa de votación</span>
          <h1 className="font-display text-3xl sm:text-4xl font-medium leading-[1.05] mt-2">
            Cómo se usa la mesa
          </h1>
        </div>
        <div className="flex items-center gap-1 shrink-0 print:hidden">
          <BotonPdf className="btn-ghost text-sm" />
          <a href={volver.href} className="btn-ghost text-sm">
            {volver.texto}
          </a>
        </div>
      </header>
      <p className="text-ink-2 text-[16px] leading-relaxed mt-4">
        El voto es en papel. Esta pantalla sirve para una sola cosa: dejar constancia de{' '}
        <strong>quién votó</strong>, nunca de qué votó.
      </p>

      <Seccion titulo="Entrar">
        <ol>
          <Paso n="1">
            Escribí el <strong>código de la mesa</strong> tal como figura en el papel (no importan
            mayúsculas, espacios ni guiones) y tu <strong>PIN</strong>. Tocá <Boton>Entrar</Boton>.
          </Paso>
          <Paso n="2">
            Confirmá arriba el <strong>nombre de la mesa</strong> y la <strong>sede</strong>. Si entraste
            con el PIN de presidente, al lado dice <span className="badge badge-imported">presidente</span>.
          </Paso>
          <Paso n="3">
            Si dice <em>«La mesa abre a las …»</em>, todavía no se puede registrar a nadie: revisá el
            padrón y prepará la urna. Antes de la primera persona, mostrá la urna vacía.
          </Paso>
        </ol>
        <p className="text-ink-3 text-sm mt-2">
          Cada PIN se usa en un solo dispositivo a la vez. Si el tuyo está abierto en otro lado, la
          pantalla no te deja entrar: pedile a la comisión que cierre esa sesión.
        </p>
      </Seccion>

      <Seccion titulo="Por cada persona que llega">
        <ol>
          <Paso n="1">Pedí el <strong>documento</strong>.</Paso>
          <Paso n="2">
            Buscá con al menos dos letras del apellido o dos dígitos de la cédula. Con los últimos
            cuatro o cinco dígitos alcanza; sin tildes ni puntos.
          </Paso>
          <Paso n="3">Mirá la ficha que aparece:</Paso>
        </ol>

        <ul className="grid gap-2 my-3">
          <li className="card p-4">
            <p className="font-medium">Tiene el botón <Boton>Registrar que votó</Boton></p>
            <p className="text-ink-2 text-sm mt-1">Está habilitada y no votó. Seguí con el paso 4.</p>
          </li>
          <li className="card p-4">
            <p className="font-medium">
              Dice <span className="badge badge-imported">votó</span>
            </p>
            <p className="text-ink-2 text-sm mt-1">
              Ya votó, por internet o en otra mesa. <strong>No puede volver a votar.</strong> Decile
              dónde y a qué hora figura su voto.
            </p>
          </li>
          <li className="card p-4">
            <p className="font-medium">
              Dice <span className="badge badge-rejected">no habilitada</span>
            </p>
            <p className="text-ink-2 text-sm mt-1">
              No se le entrega boleta. Debajo está el motivo: derivala a la comisión.
            </p>
          </li>
        </ul>

        <ol>
          <Paso n="4">
            Compará <strong>nombre y cédula</strong> con el documento, porque hay homónimos. Tocá{' '}
            <Boton>Registrar que votó</Boton> y, después de verificar otra vez, <Boton>Sí, votó</Boton>.
          </Paso>
          <Paso n="5">Entregale el <strong>sobre y la boleta</strong>.</Paso>
        </ol>

        <div className="grid gap-3 mt-4">
          <div className="voto-aviso voto-aviso--medio">
            <p className="font-medium">Si no aparece</p>
            <p className="text-ink-2 text-sm mt-1">
              Probá sólo con el apellido o con los últimos dígitos de la cédula. Si sigue sin aparecer,
              no es de esta mesa: derivala a la comisión.
            </p>
          </div>
          <div className="voto-aviso voto-aviso--medio">
            <p className="font-medium">Si marcaste a la persona equivocada</p>
            <p className="text-ink-2 text-sm mt-1">
              Tocá <Boton sec>Deshacer</Boton> sobre su ficha y escribí el motivo. Es sólo para el error
              de tipeo: si el sobre ya entró a la urna, avisá a la comisión.
            </p>
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Si dejás de usar la pantalla">
        <p className="text-ink-2 text-[16px] leading-relaxed">
          Después de unos minutos sin tocarla, la sesión se cierra sola. El último minuto aparece un
          aviso abajo: tocá <Boton>Sigo acá</Boton> para seguir. Si se cerró, tocá{' '}
          <Boton>Volver a entrar</Boton> con el mismo código y PIN; lo que marcaste está guardado.
        </p>
        <p className="text-ink-2 text-[16px] leading-relaxed mt-3">
          Si dejás el dispositivo, tocá <Boton sec>Salir</Boton> arriba a la derecha.
        </p>
      </Seccion>

      <Seccion titulo="Cerrar la urna" quien="Sólo presidente">
        <ol>
          <Paso n="1">
            Entrá con el <strong>PIN de presidente</strong>. Si estabas en el dispositivo del operador,
            tocá <Boton sec>Salir</Boton> y volvé a entrar con el tuyo.
          </Paso>
          <Paso n="2">
            A la hora de cierre, tocá <Boton sec>Cerrar urna</Boton> arriba a la derecha del padrón.
          </Paso>
          <Paso n="3">
            Contá los sobres sin abrirlos y escribí el número en <strong>Sobres contados en la urna</strong>.
          </Paso>
          <Paso n="4">
            Contá papeleta por papeleta los votos de cada lista, los <strong>en blanco</strong> y los{' '}
            <strong>anulados</strong>. Anotalo en la hoja de recuento y pasalo a la pantalla. Tocá{' '}
            <Boton sec>Guardar recuento</Boton> cada tanto.
          </Paso>
          <Paso n="5">
            Los tres números de arriba (<strong>Marcas</strong>, <strong>Sobres</strong> y{' '}
            <strong>Contados</strong>) tienen que dar lo mismo. Si no, escribí en la observación qué pasó.
          </Paso>
          <Paso n="6">
            Tocá <Boton>Cerrar la urna</Boton> y confirmá. <strong>No se puede deshacer.</strong> Firmá la
            hoja de recuento y entregala a la comisión con las boletas.
          </Paso>
        </ol>
      </Seccion>

      <Seccion titulo="Si algo pasa">
        <dl className="grid gap-3">
          {[
            ['«Ese código no existe»', 'Revisá el código. Si está bien, avisá a la comisión: la mesa todavía no está habilitada en la web.'],
            ['«El PIN no coincide»', 'Revisá el PIN. Con cinco intentos fallidos la mesa queda bloqueada 15 minutos.'],
            ['«La mesa ya está abierta en otro dispositivo»', 'Tu PIN está en uso en otro lado. Pedile a la comisión que cierre esa sesión.'],
            ['«La comisión cerró esta sesión» o «bloqueó la entrada»', 'Esperá la indicación de la comisión y volvé a entrar con el mismo código y PIN.'],
            ['Se corta internet', 'Seguí con la planilla impresa: tildá a mano y hacé firmar. Cuando vuelva la conexión, registrá en la pantalla a los que tildaste.'],
            ['La tablet se colgó o se apagó', 'Avisá a la comisión para que cierre la sesión, y entrá desde otro dispositivo con las mismas claves.'],
          ].map(([k, v]) => (
            <div key={k} className="card p-4">
              <dt className="font-medium">{k}</dt>
              <dd className="text-ink-2 text-sm mt-1">{v}</dd>
            </div>
          ))}
        </dl>
      </Seccion>

      <div className="mt-8 mb-4 grid gap-2 print:hidden">
        <a href={volver.href} className="btn-primary w-full inline-block text-center">
          {volver.texto}
        </a>
        <BotonPdf className="btn-secondary w-full" />
      </div>
    </Marco>
  )
}
