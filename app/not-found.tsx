import Link from 'next/link'
import { Highlight } from '@/components/Highlight'

/**
 * 404 con la marca. Sin esto, un slug de evento inexistente (o un link viejo)
 * mostraba la pantalla genérica de Next en inglés. Aplica a todo `notFound()`
 * del árbol y a cualquier URL que no exista.
 *
 * No dice QUÉ no se encontró a propósito: para `/e/{slug}` una elección en
 * borrador da el mismo 404 que un slug inventado (ver app/e/[slug]/page.tsx).
 */
export default function NotFound() {
  return (
    <main className="min-h-screen grain flex items-center justify-center p-6">
      <div className="max-w-md text-center rise">
        <p className="label-mono mb-3">404</p>
        <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[0.95] mb-5">
          Esta página <Highlight thin>no existe</Highlight>
        </h1>
        <p className="text-ink-2 leading-relaxed">
          El enlace puede estar incompleto o haber vencido. Si llegaste desde un
          correo, volvé a abrirlo desde el mail original.
        </p>
        <Link href="/" className="btn-ghost mt-8 mx-auto inline-flex">
          Ir al inicio
        </Link>
      </div>
    </main>
  )
}
