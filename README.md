# ContaSystem Carga

Web app Next.js 16 + Supabase para que operadores de sucursal carguen comprobantes (facturas de compra, recibos de cobranza) que luego se importan en ContaSystem desktop.

> **Diseño:** "Modern Ledger" — ver [`design/DESIGN_SYSTEM.md`](design/DESIGN_SYSTEM.md) para tokens, tipografía y componentes.

## Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind v4** con `@theme` en `app/globals.css`
- **Supabase Auth + DB** vía `@supabase/ssr` (server) + `@supabase/supabase-js` (browser)
- Fuentes: **Fraunces** (display), **IBM Plex Sans** (body), **IBM Plex Mono** (números) — todas vía `next/font`
- **lucide-react** para íconos, **react-hot-toast** para feedback

## Pre-requisitos

1. Proyecto Supabase con los schemas aplicados:
   - `01_schema.sql` (sync de socios — define `user_grupos`, `user_empresas`)
   - `05_comprobantes_online.sql` (esta feature — tablas `*_remoto` + RPCs + RLS)
   - Ambos archivos viven en `../contasystem-desktop/docs/supabase/`.

2. Al menos una empresa con **`permite_comprobantes_online = 1`** en SQLite local.

3. El usuario Supabase (operador o contador) tiene que estar asignado en `public.user_empresas` (o `public.user_grupos`) para las empresas que va a ver.

4. Catálogos subidos desde ContaSystem desktop:
   - Sidebar → **Sincronización** → sección **"Integración Online de Comprobantes"** → botón **"Subir catálogos a la web"**.

## Setup local

