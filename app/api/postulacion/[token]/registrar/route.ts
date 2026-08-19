/**
 * POST /api/postulacion/[token]/registrar
 * body: { digitos, telefono?, mail_contacto?, comentario?, acepta_condiciones, respuestas? }
 *
 * Endpoint PÚBLICO. Anota a la persona en la convocatoria.
 *
 * Casi nada se decide acá: `registrar_postulacion` revalida el segundo factor
 * —no confía en que el paso 2 haya ocurrido—, la ventana contra el NOW() de
 * Postgres y el bloqueo por deuda, y el índice único remata los dos requests
 * simultáneos. Este handler pone el tope por IP, recorta los textos y exige el
 * checkbox de condiciones, que es lo único que la base no mira.
 *
 * No manda ningún mail: el acuse lo manda el desktop cuando baja la postulación.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ocultarInexistente, registrarPostulacion } from '@/lib/convocatorias'
import { digitosValidos, tokenValido } from '@/lib/convocatorias-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { SIN_CACHE } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Topes de largo. La base no los tiene —las tres columnas son TEXT— y sin esto
 * un POST puede dejar un comentario de megabytes que después hay que leer en una
 * grilla del desktop. Se recorta en vez de rechazar: nadie escribe 2000
 * caracteres sin querer, y perder una postulación por larga sería peor.
 */
const MAX = { telefono: 40, mail_contacto: 120, comentario: 2000 } as const

function recortar(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/**
 * Las respuestas a las preguntas del llamado, saneadas.
 *
 * Un booleano (casilla), o un texto (id de la opción elegida, o lo escrito).
 * Acá NO se valida cuáles corresponden, cuáles son obligatorias ni si la opción
 * existe: eso lo hace `registrar_postulacion` contra la definición del llamado,
 * que es la única capa que no se puede saltear. Esto sólo evita que un POST a
 * mano meta un objeto arbitrario en una columna JSONB.
 *
 * Los dos topes son la misma idea que el de largo de los textos: el llamado
 * admite tres preguntas de hasta 200 caracteres, así que un cuerpo con
 * quinientas claves o con un texto de megabytes es basura.
 */
const MAX_RESPUESTAS = 20
const MAX_LARGO_RESPUESTA = 200

function respuestas(v: unknown): Record<string, boolean | string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, boolean | string> = {}
  for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_RESPUESTAS) break
    if (!k) continue
    if (typeof valor === 'boolean') out[k] = valor
    else if (typeof valor === 'string') out[k] = valor.trim().slice(0, MAX_LARGO_RESPUESTA)
  }
  return out
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }

    const digitos = digitosValidos(body.digitos)
    if (!tokenValido(token) || digitos === null) {
      return NextResponse.json({ error: 'digitos_incorrectos' }, { headers: SIN_CACHE })
    }

    // Lo único que la base no valida. Se chequea acá para que una postulación
    // registrada siempre tenga la declaración hecha, y no quede en la grilla del
    // desktop una fila que dice "no aceptó" sin que nadie sepa qué significa.
    if (body.acepta_condiciones !== true) {
      return NextResponse.json({ error: 'falta_aceptar' }, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.postulacionEnviar))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(
      await registrarPostulacion(admin, token, digitos, {
        telefono: recortar(body.telefono, MAX.telefono),
        mail_contacto: recortar(body.mail_contacto, MAX.mail_contacto),
        comentario: recortar(body.comentario, MAX.comentario),
        acepta_condiciones: true,
        respuestas: respuestas(body.respuestas),
      }),
    )
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/postulacion/[token]/registrar] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
