/**
 * POST /api/eventos/[slug]/sorteo   body: { documento }
 *
 * Endpoint PÚBLICO: "¿salí sorteado?". Contesta qué le tocó a una cédula en el
 * sorteo publicado del evento (docs/supabase/69_sorteos.sql, repo desktop).
 *
 * Va aparte del lookup de inscripción a propósito: el sorteo se hace con los
 * registros cerrados, y con el evento cerrado el formulario no ofrece el
 * lookup. Además no toca el padrón: sólo compara el hash de la cédula contra
 * los resultados y la inscripción web.
 *
 * Nunca devuelve nombres ni la lista: quien pregunta ya sabe de quién es la
 * cédula. Mismo tope por IP que el lookup, que es el que martillaría un
 * enumerador.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { consultarSorteoPorCedula, loadEventoRemotoBySlug } from '@/lib/eventos'
import { normalizeDocumento } from '@/lib/documento'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params

    let body: { documento?: unknown }
    try {
      body = (await req.json()) as { documento?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }
    const documento = typeof body.documento === 'string' ? body.documento : ''
    if (normalizeDocumento(documento).length < 6) {
      return NextResponse.json({ error: 'Cédula inválida' }, { status: 400 })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.lookup))) {
      return NextResponse.json(RESPUESTA_429, { status: 429 })
    }

    const evento = await loadEventoRemotoBySlug(admin, slug)
    if (!evento) {
      return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    }

    const r = await consultarSorteoPorCedula(admin, evento, documento)
    if (!r) {
      return NextResponse.json({ error: 'Este evento todavía no tiene un sorteo publicado.' }, { status: 404 })
    }
    return NextResponse.json(r)
  } catch (err) {
    console.error('[POST /api/eventos/[slug]/sorteo] error:', err)
    return NextResponse.json(
      { error: 'No se pudo consultar el sorteo. Reintentá en unos segundos.' },
      { status: 503 },
    )
  }
}