```bash
cd contasystem-web-carga
npm install

# Copiá las credenciales del proyecto Supabase (Project Settings → API)
cp .env.local.example .env.local
# Editá .env.local con NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY

npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000) — redirige a `/login`.

## Flujo

1. **`/login`** — email/password (Supabase Auth).
2. **`/empresa`** — selector de empresas habilitadas:
   - Si el user tiene **1 sola**, salta directo a `/carga`.
   - Si tiene **varias**, elige una. La elección se persiste en `localStorage` (`cs-carga-empresa-id`) y en sesiones siguientes salta directo.
3. **`/carga`** — pantalla principal:
   - Form: plantilla, contacto (opcional), fecha, moneda, monto **total con IVA**, descripción.
   - Lista "Últimos 20" con estados `pendiente` / `importado` / `rechazado`.
   - Cargar dispara RPC `upsert_comprobante_web` → fila nueva con numeración `WEB-{empresa}-{YYYY}-{seq}`.

## Asistencia por QR (check-in de eventos)

Reemplaza el pasaje de lista a mano en la puerta. El **desktop** emite un token
opaco por inscripción, arma el QR y lo manda en el recibo de cobro o en la
confirmación de inscripción; la **web** lo escanea.

**Requisitos SQL** (Supabase → SQL Editor), en este orden:

1. `34_asistencia_qr.sql` — vive en `../contasystem-desktop/docs/supabase/`.
   Crea `entradas_remoto` y los RPCs `buscar_entrada` /
   `marcar_asistencia_entrada`.
2. [`supabase/desmarcar_asistencia.sql`](supabase/desmarcar_asistencia.sql) —
   agrega `desmarcar_asistencia_entrada` y la traza de la desmarca. Sin esto
   todo funciona salvo el botón de desmarcar, que responde 501 diciendo qué
   falta correr. En el desktop este archivo va como `35_desmarcar_asistencia.sql`.

También hace falta `SUPABASE_SERVICE_ROLE_KEY`: los RPCs son `SECURITY DEFINER`
y la tabla no está expuesta a `anon`.

| Ruta | Sesión | Qué hace |
|---|---|---|
| `/a/{token}` | no | Muestra la entrada (evento, nombre, estado) y re-dibuja el QR. **No marca nada.** |
| `/checkin` | sí | Escáner del staff: cámara → marca asistencia → resultado a pantalla completa. Pestaña **Manual** para pasar lista sin cámara. |

### La regla que define el diseño

**Abrir la URL del QR NO marca asistencia.** La marca la hace personal del
evento desde `/checkin`, autenticado. Si bastara con abrir el link, cualquiera
se autoregistraría desde su casa — y un preview de link de WhatsApp o Gmail lo
dispararía solo. Por eso `/a/{token}` usa `buscar_entrada`, que es de sólo
lectura, y nunca `marcar_asistencia_entrada`.

### Resultados del escaneo

| Resultado | Pantalla | Cuándo |
|---|---|---|
| `ok` | Verde | Primer ingreso. |
| `ya_presente` | Ámbar, "ya ingresó a las HH:MM" | Reescaneo, o check-in ya hecho a mano en el desktop. Suele ser alguien intentando entrar dos veces. |
| `anulada` | Rojo | La inscripción se dio de baja. |
| `no_encontrada` | Rojo | Token inexistente, de otra empresa, o QR ajeno. |
| `otro_evento` | Rojo | Entrada válida pero de otro evento de la misma empresa (agregado de la web, no del SQL). |

El marcado es idempotente: reescanear no pisa la hora del primer ingreso.
`asistio_por` guarda el email de la **sesión** del operador, nunca un valor que
venga del navegador.

### Control manual (pestaña "Manual")

El respaldo sin cámara, y también la forma de pasar lista a mano. Marca por el
mismo endpoint que el escáner, así el resultado y la traza en `asistio_por` son
idénticos.

- **Filtro por rol**, con **Asistente por defecto** — es el rol de casi toda la
  gente que se controla en la puerta. Los chips salen de los roles realmente
  presentes en el evento (el catálogo lo define el desktop en `roles_evento`:
  arranca con Asistente / Expositor / Organización). "Todos" saca el filtro.
  Una entrada **sin rol asignado cuenta como asistente**, igual que en el
  desktop; si no, la mayoría no aparecería en la vista por defecto.
- **Orden por apellido o por nombre**, con apellido por defecto.
- **Desmarcar**: el badge "Presente HH:MM" es el botón de deshacer. Pide
  confirmación en dos toques y muestra quién había marcado. No está en el
  escáner a propósito: un QR que quedó enfrente no puede borrar un ingreso.

Al desmarcar quedan `desmarcada_at` / `desmarcada_por` con la traza, y la
corrección es firme: `upsert_entrada` fue modificado para que un push posterior
del desktop no vuelva a marcar a la persona (antes, `COALESCE(existente,
entrante)` la resucitaba en el próximo reenvío de recibo). Una marca
genuinamente nueva —un reescaneo después de la desmarca— sí entra.

> **Pendiente del lado desktop:** `pullAsistenciasQR` baja sólo lo marcado y
> "nunca desmarca", así que una desmarca hecha en la web **no llega al
> desktop** todavía: la corrección queda firme en la nube pero la base local
> sigue con la persona presente. El SQL necesario del lado desktop está
> documentado al pie de
> [`supabase/desmarcar_asistencia.sql`](supabase/desmarcar_asistencia.sql).

`entradas_remoto` guarda un único `nombre_completo` armado como
"NOMBRE APELLIDO", así que para ordenar por apellido hay que deshacer esa unión.
**No se parte con heurística**: "MARÍA ELISA DE LEÓN" y "ANA GONZÁLEZ ROSSI"
tienen la misma forma y el corte va en lugares distintos. Se resuelve contra la
ficha del socio (`socios_datos`, que sí tiene los campos separados) usando el
documento de la entrada como clave. Quien no tenga ficha se muestra con el
nombre completo tal cual y se ordena por él.

### Notas de uso en la puerta

- **La cámara exige HTTPS** (o `localhost`). En `http://` no hay visor —
  el control manual sigue funcionando.
- **Anti-rebote** de 3 s por token, contados desde que se cierra el resultado.
- **Sonido distinto por caso** + vibración: en la práctica no se mira la
  pantalla en cada persona.
- Si falla la red, se dice explícitamente y se ofrece reintentar. Nunca hay
  verde sin confirmación del servidor.

### Lo que la web NO hace

No crea, no borra ni reconcilia entradas: el desktop es dueño del alta y del
estado. Lo único que la web escribe es la asistencia — `asistio_at` /
`asistio_por` / `asistio_origen` y la traza `desmarcada_*` — y siempre vía
`marcar_asistencia_entrada` o `desmarcar_asistencia_entrada`.

## Estructura

