# Matriz C — Principios de Diseño ↔ Servicio

> Cubre: Unidad 1 — Sesión 9 — "Diseño de una Arquitectura SOA • Principios de diseño de servicios"
> Unidad 2 — Sesión 13–14 — "Diseño de Servicios"

Formato obligatorio de `CLAUDE.md` §10. Verificada sobre el inventario canónico de §4.2.

**Leyenda:** ✅ cumple · ⚠️ no cumple, con justificación declarada · — no aplica

---

## Servicios de Entidad

| Servicio | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | Observaciones |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :--- |
| `Sales & Customer Service` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P6:** ticket en curso y turno de caja son estado de negocio persistente (RF-POS-09, RNF-10), no estado de sesión. **P4:** su catálogo sirve a ≥3 servicios |
| `E-Invoicing Service` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P6:** el estado tributario del comprobante es el núcleo del servicio (ADR-002). **P1:** único con WSDL |
| `Inventory Service` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P6:** el saldo de stock es estado de negocio. **P5:** base propia aunque comparta máquina con Sales & Customer |
| `Order & Booking Engine` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P6:** carrito abierto y franja bloqueada persisten entre interacciones. **Sujeto a V-08** |
| `Notification & Sync Service` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P6:** el avance de sincronización por terminal debe persistir |
| `Payment Gateway Service` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P3:** su valor central — contrato idéntico sea cual sea la pasarela. N3 stub |
| `Omnichannel Bot Service` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P6:** el hilo conversacional es su núcleo. N3 stub |
| `Analytics & Reporting Service` | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | ✅ | — | **El único que cumple P6 limpiamente:** proyecta eventos, no guarda estado de negocio. **P8:** terminal por diseño, no participa en composiciones |

## Servicios de Utilidad

| Servicio | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | Observaciones |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :--- |
| `Auditoria.Utility` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **P6:** el registro append-only es su razón de ser. **P4:** lo consumen todos los servicios y el ESB |
| `Sincronizacion.Utility` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **Cumple los 8.** Es un patrón puro: idempotencia por UUIDv4 y backoff, sin estado propio |
| `Notificacion.Utility` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **Cumple los 8.** Envío sin estado; la suscripción vive en Notification & Sync |

---

## Lectura de la matriz

### P6 (Statelessness) es el que más se incumple, y no es un defecto

Nueve de once servicios son stateful. Eso **no señala un problema de diseño**: señala que este
es un dominio de negocio transaccional, donde el estado *es* el valor.

Un ticket a medio cobrar, un turno de caja abierto, un comprobante esperando respuesta de SUNAT
o una franja horaria bloqueada **son estado de negocio que debe sobrevivir a un corte de luz**.
Delegarlo a otra parte no lo eliminaría: lo movería, añadiendo una llamada de red en el peor
momento posible.

El principio exige que si un servicio es stateful, **se declare y se justifique**. Eso es lo que
hace esta matriz.

Los dos que sí lo cumplen limpiamente lo hacen por naturaleza, no por esfuerzo:
`Sincronizacion.Utility` es un patrón puro, y `Analytics` solo proyecta eventos que otros ya
persistieron.

### P5 (Autonomía) se aplica entre servicios, no dentro

`Sales & Customer Service` comparte una base entre Caja, Venta, CRM y Catálogo. **Eso no viola
P5**: son sub-dominios internos de un único servicio, y su fusión es una decisión de diseño
cerrada (CLAUDE.md §3 y §4.5).

La regla se aplica **entre los servicios del inventario**: ninguno lee las tablas de otro.
`Inventory` e `Sales & Customer` corren en la misma máquina y tienen bases separadas, porque son
dos servicios distintos.

### P4 (Reutilización) es lo que decidió no extraer utilidades

`ValidacionDocumento` y `ReglasPrecio` **no se extrajeron** como servicios porque ningún otro
servicio del inventario los necesita. Un servicio que sirve a un solo consumidor no aporta
reutilización: solo añade una llamada de red y debilita la autonomía de quien lo usaba.

Ese es exactamente el criterio de P4 aplicado, en lugar de fragmentar por fragmentar.

---

## Pendiente

| # | Afecta a la matriz |
| :--- | :--- |
| **V-08** | Si `Order & Booking Engine` se fusiona, su fila se retira y sus principios pasan a `Sales & Customer Service` |
