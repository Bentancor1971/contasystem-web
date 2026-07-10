-- ============================================================
-- evento_web_config — configuración web por evento
-- ------------------------------------------------------------
-- Una fila por evento (eventos_remoto.id). Controla:
--   a) qué opciones se muestran en el formulario público /e/[slug]
--   b) el HTML propio de la web (encabezado/pie, mail de acuse, certificado)
--
-- IMPORTANTE: esta tabla la escribe SOLO la web. El push del desktop
-- (upsert_evento_online) pisa texto_antes/texto_despues de eventos_remoto,
-- por eso esos textos NO viven acá: los sigue mandando el desktop.
--
-- La edita /configuracion/eventos y la consume /e/[slug].
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.evento_web_config (
  -- eventos_remoto.id (TEXT: id local SQLite del desktop)
  evento_id   TEXT PRIMARY KEY,
  empresa_id  TEXT NOT NULL,

  -- ── Visibilidad de campos de datos ──────────────────────────
  mostrar_apellido      BOOLEAN NOT NULL DEFAULT TRUE,
  apellido_obligatorio  BOOLEAN NOT NULL DEFAULT FALSE,
  mostrar_email         BOOLEAN NOT NULL DEFAULT TRUE,
  email_obligatorio     BOOLEAN NOT NULL DEFAULT FALSE,
  mostrar_telefono      BOOLEAN NOT NULL DEFAULT TRUE,
  telefono_obligatorio  BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Categoría ───────────────────────────────────────────────
  mostrar_categoria         BOOLEAN NOT NULL DEFAULT TRUE,
  permitir_categoria_otros  BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── Extras (solo pueden OCULTAR lo que el desktop habilitó) ──
  mostrar_transporte    BOOLEAN NOT NULL DEFAULT TRUE,
  mostrar_alimentacion  BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── Pago / Total ────────────────────────────────────────────
  mostrar_total                BOOLEAN NOT NULL DEFAULT TRUE,
  permitir_pago_transferencia  BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── HTML propio de la web ───────────────────────────────────
  -- Se inyectan tal cual (HTML confiable, lo carga un usuario con config).
  pagina_html_encabezado TEXT,
  pagina_html_pie        TEXT,
  -- Mail de acuse de inscripción. Variables: {nombre} {evento} {numero} {total}
  --   *_acuse_*      → PREINSCRIPCIÓN (modalidad 'reserva', pago pendiente)
  --   *_acuse_pago_* → PAGO DECLARADO (modalidad 'pago_transferencia', a verificar)
  -- Si el campo del caso está vacío, sale el recibo con diseño por defecto.
  mail_acuse_asunto      TEXT,
  mail_acuse_html        TEXT,
  mail_acuse_pago_asunto TEXT,
  mail_acuse_pago_html   TEXT,
  -- Página pública de validación de certificado /c/[token]
  certificado_html  TEXT,

  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por UUID
);

-- Migración idempotente: acuse diferenciado por modalidad (para tablas ya creadas).
ALTER TABLE public.evento_web_config
  ADD COLUMN IF NOT EXISTS mail_acuse_pago_asunto TEXT,
  ADD COLUMN IF NOT EXISTS mail_acuse_pago_html   TEXT;

CREATE INDEX IF NOT EXISTS idx_evento_web_config_empresa
  ON public.evento_web_config(empresa_id);

COMMENT ON TABLE public.evento_web_config IS
  'Config web por evento: visibilidad del formulario público + HTML propio. '
  'La edita /configuracion/eventos. El desktop NO la toca.';

-- RLS: la leen/escriben los endpoints admin y las páginas públicas, siempre
-- vía service_role (que bypassa RLS). Sin policies → anon/authenticated no la
-- tocan directo desde el browser. Mismo criterio que birthday_email_templates.
ALTER TABLE public.evento_web_config ENABLE ROW LEVEL SECURITY;
