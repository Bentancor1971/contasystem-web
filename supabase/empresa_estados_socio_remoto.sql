-- ============================================================
-- empresa_estados_socio_remoto — qué estados de registro son "socio"
-- ------------------------------------------------------------
-- Una fila por empresa con la lista de `socios_datos.estado_registro_nombre`
-- que cuentan como socio en el formulario público. La DEFINE EL DESKTOP (dueño
-- del catálogo `estados_registro`); la web sólo la lee en resolverParticipante.
--
-- POR QUÉ EXISTE: hasta ahora la web decidía socio/no_socio mirando sólo las
-- cuotas pendientes (socios_cuotas_remoto). Como ese push manda únicamente a los
-- deudores (HAVING cnt > 0), un socio DADO DE BAJA sin deuda no tiene fila →
-- 0 cuotas → "✓ Socio al día". El estado de registro ya viaja en socios_datos
-- desde el sync de fichas; lo que faltaba era saber cuáles de esos estados
-- significan "es socio", porque el catálogo lo define cada empresa y no es el
-- mismo en todas (hay 'Activo', 'Baja', 'Eventos', 'Honorario', 'Pendiente'…).
--
-- DEFAULT SIN FILA: si una empresa no tiene fila acá, la web cae a su regla
-- interna (sólo los estados que empiezan con 'activ' cuentan como socio; ver
-- ESTADOS_SOCIO_POR_DEFECTO en lib/eventos.ts). El default NO es "todos": el
-- caso conservador es no regalar la tarifa de socio a quien está de baja.
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.empresa_estados_socio_remoto (
  empresa_id     TEXT PRIMARY KEY,
  -- Array JSON de nombres de estado, tal cual están en estados_registro.nombre
  -- del desktop (ej: ["Activo","Honorario","Socio S.R.I.U."]). La comparación la
  -- hace la web sin distinguir mayúsculas ni tildes.
  -- Array VACÍO = ningún estado es socio (todo el padrón paga tarifa no socio).
  -- Es un valor válido y distinto de "sin fila", que cae al default de la web.
  estados        JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.empresa_estados_socio_remoto IS
  'Estados de registro que cuentan como socio en el formulario público. '
  'La escribe el desktop (set_empresa_estados_socio); la web la hace cumplir '
  'en resolverParticipante. Sin fila = default de la web (sólo "Activo*").';

-- ------------------------------------------------------------
-- Set atómico por empresa (lo llama el push de eventos del desktop)
-- ------------------------------------------------------------
-- Mismo criterio que set_socios_cuotas_empresa: el desktop manda el set completo
-- y esta función lo reemplaza. Idempotente.
CREATE OR REPLACE FUNCTION public.set_empresa_estados_socio(
  p_empresa_id TEXT,
  p_estados    JSONB   -- array de strings: nombres de estado_registro
)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  n INT;
BEGIN
  -- Autorización: el llamador debe tener acceso a la empresa (RLS helper).
  IF NOT public.user_has_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a la empresa %', p_empresa_id;
  END IF;

  IF p_estados IS NULL OR jsonb_typeof(p_estados) <> 'array' THEN
    RAISE EXCEPTION 'p_estados debe ser un array JSON';
  END IF;

  INSERT INTO public.empresa_estados_socio_remoto (empresa_id, estados)
  VALUES (p_empresa_id, p_estados)
  ON CONFLICT (empresa_id) DO UPDATE
    SET estados = EXCLUDED.estados, row_updated_at = NOW();

  SELECT jsonb_array_length(p_estados) INTO n;
  RETURN n;
END;
$func$;

-- ------------------------------------------------------------
-- RLS: mismo criterio que el resto de las *_remoto del puente.
-- authenticated (el desktop) ve/escribe lo de su empresa; el flujo público de
-- la web entra por service_role, que bypassa RLS.
-- ------------------------------------------------------------
ALTER TABLE public.empresa_estados_socio_remoto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa_estados_socio_remoto_select" ON public.empresa_estados_socio_remoto;
CREATE POLICY "empresa_estados_socio_remoto_select" ON public.empresa_estados_socio_remoto
  FOR SELECT TO authenticated USING (public.user_has_empresa(empresa_id));

DROP POLICY IF EXISTS "empresa_estados_socio_remoto_insert" ON public.empresa_estados_socio_remoto;
CREATE POLICY "empresa_estados_socio_remoto_insert" ON public.empresa_estados_socio_remoto
  FOR INSERT TO authenticated WITH CHECK (public.user_has_empresa(empresa_id));

DROP POLICY IF EXISTS "empresa_estados_socio_remoto_update" ON public.empresa_estados_socio_remoto;
CREATE POLICY "empresa_estados_socio_remoto_update" ON public.empresa_estados_socio_remoto
  FOR UPDATE TO authenticated
  USING (public.user_has_empresa(empresa_id))
  WITH CHECK (public.user_has_empresa(empresa_id));

GRANT EXECUTE ON FUNCTION public.set_empresa_estados_socio(TEXT, JSONB) TO authenticated;
