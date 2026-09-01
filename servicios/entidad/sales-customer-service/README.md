# Sales & Customer Service

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"

**Servicio de entidad compuesto** · Nivel **N1** · Base propia: SQLite/SQLCipher local + `svc_sales_customer` (réplica cloud)

---

## Propósito

Núcleo operativo del sistema. Sostiene la venta de mostrador completa: el cajero abre caja,
busca un producto, identifica al cliente, aplica la promoción, cobra con varias formas de pago
y entrega el comprobante — **todo en un solo flujo y sin depender de internet**.

### Objetivo estratégico que soporta

> *Que el negocio nunca deje de vender.*

La venta de mostrador no puede depender de la disponibilidad de red en el momento del cobro.
Este servicio existe para que una caída de internet no se traduzca en una venta perdida.

---

## Por qué es un servicio compuesto y no cuatro

Absorbe cuatro sub-dominios que originalmente eran módulos separados: **Caja, Venta/POS,
Cliente/CRM y Catálogo** (productos y servicios con horario/personal).

La razón es operativa, no de comodidad: el cajero necesita los cuatro **en el mismo instante
del ticket**. Busca el cliente para aplicarle su lista de precios, consulta el catálogo,
calcula la promoción y registra el movimiento en caja — todo en la misma interacción, con el
cliente esperando frente al mostrador.

Fragmentarlos en servicios con bases separadas convertiría cada venta en una cadena de llamadas
cruzadas entre servicios. Eso no haría el sistema "más SOA": lo haría más frágil y más lento en
el único momento donde la latencia se nota.

> **Esta decisión está cerrada** (documento base §0, decisiones 1 y 2 · CLAUDE.md §3 y §12).
> Los cuatro sub-dominios mantienen separación interna de responsabilidades con API interna
> documentada, lo que basta para **Abstracción** y **Bajo Acoplamiento** sin fragmentar.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad (compuesto) | Centrado en las entidades del ciclo de venta, no en un proceso |
| **Estado** | **Stateful**, justificado | El ticket en curso y el turno de caja son estado de negocio con persistencia incremental (RF-POS-09, RNF-10). No es estado de sesión: se recupera tras un cierre inesperado |
| **Comunicación** | **Ambas** | Síncrona hacia dentro (UI ⇄ datos locales). Asíncrona hacia fuera vía `sync_outbox` (comprobantes a E-Invoicing, eventos a la nube) |
| **Granularidad** | **Gruesa** | Deliberado: expone operaciones de negocio completas (`RegistrarVenta`), no CRUD por tabla |
| **Rol** | **Proveedor** y **Consumidor** | Provee catálogo y ventas a otros servicios; consume Inventory, E-Invoicing y Payment Gateway |
| **Seguridad** | Tres roles + PIN de supervisor (ADR-001) · SQLCipher en reposo (RNF-07) · HTTPS en tránsito | |

---

## Sub-dominios internos

| Sub-dominio | Responsabilidad | RF |
| :--- | :--- | :--- |
| **Caja** | Apertura con fondo, turnos, ingresos/egresos, arqueos ciego y asistido, cierre | RF-CAJA-01…10 |
| **Venta / POS** | Ticket, escaneo, pagos combinados, anulación, devolución, comprobante | RF-POS-01…19 |
| **Cliente / CRM** | Ficha, búsqueda, historial, segmentación, fidelización | RF-CRM-01…07 |
| **Catálogo** | Productos, variantes, combos, listas de precios, promociones, **y servicios con duración/especialista/recurso** | RF-CAT-01…08 · RF-SERV-01…08 |

> El Catálogo se expone como **API interna consumible por otros servicios** (Inventory,
> Order & Booking, Omnichannel Bot) sin acoplarlos a la lógica de venta (documento base §5.1).

---

## Tres despliegues, un mismo código

