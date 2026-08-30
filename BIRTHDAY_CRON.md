# Cron de saludos de cumpleaños

Dos veces por día, a **hora fija** (08:00 y 08:30 de Montevideo), el cron
busca en `socios_datos` los socios que cumplen años hoy y les manda un saludo
personalizado desde la casilla Gmail de su empresa. Vercel Cron llama a
`GET /api/cron/birthdays` en cada uno de esos dos horarios (`vercel.json`); no
hay un chequeo de hora dentro del endpoint — cuando lo llaman, envía. La
segunda corrida (08:30) existe para terminar lo que la primera (08:00) haya
dejado pendiente por el presupuesto de tiempo propio del endpoint (ver
"Tandas y presupuesto de tiempo" más abajo); si la primera ya mandó todo, la
segunda no reenvía nada — es idempotente contra `birthday_email_logs`.

> La hora de envío **ya no se edita desde la app**: es fija, definida en
> `vercel.json` + la constante `HORA_ENVIO_MONTEVIDEO` de
> `app/api/admin/birthday-config/route.ts` (sólo para mostrarla en la
> pantalla de estado). El endpoint `PUT /api/admin/birthday-settings` y la
> tabla `birthday_settings` que usaba quedaron sin uso — no se borraron (la
> tabla la sigue creando `supabase/birthday_email_templates.sql`) pero nada
> los llama. Para cambiar el horario: editar los dos `schedule` de
> `vercel.json`, `HORA_ENVIO_MONTEVIDEO` y redeployar.

## Cómo funciona

| Pieza | Archivo |
|---|---|
| Endpoint del cron | [`app/api/cron/birthdays/route.ts`](app/api/cron/birthdays/route.ts) |
| Envío vía Gmail SMTP | [`lib/mailer.ts`](lib/mailer.ts) |
| Plantilla del mail | [`lib/birthday-email-template.ts`](lib/birthday-email-template.ts) |
| Cliente Supabase service role | [`lib/supabase/admin.ts`](lib/supabase/admin.ts) *(ya existía en el repo)* |
| Tabla de logs | [`supabase/birthday_email_logs.sql`](supabase/birthday_email_logs.sql) |
| Schedule del cron | [`vercel.json`](vercel.json) |
| Página de estado (UI) | [`app/(app)/configuracion/mails/page.tsx`](app/(app)/configuracion/mails/page.tsx) |
| Editor de la plantilla (UI) | [`app/(app)/configuracion/mails/plantilla/page.tsx`](app/(app)/configuracion/mails/plantilla/page.tsx) |
| API estado / plantilla | [`app/api/admin/birthday-config/route.ts`](app/api/admin/birthday-config/route.ts) · [`app/api/admin/birthday-template/`](app/api/admin/birthday-template/) |
| Tabla de plantillas + bucket | [`supabase/birthday_email_templates.sql`](supabase/birthday_email_templates.sql) |

> **Ver el estado en la app:** Configuración → **Saludos de cumpleaños**.
> Muestra la programación, el estado de cada casilla Gmail y los últimos
> envíos. La configuración del cron (casillas, CRON_SECRET) se cambia con
> variables de entorno, no desde la UI.
>
> **Editar el mail:** Configuración → Saludos de cumpleaños → **Plantilla
> del mail**. Por empresa: imagen de fondo, asunto y cuerpo con las
> variables `{nombre}` (cumpleañero) y `{denominacion}` (tratamiento,
> ej. "Estimado/a"), color del texto y del panel, y un switch **Activo**.
> Trae preview en vivo.

- **Empresas:** la lista sale de los dos registros — `empresas_api_keys`
  (las del desktop, id → nombre) y `empresas_online_remoto` con
  `habilitada = 1` (las que operan online y son dueñas de los eventos).
  Una empresa nueva en cualquiera de las dos aparece sola en la UI, sin
  tocar código. Se incluyen las online porque la casilla Gmail que se carga
  ahí también es la remitente de los **acuses de inscripción a eventos**
  (`lib/evento-acuse.ts`), y esas empresas no tienen API key.
- **Activo:** el cron solo le manda saludos a las empresas cuya plantilla
  tiene el switch **Activo** en ON. Si está en OFF (o no hay plantilla),
  esa empresa no recibe nada. Es el control de "quién envía".
