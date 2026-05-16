# ContaSystem Carga · Design System

> Aesthetic direction: **"Modern Ledger"** — papel cremoso, tinta sobria, ámbar usado como marcador de resaltado. Números siempre monoespaciados. Borrar la línea entre "formulario impreso" y "app moderna".

## 1. Fundamento

- **Tono**: profesional, sereno, no corporativo. Un operador de sucursal debe sentir que está usando una herramienta diaria, no un sistema "empresarial".
- **Memoria**: el sello "Carga Directa", los subrayados ámbar tipo highlighter y los números monoespaciados forman la identidad. Si alguien describe la app sin ver pantallas debería decir "tiene onda papel/ledger".
- **No usar**: gradientes morados, Inter/Roboto/Space Grotesk, sombras difusas tipo Material, glassmorphism, animaciones flotantes "AI".

---

## 2. Paleta

```css
/* Papel y tinta */
--paper:     #fdfcf7;   /* fondo principal — crema cálido */
--paper-2:   #f7f5ed;   /* hover/zona inactiva */
--paper-3:   #ede9da;   /* divisiones internas */
--ink:       #1a1814;   /* texto principal — tinta cálida */
--ink-2:     #4a4640;   /* texto secundario */
--ink-3:     #8c8780;   /* texto terciario / hints */
--line-soft: #d4cfc1;   /* bordes suaves */

/* Marca — ámbar como tinta de marcador */
--amber:       #f59e0b;   /* highlights, botón principal */
--amber-deep:  #b45309;   /* texto sobre amarillo, sellos */
--amber-light: #fef3c7;   /* fondo de badges pending */

/* Estados */
--status-pending:    #b45309;
--status-pending-bg: #fef3c7;
--status-ok:         #15803d;
--status-ok-bg:      #dcfce7;
--status-no:         #b91c1c;
--status-no-bg:      #fee2e2;
```

### Mapeo a `@theme` de Tailwind v4

```css
@import "tailwindcss";

@theme {
  --color-paper:     #fdfcf7;
  --color-paper-2:   #f7f5ed;
  --color-paper-3:   #ede9da;
  --color-ink:       #1a1814;
  --color-ink-2:     #4a4640;
  --color-ink-3:     #8c8780;
  --color-line:      #d4cfc1;

  --color-amber:        #f59e0b;
  --color-amber-deep:   #b45309;
  --color-amber-light:  #fef3c7;

  --color-status-pending:    #b45309;
  --color-status-pending-bg: #fef3c7;
  --color-status-ok:         #15803d;
  --color-status-ok-bg:      #dcfce7;
  --color-status-no:         #b91c1c;
  --color-status-no-bg:      #fee2e2;

  --font-sans:    'IBM Plex Sans', system-ui, sans-serif;
  --font-display: 'Fraunces', serif;
  --font-mono:    'IBM Plex Mono', ui-monospace, monospace;
}
```

Usás `bg-paper`, `text-ink`, `text-amber-deep`, `font-display`, etc. directo.

---

## 3. Tipografía

Tres familias, cada una con un rol claro:

| Familia | Rol | Pesos | Notas |
|---|---|---|---|
| **Fraunces** (serif variable) | Display, títulos de pantalla, nombres de empresa | 400, 500, 600 | Variar `opsz` 144 para headlines, `opsz` 36 para inline. Eje `SOFT` 30–50 para suavizar serifs. |
| **IBM Plex Sans** | Body, formularios, párrafos | 400, 500, 600 | Default. |
| **IBM Plex Mono** | Números, RUT, IDs, labels uppercase, sello | 400, 500 | Siempre `font-variant-numeric: tabular-nums`. |

### Google Fonts

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..700,0..100&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

En Next.js usá `next/font` para auto-hosting:

```ts
// app/fonts.ts
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'

export const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'SOFT'],
  variable: '--font-display',
  display: 'swap',
})

export const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})
```

### Escala de tamaños

