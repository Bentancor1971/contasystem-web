-- ============================================================
-- Desmarcar asistencia — corrección desde la web
-- ------------------------------------------------------------
-- Aditivo a 34_asistencia_qr.sql (repo desktop, docs/supabase/). En el desktop
-- este archivo va como `35_desmarcar_asistencia.sql`.
--
-- Hasta acá la asistencia sólo AVANZABA: `marcar_asistencia_entrada` escribe la
-- primera vez y `upsert_entrada` nunca deja que un push borre una marca. Es la
-- política correcta para el escáner —una relectura no puede pisar la hora de
-- ingreso— pero deja sin salida el error humano: alguien marcado por accidente
-- desde el modo manual, o dos personas confundidas en la puerta, quedaban
-- presentes para siempre.
--
-- Acá se agrega la vuelta atrás, con dos cuidados:
--
--   1. Queda TRAZA. `desmarcada_at` / `desmarcada_por` dicen cuándo y quién.
--      Borrar `asistio_at` sin dejar rastro haría imposible auditar un evento.
--
--   2. La desmarca NO se resucita sola. Sin esto la corrección duraría hasta el
--      próximo push del desktop: `upsert_entrada` hace
--      COALESCE(existente, entrante), y con `asistio_at` en NULL el entrante
--      ganaba y volvía a marcar a la persona. El desktop repushea cada vez que
--      reenvía el recibo, así que no es un caso raro.
--      La regla nueva: si hay una desmarca POSTERIOR a la marca entrante, gana
--      la desmarca. Una marca genuinamente nueva (reescaneo, o check-in a mano
--      hecho después) es más nueva que la desmarca y sí entra.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Traza de la desmarca
-- ------------------------------------------------------------
ALTER TABLE public.entradas_remoto
  ADD COLUMN IF NOT EXISTS desmarcada_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS desmarcada_por TEXT;

-- Para el pull del desktop: "lo desmarcado desde tal momento", espejo del
-- índice que ya existe sobre asistio_at.
CREATE INDEX IF NOT EXISTS idx_entradas_remoto_desmarcada
  ON public.entradas_remoto(empresa_id, desmarcada_at)
  WHERE desmarcada_at IS NOT NULL;

