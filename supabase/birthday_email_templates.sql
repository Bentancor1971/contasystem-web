-- ============================================================
-- birthday_email_templates  +  bucket de Storage 'birthday-assets'
-- ------------------------------------------------------------
-- Plantilla editable del mail de cumpleaños, una fila por empresa.
-- La edita la página /configuracion/mails/plantilla y la consume el
-- cron app/api/cron/birthdays.
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tabla de plantillas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.birthday_email_templates (
  -- Una plantilla por empresa (socios_datos.empresa_id, TEXT).
  empresa_id        TEXT PRIMARY KEY,

  -- Asunto del mail. Admite las variables {nombre} y {denominacion}.
  asunto            TEXT NOT NULL DEFAULT '¡Feliz cumpleaños, {nombre}!',

  -- "Denominación" = tratamiento de la persona (ej. 'Estimado/a').
  -- Se inserta en el cuerpo donde aparezca {denominacion}.
  denominacion      TEXT NOT NULL DEFAULT 'Estimado/a',

  -- Cuerpo del saludo. Admite {nombre} y {denominacion}. Texto plano:
  -- los saltos de línea se convierten en <br> al renderizar el HTML.
  cuerpo            TEXT NOT NULL DEFAULT
    '{denominacion} {nombre}, ¡te deseamos un muy feliz cumpleaños!',

  -- Imagen de fondo: path dentro del bucket 'birthday-assets'.
  -- NULL = sin imagen (el mail usa un fondo de color sólido).
  imagen_fondo_path TEXT,

  -- Estilo del texto sobre la imagen.
  texto_color       TEXT    NOT NULL DEFAULT '#ffffff',
  -- Panel semitransparente detrás del texto, para legibilidad.
  panel_color       TEXT    NOT NULL DEFAULT '#1a1814',
  panel_opacidad    INTEGER NOT NULL DEFAULT 40
                      CHECK (panel_opacidad BETWEEN 0 AND 100),

  -- Si false, el cron NO le manda saludos a esta empresa.
  activo            BOOLEAN NOT NULL DEFAULT FALSE,

  -- Casilla Gmail remitente de esta empresa.
  gmail_user         TEXT,         -- ej. saludos.empresa@gmail.com
  gmail_app_password TEXT,         -- App Password de 16 caracteres (secreto)
  from_name          TEXT,         -- nombre visible del remitente

  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por   UUID
);

-- Para instalaciones donde la tabla ya existía sin estas columnas.
ALTER TABLE public.birthday_email_templates
  ADD COLUMN IF NOT EXISTS activo             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gmail_user         TEXT,
  ADD COLUMN IF NOT EXISTS gmail_app_password TEXT,
  ADD COLUMN IF NOT EXISTS from_name          TEXT;

COMMENT ON TABLE public.birthday_email_templates IS
  'Plantilla editable del mail de cumpleaños, una fila por empresa. '
  'La edita /configuracion/mails/plantilla; la usa el cron de saludos.';

-- RLS: la tabla la leen/escriben el cron y los endpoints admin, siempre
-- vía service_role (que bypassa RLS). Sin policies → anon/authenticated
-- no la tocan directo desde el browser.
ALTER TABLE public.birthday_email_templates ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2) Bucket de Storage para las imágenes de fondo
-- ------------------------------------------------------------
-- Público: los clientes de correo necesitan poder bajar la imagen por
-- URL al abrir el mail. Las subidas las hace el endpoint admin con la
-- service_role key (que bypassa las policies de storage.objects).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'birthday-assets',
  'birthday-assets',
  TRUE,
  3145728,                                   -- 3 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public            = EXCLUDED.public,
      file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- 3) Ajustes generales del cron (una sola fila)
-- ------------------------------------------------------------
-- hora_envio = hora de Montevideo (0-23) a la que se mandan los saludos.
-- El cron de Vercel corre cada hora; el endpoint envía solo cuando la
-- hora actual coincide con esta. Así la hora es editable desde la UI sin
-- redeploy.
CREATE TABLE IF NOT EXISTS public.birthday_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hora_envio      INTEGER NOT NULL DEFAULT 9 CHECK (hora_envio BETWEEN 0 AND 23),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por UUID
);

-- Garantiza que exista la fila única.
INSERT INTO public.birthday_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.birthday_settings ENABLE ROW LEVEL SECURITY;
