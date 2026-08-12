-- ============================================================
-- search_path fijo en todas las funciones de public
-- ------------------------------------------------------------
-- Cierra el aviso "Function Search Path Mutable" del Security Advisor.
--
-- Una función sin `SET search_path` usa el del que la llama. En una
-- SECURITY DEFINER eso es escalada de privilegios: quien pueda crear objetos
-- en algún esquema (o en public) define su propia `now()` o su propia tabla
-- `entradas_remoto`, la pone primero en el search_path, y el cuerpo de la
-- función ejecuta ESE objeto con los permisos del owner —normalmente postgres,
-- que bypassa todo RLS.
--
-- En SECURITY INVOKER no hay escalada (corre con los permisos de quien llama),
-- pero se arregla igual: es gratis y evita que mañana alguien le agregue
-- DEFINER a una función y herede el agujero sin darse cuenta.
--
-- Se hace con ALTER y no reescribiendo cada CREATE FUNCTION porque son ~42
-- funciones repartidas entre este repo y el desktop. El ALTER sólo toca el
-- atributo, no el cuerpo: no hay riesgo de pisar una definición más nueva.
--
-- `public, pg_temp` y no sólo `public`: pg_temp va explícito y AL FINAL. Si se
-- omite, Postgres lo antepone implícitamente y el atacante puede crear una
-- tabla temporal que tape a la real. Es la recomendación estándar.
--
-- Aplicar en: Supabase Dashboard → SQL Editor → pegar y "Run".
-- Idempotente: correlo las veces que quieras.
-- ============================================================

DO $$
DECLARE
  f RECORD;
  n INT := 0;
BEGIN
  FOR f IN
    SELECT p.oid,
           p.prokind,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       -- Agregados ('a') y window ('w') no aceptan SET; sólo funciones y procedures.
       AND p.prokind IN ('f', 'p')
       -- Nada que venga de una extensión (pgcrypto, pg_trgm, etc. instaladas en
       -- public). No son nuestras y el advisor tampoco las marca.
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid
                AND d.deptype = 'e'
           )
       -- Sólo las que todavía no lo tienen fijado.
       AND (p.proconfig IS NULL
            OR NOT EXISTS (
                  SELECT 1 FROM unnest(p.proconfig) AS c
                   WHERE c LIKE 'search_path=%'
               ))
  LOOP
    EXECUTE format(
      '%s public.%I(%s) SET search_path = public, pg_temp',
      CASE f.prokind WHEN 'p' THEN 'ALTER PROCEDURE' ELSE 'ALTER FUNCTION' END,
      f.proname,
      f.args
    );
    n := n + 1;
    RAISE NOTICE 'search_path fijado: %(%)', f.proname, f.args;
  END LOOP;

  RAISE NOTICE '--- % funciones corregidas ---', n;
END;
$$;

-- ------------------------------------------------------------
-- Verificación: después de correr lo de arriba, esto debe dar 0 filas.
-- ------------------------------------------------------------
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public'
   AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
   AND (p.proconfig IS NULL
        OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) AS c WHERE c LIKE 'search_path=%'))
 ORDER BY p.prosecdef DESC, p.proname;

-- ============================================================
-- PENDIENTE — que no vuelva a aparecer
-- ============================================================
-- Este script arregla lo que YA está en la nube. Las definiciones siguen en los
-- .sql de los dos repos, así que el próximo `CREATE OR REPLACE FUNCTION` sin
-- `SET search_path` reintroduce el aviso (CREATE OR REPLACE pisa el proconfig).
--
-- Para cerrarlo de verdad hay que agregar la cláusula en el origen:
--
--   web (este repo):
--     supabase/desmarcar_asistencia.sql   → entrada_desmarca_gana, upsert_entrada
--     supabase/empresa_estados_socio_remoto.sql → set_empresa_estados_socio
--     (rate_limit_hit / rate_limit_gc / desmarcar_asistencia_entrada ya la tienen)
--
--   desktop (docs/supabase/*.sql) — de ahí salen las ~42 del advisor:
--     upsert_evento_online, upsert_categoria_socio, touch_row_updated_at,
--     reconciliar_contactos_remoto, reconciliar_cuentas_remoto,
--     reconciliar_plantillas_remoto, inscripciones_evento_remoto_set*, etc.
--
-- Prioridad: primero las que sean SECURITY DEFINER (la consulta de verificación
-- las ordena arriba de todo). Las INVOKER pueden esperar al próximo toque.
-- ============================================================