-- ------------------------------------------------------------
-- 2) ¿Gana la desmarca sobre una marca entrante?
-- ------------------------------------------------------------
-- Sale a función aparte para que la condición viva en UN solo lugar: en
-- `upsert_entrada` hay que aplicarla a tres columnas (at / por / origen) y si se
-- escriben por separado terminan desincronizadas.
--
-- Una entrante sin fecha (NULL) también pierde: es el push de una inscripción
-- que localmente no está marcada, y no tiene por qué borrar la traza.
CREATE OR REPLACE FUNCTION public.entrada_desmarca_gana(
  p_desmarcada_at TIMESTAMPTZ,
  p_entrante_at   TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE
  SET search_path = public, pg_temp AS $$
  SELECT p_desmarcada_at IS NOT NULL
     AND (p_entrante_at IS NULL OR p_entrante_at <= p_desmarcada_at);
$$;

-- ------------------------------------------------------------
-- 3) desmarcar_asistencia_entrada  (web: corregir un marcado)
-- ------------------------------------------------------------
-- Resultados:
--   'ok'            estaba marcada y se desmarcó
--   'no_estaba'     ya figuraba ausente — no es un error, es un doble toque
--   'no_encontrada' token inexistente
--
-- Una entrada anulada TAMBIÉN se puede desmarcar: si se coló un marcado sobre
-- una baja, hay que poder deshacerlo.
--
-- SECURITY DEFINER igual que las otras: la web la llama con service_role y
-- verifica antes que la entrada sea de su empresa y de su evento.
CREATE OR REPLACE FUNCTION public.desmarcar_asistencia_entrada(
  p_token TEXT,
  p_por   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v public.entradas_remoto%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.entradas_remoto WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('resultado','no_encontrada');
  END IF;
  IF v.asistio_at IS NULL THEN
    RETURN jsonb_build_object('resultado','no_estaba','entrada',to_jsonb(v));
  END IF;

  UPDATE public.entradas_remoto
     SET asistio_at     = NULL,
         asistio_por    = NULL,
         asistio_origen = NULL,
         desmarcada_at  = NOW(),
         desmarcada_por = NULLIF(p_por,'')
   WHERE id = v.id
  RETURNING * INTO v;

  RETURN jsonb_build_object('resultado','ok','entrada',to_jsonb(v));
END; $func$;

-- ------------------------------------------------------------
-- 4) upsert_entrada — que el push no resucite una desmarca
-- ------------------------------------------------------------
-- Copia textual de la de 34_asistencia_qr.sql salvo las tres líneas de
-- asistencia, que pasan de COALESCE(existente, entrante) a la regla del punto 2.
-- El resto de las columnas se comporta exactamente igual.
CREATE OR REPLACE FUNCTION public.upsert_entrada(p_row JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $func$
DECLARE v public.entradas_remoto%ROWTYPE;
BEGIN
  INSERT INTO public.entradas_remoto (
    id, token, empresa_id, evento_id, evento_nombre, evento_fecha, evento_lugar,
    nombre_completo, documento, categoria_nombre, rol_nombre, numero, estado,
    asistio_at, asistio_por, asistio_origen, emitida_at
  ) VALUES (
    p_row->>'id',
    COALESCE(NULLIF(p_row->>'token',''), encode(gen_random_bytes(16), 'hex')),
    p_row->>'empresa_id', p_row->>'evento_id', p_row->>'evento_nombre',
    NULLIF(p_row->>'evento_fecha','')::DATE, p_row->>'evento_lugar',
    p_row->>'nombre_completo', p_row->>'documento', p_row->>'categoria_nombre',
    p_row->>'rol_nombre', p_row->>'numero',
    COALESCE(NULLIF(p_row->>'estado',''),'valida'),
    NULLIF(p_row->>'asistio_at','')::TIMESTAMPTZ,
    NULLIF(p_row->>'asistio_por',''),
    NULLIF(p_row->>'asistio_origen',''),
    COALESCE(NULLIF(p_row->>'emitida_at','')::TIMESTAMPTZ, NOW())
  )
  ON CONFLICT (id) DO UPDATE SET
    -- token: estable (no se pisa)
    empresa_id = EXCLUDED.empresa_id, evento_id = EXCLUDED.evento_id,
    evento_nombre = EXCLUDED.evento_nombre, evento_fecha = EXCLUDED.evento_fecha,
    evento_lugar = EXCLUDED.evento_lugar, nombre_completo = EXCLUDED.nombre_completo,
    documento = EXCLUDED.documento, categoria_nombre = EXCLUDED.categoria_nombre,
    rol_nombre = EXCLUDED.rol_nombre, numero = EXCLUDED.numero,
    estado = EXCLUDED.estado,
    -- La marca sigue sin poder borrarse con un NULL entrante, pero ahora una
    -- desmarca explícita y posterior le gana a la marca que trae el push.
    asistio_at = CASE
      WHEN public.entradas_remoto.asistio_at IS NOT NULL THEN public.entradas_remoto.asistio_at
      WHEN public.entrada_desmarca_gana(public.entradas_remoto.desmarcada_at, EXCLUDED.asistio_at) THEN NULL
      ELSE EXCLUDED.asistio_at END,
    asistio_por = CASE
      WHEN public.entradas_remoto.asistio_at IS NOT NULL THEN public.entradas_remoto.asistio_por
      WHEN public.entrada_desmarca_gana(public.entradas_remoto.desmarcada_at, EXCLUDED.asistio_at) THEN NULL
      ELSE EXCLUDED.asistio_por END,
    asistio_origen = CASE
      WHEN public.entradas_remoto.asistio_at IS NOT NULL THEN public.entradas_remoto.asistio_origen
      WHEN public.entrada_desmarca_gana(public.entradas_remoto.desmarcada_at, EXCLUDED.asistio_at) THEN NULL
      ELSE EXCLUDED.asistio_origen END,
    emitida_at = COALESCE(public.entradas_remoto.emitida_at, EXCLUDED.emitida_at)
  RETURNING * INTO v;
  RETURN to_jsonb(v);
END; $func$;

GRANT EXECUTE ON FUNCTION public.entrada_desmarca_gana(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desmarcar_asistencia_entrada(TEXT, TEXT) TO authenticated;

-- Y fuera de anon. El GRANT de arriba no quita nada: Supabase le da EXECUTE
-- explícito a anon y authenticated a TODA función nueva (default privileges del
-- proyecto), así que sin este REVOKE la función quedaba llamable con la anon key
-- —la que va en el bundle del browser— y es SECURITY DEFINER: corre como
-- postgres y borra el check-in de cualquier entrada con sólo tener el token.
-- `authenticated` se conserva: es el personal del evento, que sí la usa.
REVOKE EXECUTE ON FUNCTION public.desmarcar_asistencia_entrada(TEXT, TEXT) FROM PUBLIC, anon;

-- ============================================================
-- PENDIENTE DEL LADO DESKTOP
-- ============================================================
-- `pullAsistenciasQR` (src/lib/sync/eventos-online.ts) hoy baja sólo lo marcado:
--
--     .eq('asistio_origen','web').not('asistio_at','is',null)
--     ... y en el loop: "nunca desmarca".
--
-- Con eso, una desmarca hecha en la web NO llega al desktop: la fila deja de
-- aparecer en el pull y la inscripción local se queda con asistio = 1.
-- La corrección queda firme en la nube (el punto 4 impide que el push la
-- resucite), pero las dos bases quedan distintas hasta que alguien lo arregle
-- a mano en el desktop.
--
-- Para cerrar el círculo, el desktop tendría que hacer una segunda consulta:
--
--     SELECT id, desmarcada_at, desmarcada_por
--       FROM entradas_remoto
--      WHERE empresa_id IN (...) AND evento_id = ?
--        AND desmarcada_at IS NOT NULL AND asistio_at IS NULL
--
-- y para cada fila cuya inscripción local tenga `asistencia_origen = 'web'`:
--
--     UPDATE inscripciones_evento
--        SET asistio = 0, fecha_asistencia = NULL, asistencia_origen = NULL
--      WHERE id = ?
--
-- El filtro por `asistencia_origen = 'web'` es deliberado: si el check-in local
-- se hizo a mano en el desktop, ese dato es del desktop y la web no lo pisa.
-- ============================================================
