# Cambio de categoría en inscripciones web — pedido para el desktop

Cuando alguien se inscribe a un evento desde la web elige una **categoría**, y esa
categoría sale del mismo catálogo que la categoría de socio de la ficha
(`categorias_socio_remoto`). Si elige una distinta a la que tiene, eso le llega al
desktop como una propuesta de actualización de ficha — y en un socio activo la
categoría define la **cuota social**. No puede aplicarse sola ni pasar
desapercibida entre los cambios de contacto.

Este documento es el pedido de desarrollo del lado desktop (pantalla **Validar
inscripciones web**) y deja anotado qué hace la web para acompañarlo.

## Regla de negocio acordada

- Si el cambio se aplica, la categoría nueva **rige desde la próxima generación
  de cuotas**.
- **Las cuotas ya generadas no se tocan.** Si hay que corregir el período en
  curso, es manual y por fuera de este flujo.
- Por eso **no hace falta fecha de vigencia** en ningún lado.
- En socios que no generan cuota, aplicar el cambio es sólo una actualización de
  ficha.

## Contrato de datos (ya existe, salvo lo marcado)

| Dato | Dónde está |
|---|---|
| Categoría elegida en la web | `inscripciones_evento_remoto.categoria_id` + `.categoria_nombre` |
| Categoría del socio **hoy** | ficha local, o `socios_categoria_remoto` (`empresa_id` + `socios_datos.documento_hash`) |
| Categoría de la ficha **al inscribirse** | `inscripciones_evento_remoto.categoria_ficha_id` + `.categoria_ficha_nombre` — **columnas nuevas, ver abajo** |
| A quién aplica | `inscripciones_evento_remoto.socio_id` (o `documento`) |
| Catálogo de categorías | `categorias_socio_remoto` — mismos ids en las dos puntas |

> ⚠️ **No matchear por `documento_hash`.** El de la inscripción es un SHA-256 que
> calcula la web y **no coincide** con el de `socios_datos` (verificado: no
> coincide en ninguna fila). Resolver siempre por `socio_id` o por `documento`.

### Columnas nuevas pedidas

```
ALTER TABLE inscripciones_evento_remoto
  ADD COLUMN categoria_ficha_id     uuid NULL,
  ADD COLUMN categoria_ficha_nombre text NULL;
```

Nombre elegido para que quede pegado a `categoria_id` / `categoria_nombre` (mismo
prefijo, y `_ficha` dice de quién es). Se guarda también el **nombre** por la
misma razón por la que la tabla ya guarda `categoria_nombre` al lado del id: si
mañana la categoría se renombra o se borra del catálogo, el historial sigue
siendo legible.

Las escribe la web en el insert de la inscripción, con la categoría que el socio
tenía en ese momento. **Semántica del null:** "no hay con qué comparar" —
inscripción anterior a esta entrega, persona fuera del padrón, o socio sin
categoría en la ficha. Con null, el desktop se comporta como hoy.

## Qué hay que construir

### 1. Detectar el cambio

Hay cambio de categoría cuando `categoria_id` no es null y difiere de la
categoría actual del socio. Tres casos con trato distinto:

| Caso | Cómo llega | Trato |
|---|---|---|
| Cambio real | ficha tiene categoría y es otra | aviso completo (punto 2) |
| Alta de dato | el socio no tiene categoría en la ficha | no es cambio; severidad baja, puede ir con el resto |
| Categoría libre ("Otros") | `categoria_id = null` y sólo texto en `categoria_nombre` | **no aplicable a la ficha**: informativo, sin tilde |

Para "Otros" queda por definir si además se ofrece dar de alta la categoría en el
catálogo. Sugerencia: fuera de esta entrega.

### 2. Avisar y pedir confirmación manual

- **Bloque separado** de los cambios de contacto, con tratamiento visual de
  advertencia. No un tilde más en la misma lista.
- **Destildado por defecto**, siempre. Los de contacto pueden seguir como están.
- **Confirmación propia**: que aplicarlo no salga del mismo botón "Confirmar" que
  impacta la inscripción. Un solo clic que aplique teléfono y categoría junta es
  la forma de cambiarle la cuota a alguien sin querer.
- **Consecuencia escrita**, según el socio:
  - genera cuotas → *"Cambia la cuota social a partir de la próxima generación.
    Las cuotas ya generadas no se modifican."*
  - resto → *"Actualiza la ficha. No afecta cuotas."*