- **Personas:** se leen de `socios_datos` (no existe una tabla `personas`).
  Se filtran `deleted_at IS NULL` y `mail` / `fecha_nacimiento` no nulos.
- **Copia a la empresa:** cada saludo se envía con copia oculta (BCC) a la
  casilla Gmail de origen, así la empresa recibe en su propia casilla el
  mismo mail que recibió el socio.
- **Idempotencia:** cada envío se registra en `birthday_email_logs`. Si el
  cron corre dos veces el mismo día, los ya enviados se saltean.
- **Zona horaria:** "hoy" se calcula en `America/Montevideo`, no en UTC.
- **29 de febrero:** en años no bisiestos se saluda el 28/2.
- **Credenciales Gmail:** la casilla, la App Password y el nombre del
  remitente se cargan **desde la app** (editor de Plantilla) y se guardan
  en `birthday_email_templates`. Una empresa Activa sin casilla completa
  registra el envío como error hasta que se completen.

## 1. Crear las tablas en Supabase

Supabase Dashboard → **SQL Editor** → pegar y **Run** estos dos scripts
(idempotentes, se pueden correr más de una vez):

1. [`supabase/birthday_email_logs.sql`](supabase/birthday_email_logs.sql) —
   tabla de logs (idempotencia y trazabilidad).
2. [`supabase/birthday_email_templates.sql`](supabase/birthday_email_templates.sql) —
   tabla de plantillas + bucket de Storage `birthday-assets` para las
   imágenes de fondo.

## 2. Activar 2FA y generar la App Password en cada Gmail

Hacer esto **una vez por cada casilla** (una por empresa que vaya a enviar):

1. Iniciar sesión en la cuenta Gmail que va a ser remitente.
2. Activar la **verificación en 2 pasos**:
   <https://myaccount.google.com/signinoptions/two-step-verification>
   (sin 2FA, Google no deja crear App Passwords).
3. Generar una **Contraseña de aplicación**:
   <https://myaccount.google.com/apppasswords>
   - Poner un nombre descriptivo (ej. `ContaSystem - Cumpleaños`).
   - Google devuelve una clave de **16 caracteres**.
4. Esa clave de 16 caracteres se carga **en la app**: Configuración →
   Saludos de cumpleaños → Plantilla del mail → sección **Casilla Gmail**.
   **No** se usa la contraseña normal de la cuenta.

> Si una casilla no es `@gmail.com` sino Google Workspace con dominio propio,
> el procedimiento es el mismo siempre que el admin del Workspace permita
> App Passwords.

## 3. Configurar las variables de entorno en Vercel

Vercel → proyecto → **Settings → Environment Variables** (entorno
**Production**, y Preview si querés probar ahí):

| Variable | Valor |
|---|---|
| `CRON_SECRET` | String random largo. Generarlo con `openssl rand -hex 32`. |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only). |

Las casillas Gmail (usuario, App Password, nombre del remitente) y la hora
de envío **ya no son variables de entorno** — se cargan desde la app y se
guardan en Supabase.

> **`CRON_SECRET` NO va en `vercel.json`.** `vercel.json` se commitea al repo;
> un secreto ahí sería público. Va como variable de entorno. Vercel detecta
> que existe `CRON_SECRET` y automáticamente agrega el header
> `Authorization: Bearer <CRON_SECRET>` a cada invocación del cron — por eso
> el endpoint puede validarlo.

Los `empresa_id` salen de `socios_datos` (son los ids locales del SQLite del
desktop; **no** están en `empresas_online_remoto`). En este proyecto hay dos:

| empresa_id | socios | con mail + fecha_nacimiento |
|---|---|---|
| `0ccaa26a-499b-4375-a3a0-6a7a025edd79` | 1.113 | 300 |
| `4d187283-a9da-4dae-b970-d5e0103016eb` | 1.745 | 767 |

Para confirmarlos vos mismo, en el SQL Editor de Supabase:

```sql
select empresa_id, count(*) as socios
from public.socios_datos
where deleted_at is null and empresa_id is not null
group by empresa_id order by socios desc;
```

Verificá en ContaSystem desktop a qué empresa real corresponde cada id para
asignar el Gmail y el `FROM_NAME` correctos.

Después de cargar las variables, **redeploy** el proyecto para que tomen efecto.

## 4. El schedule del cron

