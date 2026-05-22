-- ============================================================
-- birthday_email_logs
-- ------------------------------------------------------------
-- Trazabilidad e idempotencia del cron de saludos de cumpleaños
-- (app/api/cron/birthdays). Una fila por (socio, fecha de saludo).
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente: se puede correr más de una vez sin romper nada.
--
-- Depende de la tabla ya existente:
--   public.socios_datos  (id UUID, "personas")
--
-- Nota: empresa_id NO tiene FK. Los empresa_id de socios_datos son ids
-- locales del SQLite del desktop y no están en empresas_online_remoto
-- (esa tabla solo contiene el subset de empresas con comprobantes online).
-- Se guarda como TEXT plano, igual que socios_datos.empresa_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.birthday_email_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A quién se saludó. Si se borra el socio, se borra su historial.
  socio_id         UUID NOT NULL
                     REFERENCES public.socios_datos(id) ON DELETE CASCADE,

  -- Desde qué empresa salió el saludo (socios_datos.empresa_id, TEXT).
  empresa_id       TEXT NOT NULL,

  -- Fecha en que se envió el saludo (zona Montevideo). Para 29-feb en años
  -- no bisiestos, el cron usa el 28-feb.
  fecha_cumpleanos DATE NOT NULL,

  status           TEXT NOT NULL CHECK (status IN ('enviado', 'error')),
  error_message    TEXT,

  enviado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotencia: un socio recibe a lo sumo un saludo por fecha.
  -- El endpoint hace upsert con onConflict sobre estas dos columnas.
  CONSTRAINT uq_birthday_email_logs_socio_fecha
    UNIQUE (socio_id, fecha_cumpleanos)
);

-- Lookup diario del cron: "¿a quién ya saludé hoy?"
CREATE INDEX IF NOT EXISTS idx_birthday_email_logs_fecha
  ON public.birthday_email_logs (fecha_cumpleanos);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- La tabla la leen/escriben únicamente el cron y administradores, siempre
-- vía service_role (que bypassa RLS). Habilitamos RLS sin policies para
-- que los roles anon/authenticated no puedan tocarla desde el browser.
ALTER TABLE public.birthday_email_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.birthday_email_logs IS
  'Log de saludos de cumpleaños enviados por el cron app/api/cron/birthdays. '
  'Garantiza idempotencia (unique socio_id + fecha_cumpleanos) y trazabilidad.';
