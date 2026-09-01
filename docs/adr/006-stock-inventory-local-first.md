# ADR-006 — Stock: `Inventory Service` también es local-first

**Estado:** Aceptado · 2026-09-01
**Reemplaza:** [ADR-004](004-stock-offline.md) · **Cierra:** V-01 · **Habilita:** RNF-01, RF-SYNC-05
**Servicios afectados:** `Inventory Service`, `Sales & Customer Service`

## Contexto

ADR-004 asumía que `Inventory Service` vivía únicamente en la nube, y de ahí derivaba la necesidad de que
`Sales & Customer Service` mantuviera una réplica local del stock con descuento optimista y reconciliación
posterior.

**Esa premisa era falsa.** El documento base la contradice en dos lugares:

- **§6** — `Inventory Service` · ¿Requiere internet? → *"No (opera local, sincroniza cuando hay conexión)."*
- **§2.2** — lista *"Descuento de stock local — Kardex del almacén asociado a esa caja/local"* entre lo que
  funciona **100% offline**.

Es decir: el stock nunca dependió de internet. No hacía falta inventar una réplica dentro de otro servicio.

## Decision

**`Inventory Service` se despliega local-first, igual que `Sales & Customer Service`**, con su propia base de
datos local en el terminal y su propia sincronización hacia la nube.

| Aspecto | Decisión |
| :--- | :--- |
| **Despliegue** | Local en el terminal + réplica cloud. Mismo modelo offline-first. |
| **Base de datos** | **Propia y separada** de la de `Sales & Customer Service` (P5 se cumple: son dos servicios del inventario). |
| **Aislamiento** | El stock es **por local/almacén**, sin sincronización cruzada entre locales (documento base §2.5, §5.2). |
| **Comunicación** | `Sales & Customer Service` consulta y descuenta stock **por contrato**, nunca leyendo sus tablas. |
| **Sincronización** | Cada servicio empuja su propio `sync_outbox` a la nube de forma independiente. |

**No hay réplica de stock dentro de `Sales & Customer Service`.** Preguntar disponibilidad es una llamada a
otro servicio; que ese servicio esté desplegado en la misma máquina es un detalle de despliegue, no de
arquitectura.

## Por qué no hace falta reconciliar sobreventas

El negocio opera con **una sola sucursal y una sola caja** (documento base §0, decisión 4). Con un único
origen de escritura sobre el stock de ese local no existe escritura concurrente, y por tanto **no hay
sobreventa que reconciliar**. Esa es la razón por la que el diseño base pudo prescindir de una estrategia de
resolución de conflictos entre nodos.

Si el negocio pasa a **dos o más cajas simultáneas en el mismo local**, esto cambia: dos cajas descontando
del mismo almacén sí generan concurrencia. Ese es exactamente el escenario que el documento base deja abierto
en su §4 (hub local en LAN vs. cajas independientes) y que queda registrado como vacío **V-07**.

## Alternativa descartada

**Réplica de stock dentro de `Sales & Customer Service` con descuento optimista** (la de ADR-004). Se descarta
porque:

1. Parte de una premisa falsa — `Inventory` sí opera offline.
2. Duplica en un servicio un dato que es autoridad de otro, lo que **debilita P5** (autonomía) en vez de
   reforzarlo.
3. Introduce reconciliación y alertas de sobreventa para resolver un problema que, con una sola caja, no
   existe.

## Consecuencias

- `Inventory Service` sube a **Nivel N2** con requisito de despliegue local-first, no solo cloud.
- `Sales & Customer Service` **no guarda stock**. Consulta y descuenta por contrato.
- La comunicación entre ambos, estando en la misma máquina, plantea una pregunta de despliegue que hay que
  resolver en el diseño del ESB: si el bus corre también local o si esta interacción es una excepción
  documentada. **Se registra como pregunta abierta del diseño del ESB (APF2).**
- El alcance de inventario sigue siendo parcial para el flujo de venta (descuento, reingreso, consulta), tal
  como ya documentaban los requerimientos §3.