- **Si se rechaza la inscripción**, no se aplica ningún cambio de ficha.
- **Idempotente**: revalidar o reimportar la misma inscripción no vuelve a
  aplicar.
- **Traza**: quién aplicó, cuándo, categoría anterior → nueva, y el id de la
  inscripción que lo originó. Es un cambio con efecto sobre plata.

### 3. Cubrir la carrera contra la ficha (dos partes)

El panel compara una **foto congelada** (la inscripción, del día que la persona
se anotó) contra un dato **vivo** (la ficha de hoy). Entre los dos momentos
pueden pasar semanas, y la ficha se edita por su cuenta.

El caso que hace daño:

```
Lunes      Web: la ficha dice Licenciado y la persona elige Licenciado
           — NO cambió nada.
Miércoles  Desktop: llama, se recibió, le actualizan la ficha a Doctor.
Viernes    Validás: el panel compara Licenciado (elegido) con Doctor (ficha hoy)
           y propone  Categoría  Doctor → Licenciado
```

Ese aviso es idéntico a un cambio real, pero está proponiendo **deshacer** la
corrección del miércoles. Al revés (la persona cambió y alguien ya lo aplicó a
mano) es inofensivo: coinciden y no se muestra nada.

**3a. Clasificar con la foto de la ficha** (usa las columnas nuevas):

| Eligió vs ficha del día | Eligió vs ficha de hoy | Qué es | Qué hacer |
|---|---|---|---|
| distinta | distinta | cambio deliberado | proponerlo con el aviso |
| **igual** | **distinta** | **la ficha se movió después** | **no proponerlo** (o aparte, sin tilde) |
| distinta | igual | ya aplicado por otra vía | nada |
| — (null) | distinta | sin dato para comparar | comportamiento actual |

**3b. Re-chequear al aplicar:** guardar el valor de la ficha con el que se armó
el panel y releerlo en el momento de aplicar. Si cambió, no aplicar a ciegas:
avisar que la ficha se modificó mientras se revisaba. Esto cubre la ventana
corta (dos operadores a la vez), que 3a no ve.

## Casos de prueba

Datos que ya están en la base de pruebas:

| Inscripción | CI | Eligió | Ficha | Esperado |
|---|---|---|---|---|
| INS-0007 | 1000003 | Doctor | Licenciado | Aviso, destildado, menciona cuota (activo, 3 cuotas pendientes) |
| INS-0003 | 1000002 | Licenciado | Doctor | Ídem, en sentido inverso |
| INS-0005 | 1000000 | Licenciado | Licenciado | Sin aviso de categoría |
| INS-0004 | 41234563 | Doctor | Doctor | Sin aviso |

Para 3a hay que fabricar el caso: inscribirse eligiendo la categoría de la ficha,
cambiar la ficha a mano en el desktop, y recién ahí validar. No tiene que
proponer la reversión.

## Qué hace la web

Hecho:

- Avisa a la persona **en el momento de elegir** si la categoría no coincide con
  la de su ficha, con el nombre de las dos y la aclaración de que la ficha no se
  cambia sola ([`app/e/[slug]/EventoForm.tsx`](app/e/[slug]/EventoForm.tsx) —
  `categoriaFicha` / `categoriaCambiada`). No avisa cuando la categoría de la
  ficha no era elegible en ese evento: ahí elegir otra no es una decisión suya.
- Lista el cambio de categoría (y el de teléfono) en el acuse por mail, junto a
  nombre, apellido y email
  ([`app/api/eventos/[slug]/inscribir/route.ts`](app/api/eventos/[slug]/inscribir/route.ts)).

Pendiente, atado a este pedido:

- Escribir `categoria_ficha_id` / `categoria_ficha_nombre` en el insert. El dato
  ya está resuelto ahí mismo (`resolverParticipante` devuelve la categoría del
  socio), es una línea. **No se puede hacer antes de que existan las columnas**:
  el insert entero fallaría.

## Config relacionada

`permitir_categoria_otros` está en **true** en los eventos actuales. Si la
categoría va a tener peso sobre la cuota, conviene apagarlo en los eventos donde
la categoría mapea al catálogo de socios: la categoría libre llega sin
`categoria_id` y no es aplicable a la ficha. Se cambia desde Configuración →
Eventos, sin tocar código.