| Token | px | rem | Uso |
|---|---|---|---|
| `text-[10px]`–`text-xs` | 10–12 | — | Labels uppercase, RUT, IDs |
| `text-sm`  | 14 | 0.875 | Texto secundario |
| `text-base`| 16 | 1     | Body |
| `text-lg`  | 18 | 1.125 | Body emphasized |
| `text-2xl` | 24 | 1.5   | Sub-headlines de card |
| `text-3xl` | 30 | 1.875 | Headline de card |
| `text-5xl` | 48 | 3     | Página (mobile) |
| `text-6xl` | 60 | 3.75  | Página (desktop) |

### Labels en formularios

Toda label de input usa el patrón `.label-mono`:

```css
font-family: 'IBM Plex Mono';
font-size: 11px;
letter-spacing: 0.14em;
text-transform: uppercase;
color: var(--ink-2);
font-weight: 500;
```

Da una sensación de "formulario impreso oficial" sin caer en cliché corporativo.

---

## 4. Componentes

### Input — línea inferior, no caja

```css
.field {
  background: transparent;
  border: none;
  border-bottom: 1.5px solid var(--ink);
  padding: 12px 0;
  width: 100%;
  font-size: 17px;
  transition: border-color .2s;
}
.field:focus {
  outline: none;
  border-bottom-color: var(--amber-deep);
  border-bottom-width: 2px;
  padding-bottom: 11px;
}
```

> Decisión: el input sin caja se parece a un renglón de planilla impresa. La línea engorda 0.5px en focus en lugar de cambiar de color drásticamente — micro-interacción casi imperceptible pero feedback claro.

### Botón primario — "estampado"

```css
.btn-primary {
  background: var(--amber);
  color: var(--ink);
  font-weight: 600;
  padding: 14px 24px;
  min-height: 48px;       /* touch target */
  border-radius: 4px;
  border: 1.5px solid var(--ink);
  box-shadow: 3px 3px 0 var(--ink);   /* sombra HARD, no blur */
  transition: all .12s ease-out;
}
.btn-primary:hover {
  transform: translate(-1px, -1px);
  box-shadow: 4px 4px 0 var(--ink);
}
.btn-primary:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 var(--ink);
}
```

> La sombra dura (sin blur) es la firma visual. El botón se siente "presionado" físicamente al hacer click — el movimiento simula un sello bajando.

### Badge de estado

Pill con bullet de color + label en mayúsculas mono:

```html
<span class="badge badge-pending">Pendiente</span>
<span class="badge badge-imported">Importado</span>
<span class="badge badge-rejected">Rechazado</span>
```

```css
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border-radius: 999px; font-family: 'IBM Plex Mono'; font-size: 10.5px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; }
.badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
```

### Card

```css
.card {
  background: white;
  border: 1px solid var(--line-soft);
  border-radius: 16px;
}
```

Padding interno: `p-6 lg:p-8` (24px → 32px en desktop). Generoso, no comprimido.

### Resaltado "highlighter" sobre palabra clave

```css
.hl { position: relative; display: inline-block; isolation: isolate; }
.hl::after {
  content: '';
  position: absolute;
  left: -4px; right: -4px;
  bottom: 0.08em;
  height: 0.55em;
  background: var(--amber);
  opacity: 0.40;
  border-radius: 6px;
  transform: rotate(-0.7deg) skewX(-3deg);  /* trazo "humano" */
  z-index: -1;
}
```

Usar **una vez por pantalla**. Sobre una palabra que comunica la intención: "Iniciar **sesión**", "Elegí tu **empresa**", "Cargá tu **factura**".

### Sello visual (decorativo, solo login)

```html
<div class="stamp">
  <div class="stamp__top">Modalidad</div>
  <div class="stamp__main">Directa</div>
  <div class="stamp__bot">v 1 · 2026</div>
</div>
```

Decorativo, no clickable. Da identidad sin sobrecargar.

### Empresa card

Patrón visual: borde izquierdo ámbar de 4px que engorda a 8px en hover. Comunica "click acá para entrar" sin necesidad de un botón explícito.

### Filas tipo ledger

