# Servicios

Los servicios del inventario canónico. Ver [`CLAUDE.md` §4](../CLAUDE.md).

## `entidad/` — los 8 del inventario

| Servicio | Nivel | Estado |
| :--- | :--- | :--- |
| `sales-customer-service` | N1 | Pendiente — monorepo Tauri + React + réplica cloud |
| `einvoicing-service` | N1 | Pendiente — **único con contrato SOAP/WSDL** |
| `inventory-service` | N2 | Pendiente — también local-first (ADR-006) |
| `order-booking-engine` | N2 | Pendiente — **sujeto a V-08**: puede fusionarse |
| `notification-sync-service` | N2 | Pendiente |
| `payment-gateway-service` | N3 | Stub con contrato real |
| `omnichannel-bot-service` | N3 | Stub con contrato real |
| `analytics-reporting-service` | N3 | Stub con contrato real |

> **Caja, Venta, CRM y Catálogo NO van aquí.** Son sub-dominios internos de
> `sales-customer-service`, no servicios. El generador los rechaza a propósito.

## `tarea/` — procesos que atraviesan varios servicios

`proceso-venta` · `reserva-multicanal` · `conciliacion-pago`

## `utilidad/` — agnósticos al negocio

`auditoria` · `sincronizacion` · `notificacion`

---

## Crear un servicio

```bash
node ../tools/crear-servicio.mjs <nombre-kebab> <entidad|tarea|utilidad> <puerto>
```

Cada servicio contiene: `contrato/` · `src/` · `tests/` · `db/` · `README.md` con su
ficha (CLAUDE.md §2.1 y §2.3). **La ficha se llena antes de implementar.**
