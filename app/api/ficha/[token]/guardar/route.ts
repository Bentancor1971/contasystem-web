/**
 * POST /api/ficha/[token]/guardar   body: { factor, cambios }
 *
 * Endpoint PÚBLICO. Registra la PROPUESTA de cambios de ficha: la web nunca
 * escribe socios_datos — el desktop baja la propuesta y la aplica (o no)
 * campo por campo.
 *
 * `registrar_ficha_cambio` revalida el factor (no confía en que /validar haya
 * ocurrido), aplica la lista blanca y descarta `documento` si la cédula es
 * válida. Este handler pone el tope por IP y el saneo que la base hace más
 * grueso: sólo claves de la lista blanca, textos recortados, nada vacío
 * (vaciar un campo no viaja: no hay borrado remoto de datos, mismo criterio
 * que eventos), y los tres formatos que el formulario garantiza pero un POST
 * a mano no — cédula con dígito verificador, fecha ISO, sexo M/F.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ocultarInexistente, registrarFichaCambio } from '@/lib/ficha'
import { esCedulaUruguayaValida } from '@/lib/cedula'
import {
  CAMPOS_FICHA,
  limpiarDocumento,
  MAX_LARGO_VALOR,
  tokenValido,
} from '@/lib/ficha-types'
import { LIMITES, permitido, RESPUESTA_429 } from '@/lib/rate-limit'
import { factorDelBody, SIN_CACHE } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sanea la propuesta. Devuelve los cambios limpios, o el código de error si
 * algo no tiene arreglo recortando (formato inválido).
 *
 * Los valores se RECORTAN a 200 en vez de rechazarse (nadie escribe de más a
 * propósito, y la RPC descartaría el campo entero en silencio); los formatos
 * inválidos sí se rechazan con código propio, porque guardarlos le haría
 * revisar basura a la asociación.
 */
function sanearCambios(
  v: unknown,
  permitirVacio: boolean,
): { cambios: Record<string, string> } | { error: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return permitirVacio ? { cambios: {} } : { error: 'sin_cambios' }
  }

  const cambios: Record<string, string> = {}
  for (const campo of CAMPOS_FICHA) {
    const crudo = (v as Record<string, unknown>)[campo]
    if (typeof crudo !== 'string') continue
    const valor = crudo.trim().slice(0, MAX_LARGO_VALOR)
    if (valor === '') continue // vaciar no viaja

    if (campo === 'documento') {
      const doc = limpiarDocumento(valor)
      // Misma exigencia que el formulario: la cédula corregida tiene que pasar
      // el dígito verificador. Es el único campo que nace de un error de carga
      // y no puede reemplazarse por otro error de carga.
      if (!esCedulaUruguayaValida(doc)) return { error: 'documento_invalido' }
      cambios.documento = doc
      continue
    }
    if (
      (campo === 'fecha_nacimiento' || campo === 'fecha_recibido') &&
      !/^\d{4}-\d{2}-\d{2}$/.test(valor)
    ) {
      return { error: 'cambios_invalidos' }
    }
    if (campo === 'sexo' && valor !== 'M' && valor !== 'F') {
      return { error: 'cambios_invalidos' }
    }
    cambios[campo] = valor
  }

  if (Object.keys(cambios).length === 0 && !permitirVacio) return { error: 'sin_cambios' }
  return { cambios }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    let body: { factor?: unknown; cambios?: unknown; subio_titulo?: unknown }
    try {
      body = (await req.json()) as { factor?: unknown; cambios?: unknown; subio_titulo?: unknown }
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE })
    }

    const factor = factorDelBody(body.factor)
    if (!tokenValido(token) || factor === null) {
      return NextResponse.json({ error: 'factor_incorrecto' }, { headers: SIN_CACHE })
    }

    // `subio_titulo` es sólo la pista de que puede haber propuesta con CERO
    // campos tocados (la persona nada más subió el PDF): habilita mandar
    // cambios vacíos a la RPC, que es quien de verdad verifica el archivo en
    // Storage y lo inyecta como titulo_pdf. Si mintió, la RPC responde
    // sin_cambios y no pasa nada.
    const saneado = sanearCambios(body.cambios, body.subio_titulo === true)
    if ('error' in saneado) {
      return NextResponse.json(saneado, { headers: SIN_CACHE })
    }

    const admin = createAdminClient()
    if (!(await permitido(admin, req, LIMITES.fichaGuardar))) {
      return NextResponse.json(RESPUESTA_429, { status: 429, headers: SIN_CACHE })
    }

    const r = ocultarInexistente(
      await registrarFichaCambio(admin, token, factor, saneado.cambios),
    )
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[POST /api/ficha/[token]/guardar] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: SIN_CACHE })
  }
}