| Build | Datos | Opera sin internet |
| :--- | :--- | :--- |
| **Desktop** (Windows · Tauri 2.0) | SQLite/SQLCipher local | Sí — autoridad operativa del día a día |
| **Tablet** (Android · Tauri 2.0) | SQLite/SQLCipher local | Sí |
| **Web** (React estático) | API REST contra réplica cloud | No — es backoffice |

El `RepositoryFactory` resuelve en arranque hacia dónde apuntan las interfaces de dominio
(`ITicketRepository`, `IClientRepository`, `ICatalogRepository`). Es un **adaptador de
transporte interno** del servicio, no un broker entre servicios distintos.

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | `contratos/xsd/sales-customer-v1.xsd` (`urn:pos:sales-customer:v1`) + OpenAPI `sales-customer-v1.yaml` |
| **P2** | Bajo acoplamiento | Los consumidores dependen del contrato. La UI depende de interfaces de dominio, nunca de SQLite ni de HTTP |
| **P3** | Abstracción | El contrato no filtra que por dentro hay SQLite, Tauri ni cuatro sub-dominios |
| **P4** | Reutilización | Su catálogo sirve a ≥3 servicios: Inventory, Order & Booking, Omnichannel Bot |
| **P5** | Autonomía | Base propia. Opera sin internet y sin depender de ningún otro servicio para vender |
| **P6** | Sin estado | ⚠️ **No cumple, y está justificado**: ticket en curso y turno de caja son estado de negocio persistente, no de sesión |
| **P7** | Descubribilidad | Registrado en el registro UDDI con sus metadatos |
| **P8** | Componibilidad | Participa en `ProcesoVenta.Task` y `ConciliacionPago.Task` sin modificarse |

---

## Con quién habla

| Servicio | Dirección | Naturaleza |
| :--- | :--- | :--- |
| `Inventory Service` | Consume | Síncrona — consulta y descuenta stock (ADR-006) |
| `E-Invoicing Service` | Consume | **Asíncrona** vía `sync_outbox` — cola de comprobantes |
| `Payment Gateway Service` | Consume | Síncrona — cobros digitales; requiere internet |
| `Order & Booking Engine` | Provee | Le expone el catálogo de servicios (**sujeto a V-08**) |
| `Omnichannel Bot Service` | Provee | Le expone el catálogo |
| `Analytics & Reporting` | Provee | Emite eventos de venta y cierre de caja |
| `Auditoria.Utility` | Consume | Toda operación relevante (RNF-11) |

**Todo pasa por el ESB.** No hay integración punto a punto (CLAUDE.md §9.1 regla 8).

---

## Decisiones que le aplican

| ADR | Decisión |
| :--- | :--- |
| [001](../../../docs/adr/001-seguridad-roles-pin.md) | Tres roles fijos + elevación por PIN. **Interno a este servicio** |
| [002](../../../docs/adr/002-anulacion-nota-credito.md) | Máquina de estados del comprobante decide la reversión legal |
| [003](../../../docs/adr/003-precedencia-precios.md) | Cascada lista → promoción → cupón → manual. **Interno a este servicio** |
| [005](../../../docs/adr/005-sqlcipher-openssl.md) | SQLCipher con OpenSSL vendorizado |
| [006](../../../docs/adr/006-stock-inventory-local-first.md) | **No guarda stock.** Lo consulta a Inventory por contrato |

---

## Vacíos abiertos

| # | Afecta |
| :--- | :--- |
| **V-05** | Búsqueda <300ms sobre 50k productos / 100k clientes con FTS5 sobre SQLCipher |
| **V-07** | Si el local opera con 2+ cajas simultáneas, hay concurrencia sobre stock y caja |
| **V-08** | Si `Order & Booking Engine` se fusiona aquí, absorbe también la agenda |

---

## Estado

**Diseño cerrado y determinante.** Los documentos base
([requerimientos](../../../docs/00-base/requerimientos.md) ·
[arquitectura](../../../docs/00-base/arquitectura-local-first.md)) definen su implementación
completa y **no se reabren**.

Implementación: pendiente (Nivel N1, prioridad máxima).
