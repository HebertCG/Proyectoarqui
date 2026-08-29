# ADR-004 — Stock offline: replica local con descuento optimista

**Estado:** Aceptado · 2026-08-29
**Cierra:** V-01 · **Habilita:** RNF-01, RF-SYNC-05
**Servicios afectados:** `Inventario.Service`, `Sincronizacion.Utility`, terminal POS

## Contexto

`Inventario.Service` vive en la nube, pero RNF-01 exige que todas las funciones locales operen al 100% sin
internet, y el flujo de venta necesita consultar disponibilidad al agregar un producto al ticket. Esas dos
cosas son incompatibles sin una copia local. El diseno previo no lo declaraba.

## Decision

**El terminal mantiene una replica local del stock**, refrescada en cada sincronizacion (pull).

| Estado | Comportamiento |
| :--- | :--- |
| **Online** | Consulta a `Inventario.Service`: dato autoritativo |
| **Offline** | Lee la replica local y muestra la fecha del ultimo refresco |

Al vender offline: se descuenta de la replica local y se encola el evento en `sync_outbox`.

Al reconectar: `Inventario.Service` reconcilia. Si hubo **sobreventa** (se vendio mas de lo que habia),
se emite una **alerta**, no un bloqueo: la venta ya ocurrio fisicamente y el sistema no puede deshacerla.

**La nube es la autoridad.** La replica local es cache, nunca fuente de verdad. Coherente con el
reencuadre SOA de CLAUDE.md §3: SQLite es cache del consumidor, no la base de un servicio.

## Alternativa descartada

**Vender offline sin consultar stock.** Mas simple, sin replica ni reconciliacion. Se descarto porque deja
al cajero vendiendo a ciegas, sin poder responder si queda producto, que es una pregunta cotidiana en
mostrador.

## Consecuencias

- El contrato de sincronizacion incluye pull de stock, no solo de catalogo y precios.
- La UI muestra la antiguedad del dato de stock cuando opera offline.
- El riesgo de sobreventa es bajo con una sola caja: no hay escritura concurrente sobre el mismo dato.
  Con varias cajas el riesgo crece y exige el hub local de W-03.
- La replica local guarda solo cantidad por SKU, no el Kardex completo: el alcance de inventario en este
  proyecto es parcial (requerimientos §3).
