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

## Estructura

```
contasystem-web-carga/
├── app/
│   ├── layout.tsx              # fuentes + Toaster
│   ├── globals.css             # tokens Tailwind v4 + utilidades (.field, .btn-primary, .badge…)
│   ├── page.tsx                # redirect → /login o /empresa según sesión
│   ├── login/page.tsx          # signIn Supabase
│   ├── empresa/page.tsx        # selector + localStorage
│   └── carga/page.tsx          # form + lista últimos 20
├── components/
│   ├── Header.tsx              # header persistente con dropdown user
│   ├── Highlight.tsx           # subrayado ámbar (una palabra por pantalla)
│   └── Stamp.tsx               # sello decorativo (solo login)
├── lib/
│   ├── format.ts               # formato uruguayo de números/fechas
│   ├── types.ts                # tipos TS de tablas Supabase
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