Cada comprobante en la lista usa grid `1fr auto`:
- Izquierda: ID en mono pequeño + badge → debajo plantilla en Fraunces → debajo contacto+fecha en sans gris.
- Derecha: monto en mono grande + moneda en mono mini.

Separador entre filas: `perforated` (línea punteada estilo recibo térmico).

### Pill group (selector de moneda)

```html
<div class="pill-group">
  <button class="pill" aria-pressed="true">UYU</button>
  <button class="pill" aria-pressed="false">USD</button>
  <button class="pill" aria-pressed="false">EUR</button>
</div>
```

El pill activo es ink/paper, el resto transparente. Toggle binario claro.

---

## 5. Layout

### Grid responsive

| Breakpoint | Login | Empresa | Principal |
|---|---|---|---|
| **< 768 (mobile)** | Stack vertical, form al ancho | Centered, max 100% | Tabs "Cargar" / "Últimos 20" |
| **≥ 768 (md)** | Split 50/50 | Centered, max-w-2xl | Tabs todavía (transición) |
| **≥ 1024 (lg)** | Split 40/60 (hero más chico) | Centered, max-w-2xl | Grid 5/7 (form / lista) |

### Espaciado vertical

- Entre secciones: `space-y-8` (32px) o `space-y-7` (28px) en form.
- Padding interno de cards: `p-6 lg:p-8`.
- Padding de página: `px-5 md:px-8 lg:px-10`.

### Touch targets

**Mínimo 44×44 px** para cualquier botón en mobile. El botón primary tiene `min-height: 48px`. Los pills tienen padding generoso (~38px alto efectivo).

---

## 6. Motion

Una sola técnica: **stagger reveal** al cargar pantalla, con `animation-delay` escalonado.

```css
@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.rise > * { animation: rise .5s cubic-bezier(.2,.8,.2,1) both; }
.rise > *:nth-child(1) { animation-delay: .04s; }
.rise > *:nth-child(2) { animation-delay: .10s; }
.rise > *:nth-child(3) { animation-delay: .16s; }
/* ... hasta el 7 */
```

**No agregar** animaciones de hover sobre cards, scroll-parallax, ni "fade in on scroll". El stagger inicial + las micro-transiciones de focus/hover en botones e inputs son suficientes.

---

## 7. Texturas y detalles

### Grano de papel (atmosfera)

Aplicar `.grain` a superficies grandes cremosas (panel hero del login, fondo del selector de empresa). Es un SVG `feTurbulence` con `mix-blend-mode: multiply` al 5% de opacidad. Casi imperceptible pero da el "feel" papel.

### Perforaciones

`.perforated` = línea punteada horizontal. Usar como separador sutil entre secciones de info (tipo ticker de recibo térmico):
- Debajo del brand en login
- Entre filas del ledger
- Footer de cards de listado

---

## 8. Reglas de oro

1. **Los números siempre en mono.** RUT, importes, IDs, fechas — `font-mono` + `tabular-nums`.
2. **Una sola palabra resaltada por pantalla.** El `.hl` se queda sin impacto si se usa en exceso.
3. **Sombras hard, no blur.** Todas las sombras son de offset puro (`Xpx Ypx 0 color`). Si querés profundidad, usá borde y/o bg, no blur.
4. **Ámbar = acción o alerta.** Nunca decorativo plano (excepto el sello del login).
5. **Mobile: botón principal sticky al fondo si el form es largo.** Operador con celular en mano no debería buscar el botón.
6. **No mezclar pesos de Fraunces.** Cada componente tiene su peso definido (400 default, 500 emphasis, 600 raro). Pesos arbitrarios rompen la sobriedad.
7. **No usar Fraunces para body largo.** Solo headings y nombres de empresa. Body siempre IBM Plex Sans.

---

## 9. Inspiraciones

- Recibos térmicos de almacén uruguayo (perforaciones, tabular nums, sobrios)
- Ledgers contables de los '60 (papel cremoso, tinta cálida)
- Editoriales modernas tipo *The New York Times Cooking* (Fraunces + sans combinación)
- Apps tipo Linear/Vercel (precisión espacial) — pero **sin** su tipografía genérica.