[`vercel.json`](vercel.json) define **dos corridas fijas por día**:

```json
{
  "crons": [
    { "path": "/api/cron/birthdays", "schedule": "0 11 * * *" },
    { "path": "/api/cron/birthdays", "schedule": "30 11 * * *" }
  ]
}
```

`11 UTC` = `08:00 Montevideo` (UTC-3 todo el año, sin horario de verano). La
segunda, 30 minutos después, es la red de contención: si la primera se cortó
por el presupuesto de tiempo del endpoint (`has_more: true` en la respuesta,
ver el comentario de cabecera de `route.ts`), la segunda termina lo que
quedó — sin reenviar lo ya hecho, porque `birthday_email_logs` es la fuente
de idempotencia, no el propio schedule.

Para cambiar el horario hay que editar **ambos** `schedule` de este archivo
y, si corresponde, `HORA_ENVIO_MONTEVIDEO` en
`app/api/admin/birthday-config/route.ts` (sólo texto informativo en la
pantalla de estado — no controla nada), y redeployar.

El cron se activa al hacer deploy en Vercel (requiere plan Pro para más de
un cron, o para crons sub-diarios).

### Tandas y presupuesto de tiempo

El endpoint manda los mails en **tandas de 4 en paralelo** (`BATCH_SIZE`,
`Promise.allSettled` — un mail que tarda o falla no bloquea a los demás de su
tanda) y se corta solo a los **45 segundos** (`TIME_BUDGET_MS`), por debajo
del límite de la función (`maxDuration = 60`). Si se corta, la respuesta trae
`has_more: true` y el log de Vercel lo dice explícito — la corrida de las
08:30 se encarga del resto.

## 5. Probar el endpoint localmente

Levantá el server de desarrollo:

```bash
npm run dev
```

Y llamá al endpoint pasando el `CRON_SECRET` que tengas en `.env.local`. El
endpoint no chequea ninguna hora: en cuanto lo llamás con el secret correcto,
busca a quién saludar y manda. En Windows usá `curl.exe` (el `curl` de
PowerShell es otro comando):

```powershell
curl.exe -H "Authorization: Bearer TU_CRON_SECRET" "http://localhost:3000/api/cron/birthdays"
```

En bash / Mac / Linux:

```bash
curl -H "Authorization: Bearer TU_CRON_SECRET" "http://localhost:3000/api/cron/birthdays"
```

Respuesta esperada:

```json
{ "ok": true, "fecha": "2026-05-22", "found": 0, "sent": 0, "skipped": 0, "errors": [], "has_more": false }
```

- Sin el header o con un secret incorrecto → `401 { "ok": false, "error": "No autorizado" }`.
- Para probar un envío real sin esperar a un cumpleaños, poné temporalmente la
  `fecha_nacimiento` de un socio de prueba con el día y mes de hoy, y marcá su
  empresa como **Activa** en la editora de plantilla.

En producción podés dispararlo manualmente desde
**Vercel → Deployments → … → Crons**, o repitiendo el `curl` contra la URL
desplegada.

## 6. Límite de envío de Gmail

Una cuenta **@gmail.com** gratuita permite enviar **~500 mensajes por día**
(Google Workspace sube a ~2.000). Este cron manda **un mail por cumpleañero**,
y en un día normal hay un puñado de cumpleaños por empresa — muy lejos del
tope. Además cada empresa usa su propia casilla, así que el límite es por
cuenta y no se comparte. **No es un problema para este caso de uso.**

Si en el futuro hubiera cientos de cumpleaños el mismo día (poco probable),
habría que migrar a un proveedor transaccional (Resend, SendGrid). Hoy no
hace falta.

## Monitoreo

Cada ejecución loguea en los logs de Vercel una línea tipo:

```
[cron/birthdays] 2026-05-22 · encontrados=3 enviados=3 salteados=0 errores=0
```

o, si se cortó por el presupuesto de tiempo:

```
[cron/birthdays] 2026-05-22 · encontrados=52 enviados=44 salteados=0 errores=0 · CORTADO POR TIEMPO (has_more) — lo termina la corrida de las 11:30 UTC
```

y devuelve el mismo resumen en el JSON de respuesta (más `has_more`). La
tabla `birthday_email_logs` guarda el detalle fila por fila (incluido
`error_message` cuando un envío falla).
