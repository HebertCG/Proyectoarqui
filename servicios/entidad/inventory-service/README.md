# Inventory Service

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"

**Servicio de entidad** · Nivel **N2** · Base propia: SQLite local + `svc_inventory` (réplica cloud)

---

## Propósito

Autoridad del stock. Mantiene el Kardex en tiempo real, descuenta al vender, reingresa al
devolver y alerta cuando un producto baja del mínimo.

### Objetivo estratégico que soporta

> *Que el negocio no venda lo que no tiene, ni deje de reponer lo que se agota.*

---

## También es local-first

**Este servicio no vive solo en la nube.** El documento base es explícito:

- **§6** — ¿Requiere internet? → *"No (opera local, sincroniza cuando hay conexión)."*
- **§2.2** — el descuento de stock local figura entre lo que funciona **100% offline**.

Se despliega junto al terminal, con su propia base local y su propia sincronización. Que corra
en la misma máquina que `Sales & Customer Service` es un **detalle de despliegue**, no de
arquitectura: siguen siendo dos servicios con bases separadas que se hablan por contrato.

> Esto corrige [ADR-004](../../../docs/adr/004-stock-offline.md), que asumía lo contrario y
> derivaba una réplica de stock innecesaria dentro de otro servicio. Ver
> [ADR-006](../../../docs/adr/006-stock-inventory-local-first.md).

### Sin reconciliación de sobreventa

Con **una sola caja** no hay escritura concurrente sobre el stock del local, así que no existe
sobreventa que reconciliar. Si el negocio pasa a 2+ cajas simultáneas eso cambia — es
exactamente lo que decide **V-07**.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad | Centrado en el stock como entidad de negocio |
| **Estado** | **Stateful**, justificado | El saldo de stock y el Kardex son su razón de ser |
| **Comunicación** | **Síncrona** para consulta y descuento; asíncrona para sincronizar | El cajero necesita saber ahora si hay stock |
| **Granularidad** | **Media** | `ConsultarDisponibilidad`, `DescontarStock`, `ReingresarStock` |
| **Rol** | **Proveedor** | Provee stock a Sales & Customer y a Order & Booking |
| **Seguridad** | Token de servicio · movimientos de Kardex append-only con usuario y fecha | |

---

## Alcance parcial en el flujo de venta

El servicio tiene capacidades completas de inventario, pero **el flujo de venta actual solo usa
tres**:

| Usado por el flujo de venta | Fuera del flujo actual |
| :--- | :--- |
| Descuento de stock al confirmar venta | Transferencias entre almacenes |
| Reingreso ante anulación o devolución | Control multialmacén complejo |
| Consulta de disponibilidad al agregar al ticket | Trazabilidad avanzada de lotes y vencimientos |

Lo demás permanece documentado como capacidad del servicio, pero no se implementa ahora
(requerimientos §3 · W-05).

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | `contratos/openapi/inventory-v1.yaml` + XSD `urn:pos:inventory:v1` |
| **P2** | Bajo acoplamiento | Sales & Customer pide "¿hay stock del SKU X?", no consulta su Kardex |
| **P3** | Abstracción | El contrato no expone si el Kardex es por lote, por ubicación ni cómo se calcula el saldo |
| **P4** | Reutilización | Lo consumen Sales & Customer, Order & Booking y Analytics |
| **P5** | Autonomía | **Base propia y separada** de Sales & Customer, aunque compartan máquina |
| **P6** | Sin estado | ⚠️ **No cumple, justificado**: el saldo es estado de negocio |
| **P7** | Descubribilidad | Registrado en UDDI |
| **P8** | Componibilidad | Participa en `ProcesoVenta.Task` (descuento) y en la compensación (reingreso) |

---

## Con quién habla

| Servicio | Dirección | Naturaleza |
| :--- | :--- | :--- |
| `Sales & Customer Service` | Provee | Síncrona — consulta, descuento, reingreso |
| `Order & Booking Engine` | Provee | Disponibilidad de insumos para servicios agendados |
| `Analytics & Reporting` | Provee | Eventos de movimiento para rotación de inventario |
| `Notification & Sync` | Consume | Alertas de stock mínimo |

---

## Pregunta abierta del diseño

Estando desplegado en la misma máquina que `Sales & Customer Service`, ¿el ESB corre también
local, o esta interacción es una excepción documentada? **Se resuelve en el diseño del ESB
(APF2).**

---

## Estado

Implementación: pendiente (Nivel N2 — se arranca cuando N1 esté cerrado).
