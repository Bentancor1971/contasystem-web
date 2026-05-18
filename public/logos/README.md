# Logos de medios de pago

Los archivos SVG en este directorio son **placeholders** con los colores aproximados de cada marca. Reemplazalos por los logos oficiales cuando los tengas disponibles.

## Convención de nombres

El componente [HaberLogo](../../components/HaberLogo.tsx) resuelve cada logo a partir de `logo_key`, calculado en el desktop al hacer push de plantillas:

- **Tarjetas**: se deriva del campo `sello` (`Visa` → `visa.svg`, `Mastercard` → `mastercard.svg`, `OCA` → `oca.svg`, etc.). Si no hay sello, cae al `emisor`.
- **Bancos**: se deriva del `nombre` del banco (`BBVA $` → `bbva.svg`, `Itaú USD` → `itau.svg`, `BROU` → `brou.svg`).
- **Efectivo**: `cash.svg` (no obligatorio, hay fallback a ícono Wallet).

## Fallback

Si no existe el SVG para una `logo_key`, el componente renderiza un ícono genérico de Lucide:
- `CreditCard` para tarjetas
- `Landmark` para bancos
- `Wallet` para efectivo

## Agregar un logo nuevo

1. Dropear el archivo SVG en este directorio.
2. Si la `logo_key` no encaja con el filename (ej. el banco es "Banco República" pero querés que use `brou.svg`), agregar el alias al mapa `LOGOS` en [HaberLogo.tsx](../../components/HaberLogo.tsx).
