-- ============================================================
-- copia_oculta_acuse — que la copia oculta del acuse se pueda apagar
-- ------------------------------------------------------------
-- EL PROBLEMA
-- `sendInscripcionEmail` mandaba `bcc: cuenta.user` sin condición: cada
-- inscripción dejaba una copia en la casilla remitente. En un evento de
-- inscripción masiva (un sorteo abierto una semana) eso son cientos de mails
-- a la misma casilla, y no había forma de apagarlo salvo tocando el código.
--
-- QUÉ AGREGA
-- Dos columnas, con la misma forma que el resto de la configuración web:
--
--   birthday_email_templates.copia_oculta_acuse  DEFAULT de la empresa.
--     TRUE (default) = como venía funcionando: la organización se copia todo.
--     Se edita en /configuracion/mails/plantilla, junto a la casilla.
--
--   evento_web_config.copia_oculta               EXCEPCIÓN de un evento.
--     NULL (default) = heredar lo que diga la casilla. TRUE/FALSE lo pisan.
--     Se edita en /configuracion/eventos.
--
-- NO toca el saludo de cumpleaños: ese sigue copiándose siempre (es un mail
-- por persona por año, nadie se queja de esa casilla).
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente.
-- ============================================================

ALTER TABLE public.birthday_email_templates
  ADD COLUMN IF NOT EXISTS copia_oculta_acuse BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.birthday_email_templates.copia_oculta_acuse IS
  'Default de la empresa: mandarse copia oculta de cada acuse de inscripción a '
  'la propia casilla. Un evento puede pisarlo con evento_web_config.copia_oculta.';

ALTER TABLE public.evento_web_config
  ADD COLUMN IF NOT EXISTS copia_oculta BOOLEAN;

COMMENT ON COLUMN public.evento_web_config.copia_oculta IS
  'Excepción de ESTE evento a la copia oculta del acuse. NULL = heredar el '
  'default de la casilla (birthday_email_templates.copia_oculta_acuse).';

-- ------------------------------------------------------------
-- VERIFICACIÓN — qué va a pasar con cada evento configurado.
-- ------------------------------------------------------------
-- SELECT c.evento_id, e.nombre,
--        c.copia_oculta                          AS excepcion_evento,
--        t.copia_oculta_acuse                    AS default_empresa,
--        COALESCE(c.copia_oculta, t.copia_oculta_acuse, TRUE) AS manda_copia
--   FROM public.evento_web_config c
--   JOIN public.eventos_remoto e ON e.id = c.evento_id
--   LEFT JOIN public.birthday_email_templates t ON t.empresa_id = c.empresa_id
--  ORDER BY e.nombre;