```
contasystem-web-carga/
├── app/
│   ├── layout.tsx              # fuentes + Toaster
│   ├── globals.css             # tokens Tailwind v4 + utilidades (.field, .btn-primary, .badge…)
│   ├── page.tsx                # redirect → /login o /empresa según sesión
│   ├── login/page.tsx          # signIn Supabase
│   ├── empresa/page.tsx        # selector + localStorage
│   ├── carga/page.tsx          # form + lista últimos 20
│   ├── a/[token]/page.tsx      # vista PÚBLICA de una entrada (destino del QR)
│   ├── (app)/checkin/          # escáner del staff (cámara + control manual)
│   └── api/checkin/            # eventos · marcar · desmarcar · entradas
├── components/
│   ├── Header.tsx              # header persistente con dropdown user
│   ├── Highlight.tsx           # subrayado ámbar (una palabra por pantalla)
│   └── Stamp.tsx               # sello decorativo (solo login)
├── lib/
│   ├── format.ts               # formato uruguayo de números/fechas + hora Montevideo
│   ├── types.ts                # tipos TS de tablas Supabase
│   ├── entradas.ts             # RPCs de asistencia (server-only)
│   ├── entradas-types.ts       # tipos de entradas/check-in (client-safe)
│   ├── checkin-token.ts        # URL del QR o token pelado → token
│   ├── checkin-auth.ts         # scope por empresa de /api/checkin/*
│   ├── qr.ts                   # QR en SVG (server-only)
│   └── supabase/
│       ├── client.ts           # createBrowserClient
│       ├── server.ts           # createServerClient (Server Components)
│       └── middleware.ts       # updateSession para middleware.ts
├── middleware.ts               # gate de auth global
├── design/                     # ← mockup HTML, design system doc, primitivos JSX
└── .env.local.example
```

## Deploy

### Vercel

1. Push a un repo de GitHub.
2. En Vercel: **Add New Project → Import**.
3. Variables de entorno: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy.

## Troubleshooting

| Problema | Causa probable |
|---|---|
| "No tenés empresas asignadas" en `/empresa` | Falta entrada en `public.user_empresas` para tu UUID + empresa_id |
| Plantillas vacías en `/carga` | El contador no subió catálogos todavía (ContaSystem → Sync → "Subir catálogos a la web") |
| `new row violates row-level security policy` al guardar | El user no tiene acceso a la empresa que viene en el payload (RLS) |
| Error 500 en RPC | La empresa o la plantilla referenciada no existe en remoto |
| `/checkin` no abre la cámara y avisa de HTTPS | La página está servida por `http://`. `getUserMedia` sólo corre en contexto seguro: usar la URL de Vercel o `localhost` |
| `/checkin` muestra "todavía no hay entradas con QR emitidas" | El desktop no subió ninguna entrada para esa empresa, o el evento es más viejo que la ventana del selector (`?dias=`, default 60) |
| `Could not find the function public.buscar_entrada` | Falta correr `34_asistencia_qr.sql` |
| "Falta correr supabase/desmarcar_asistencia.sql" al desmarcar | Justamente eso: correr ese archivo en el SQL Editor |
| Se desmarcó en la web pero el desktop la sigue viendo presente | Esperado por ahora: el pull del desktop todavía no baja las desmarcas (ver el pie de `supabase/desmarcar_asistencia.sql`) |
| Todo escaneo da `no_encontrada` | La empresa activa de la web no es la dueña de esas entradas (el marcado está scopeado por empresa) |
| Falta gente en la lista Manual | El filtro está en un rol. Por defecto muestra sólo **Asistente**: tocar **Todos** |
| Alguien aparece sin "APELLIDO, Nombre" al ordenar por apellido | Su documento no resuelve contra `socios_datos` (sin ficha, o documento distinto). Se muestra el nombre completo tal cual |

Si los problemas persisten, revisar el SQL Editor de Supabase y verificar:

```sql
-- Tenants asignados al user logueado
SELECT 'empresa' AS tipo, empresa_id AS id FROM public.user_empresas WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tu@email.com')
UNION ALL
SELECT 'grupo'   AS tipo, grupo_id   AS id FROM public.user_grupos   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tu@email.com');

-- Catálogos visibles
SELECT * FROM public.empresas_online_remoto;
SELECT id, nombre_razon_social, tipo FROM public.contactos_remoto;
SELECT id, nombre, iva_porcentaje, activo FROM public.plantillas_remoto;
```
