-- ============================================================
-- birthday_assets_gif — que la cabecera del saludo pueda ser un GIF animado
-- ------------------------------------------------------------
-- EL PROBLEMA
-- El bucket 'birthday-assets' solo aceptaba PNG, JPG y WebP. Gmail y
-- Outlook descartan las animaciones CSS del mail, así que la única forma de
-- que el saludo de cumpleaños se mueva es una imagen GIF animada.
--
-- QUÉ CAMBIA
-- Suma 'image/gif' a los tipos permitidos del bucket. El endpoint
-- /api/admin/birthday-template/imagen ya lo acepta.
-- Los GIF de ATRI y AUP se generan con design/_gen-cumple-animado.mjs.
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Script idempotente.
-- ============================================================

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
 WHERE id = 'birthday-assets';
