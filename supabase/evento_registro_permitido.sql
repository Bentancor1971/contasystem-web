-- ============================================================
-- eventos_remoto.registro_permitido — quién puede inscribirse
-- ------------------------------------------------------------
-- Política de admisión del evento. La DEFINE EL DESKTOP (igual que
-- sorteo_solo_socios): esta tabla la escribe el push `upsert_evento_online`.
-- La web sólo la lee y la hace cumplir en /lookup y /inscribir.
--
--   'todos'          Cualquiera, incluso quien no está en el padrón (completa
--                    sus datos). Es el comportamiento histórico y el DEFAULT.
--   'padron'         Sólo quien exista en socios_datos, con o sin cuotas
--                    pendientes.
--   'socios_al_dia'  Sólo quien pase la regla de cuotas del evento
--                    (umbral_cuotas_no_socio), es decir tipo_participante='socio'.
--
-- NOTA DE PRIVACIDAD ('padron'): con esta política, aceptar o rechazar una
-- cédula ES el bit de pertenencia al padrón. Hoy ese bit está deliberadamente
-- oculto ("no está en la base" y "socio con deuda" se colapsan en el mismo
-- no_socio, ver ResolucionPublica). Elegirla acepta que el formulario público
-- permita descubrir quién está en la base; el único freno es el tope por IP de
-- /lookup. 'socios_al_dia' NO tiene ese costo: el lookup ya expone
-- tipo_participante porque lo necesita para el precio.
--
-- El DEFAULT preserva el comportamiento actual: mientras el desktop no mande el
-- valor, su upsert no toca la columna y todos los eventos siguen abiertos.
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente.
-- ============================================================

ALTER TABLE public.eventos_remoto
  ADD COLUMN IF NOT EXISTS registro_permitido TEXT NOT NULL DEFAULT 'todos';

-- Constraint en bloque aparte: ADD CONSTRAINT no admite IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eventos_remoto_registro_permitido_chk'
  ) THEN
    ALTER TABLE public.eventos_remoto
      ADD CONSTRAINT eventos_remoto_registro_permitido_chk
      CHECK (registro_permitido IN ('todos', 'padron', 'socios_al_dia'));
  END IF;
END $$;

COMMENT ON COLUMN public.eventos_remoto.registro_permitido IS
  'Quién puede inscribirse: todos | padron | socios_al_dia. La define el '
  'desktop; la web la hace cumplir en /lookup y /inscribir.';
