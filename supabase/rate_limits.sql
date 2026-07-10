-- ============================================================
-- rate_limits — límite de peticiones para los endpoints públicos de eventos
-- ------------------------------------------------------------
-- Los endpoints /api/eventos/[slug]/{lookup,inscribir,pago} no tienen
-- autenticación. Sin un tope, cualquiera puede enumerar cédulas.
--
-- Ventana fija ("fixed window") por bucket. Es aproximado —permite hasta 2x el
-- límite en el borde de dos ventanas— pero alcanza de sobra para frenar la
-- enumeración masiva y no necesita infraestructura extra.
--
-- Lo escribe SOLO la web con service_role.
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- Ej: 'lookup:186.52.1.2'
  bucket       TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hits         INTEGER NOT NULL DEFAULT 0
);

-- Para la limpieza periódica de ventanas viejas.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits(window_start);

-- Nadie llega directo desde el browser: sólo service_role (que bypassa RLS).
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Registra un hit y dice si la petición está permitida.
-- ------------------------------------------------------------
-- Devuelve TRUE si se puede seguir, FALSE si se pasó del límite.
-- El UPSERT es atómico: dos peticiones simultáneas no pueden leer el mismo
-- contador y pisarse (a diferencia de un SELECT + UPDATE).
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_bucket TEXT,
  p_limit INT,
  p_window_seconds INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_hits INT;
  -- clock_timestamp(), NO now(): now() es transaction_timestamp() y devuelve el
  -- mismo instante para todas las llamadas de una misma transacción. Un rate
  -- limiter tiene que mirar el reloj de pared, o la ventana nunca se reinicia
  -- cuando varias llamadas caen en la misma transacción (ej. el SQL Editor).
  v_now  TIMESTAMPTZ := CLOCK_TIMESTAMP();
  v_cutoff TIMESTAMPTZ := CLOCK_TIMESTAMP() - MAKE_INTERVAL(secs => p_window_seconds);
BEGIN
  INSERT INTO public.rate_limits (bucket, window_start, hits)
  VALUES (p_bucket, v_now, 1)
  -- Dentro de DO UPDATE, `rate_limits.x` es la fila YA existente (sin esquema).
  ON CONFLICT (bucket) DO UPDATE
    SET hits = CASE
                 WHEN rate_limits.window_start < v_cutoff THEN 1
                 ELSE rate_limits.hits + 1
               END,
        window_start = CASE
                 WHEN rate_limits.window_start < v_cutoff THEN v_now
                 ELSE rate_limits.window_start
               END
  RETURNING rate_limits.hits INTO v_hits;

  RETURN v_hits <= p_limit;
END;
$func$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INT, INT) TO service_role;

-- ------------------------------------------------------------
-- Limpieza de ventanas viejas (opcional; corré cuando quieras).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_limit_gc(p_older_than_hours INT DEFAULT 24)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE n INT;
BEGIN
  DELETE FROM public.rate_limits
   WHERE window_start < NOW() - MAKE_INTERVAL(hours => p_older_than_hours);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

REVOKE ALL ON FUNCTION public.rate_limit_gc(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_gc(INT) TO service_role;
