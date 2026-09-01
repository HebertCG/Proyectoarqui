# Notification & Sync Service

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"
> Unidad 3 — Sesión 29 — "Integridad de procesos"

**Servicio de entidad** · Nivel **N2** · Base propia: `svc_notification_sync`

---

## Propósito

Orquesta la sincronización entre los terminales locales y la nube, y empuja notificaciones en
tiempo real hacia el POS cuando algo ocurre fuera de él.

### Objetivo estratégico que soporta

> *Que lo que pasa en un canal se sepa en los demás, sin que nadie tenga que refrescar nada.*

---

## Dos responsabilidades distintas

### 1. Sincronización

Coordina el ciclo push/pull entre terminal y nube:

| Dirección | Qué viaja | Regla |
| :--- | :--- | :--- |
| **Push** (terminal → nube) | Ventas, movimientos de caja, clientes, comprobantes | Append-only: se insertan, nunca se sobrescriben |
| **Pull** (nube → terminal) | Catálogo, precios, promociones | **La nube manda** en estos datos |

Reglas por tipo de dato, heredadas del documento base §2.5:

| Tipo | Regla |
| :--- | :--- |
| Catálogo / precios | La nube manda |
| Ventas / movimientos de caja | Nunca se sobrescriben |
| Stock | Aislado por local, sin reconciliación cruzada |
| Comprobantes | Correlativo local; el estado tributario se actualiza al sincronizar |

### 2. Notificación en tiempo real

WebSockets hacia el POS. El caso concreto: **entra un pedido por WhatsApp mientras el cajero
atiende mostrador**, y el terminal debe enterarse sin que nadie recargue la pantalla.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad | Centrado en el evento de sincronización y la suscripción |
| **Estado** | **Stateful**, justificado | Mantiene el estado de cada terminal: qué sincronizó, hasta cuándo, qué falló |
| **Comunicación** | **Asíncrona** | Es su naturaleza: cola de eventos y push por WebSocket |
| **Granularidad** | **Media** | `RegistrarLote`, `ConsultarPendientes`, `Suscribir` |
| **Rol** | **Intermediario** | No es dueño de ningún dato de negocio: coordina el tránsito |
| **Seguridad** | Token por terminal · el WebSocket autentica antes de suscribir | |

**Requiere internet obligatoriamente** — pero solo para sincronizar. Su ausencia no impide
vender: el terminal encola y sigue operando (RNF-01).

---

## Relación con `Sincronizacion.Utility`

No se solapan, y la diferencia importa:

| | `Sincronizacion.Utility` | `Notification & Sync Service` |
| :--- | :--- | :--- |
| Qué es | **Patrón reutilizable**: idempotencia por UUIDv4, backoff exponencial, outbox | **Servicio** que orquesta el ciclo completo |
| Quién lo usa | Cualquier servicio que necesite mensajería asíncrona confiable | Los terminales |
| Analogía | La biblioteca | El coordinador que la usa |

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | `contratos/openapi/notification-sync-v1.yaml` + esquema de eventos AMQP |
| **P2** | Bajo acoplamiento | Transporta eventos con contrato propio; no interpreta su contenido de negocio |
| **P3** | Abstracción | El terminal no sabe si por debajo hay RabbitMQ o WebSockets |
| **P4** | Reutilización | Todo terminal y todo servicio que emita eventos lo usa |
| **P5** | Autonomía | Base propia con el estado de sincronización por terminal |
| **P6** | Sin estado | ⚠️ **No cumple, justificado**: el avance de sincronización por terminal debe persistir |
| **P7** | Descubribilidad | Registrado en UDDI |
| **P8** | Componibilidad | Participa en cualquier proceso que cruce la frontera local↔nube |

---

## Con quién habla

| Contraparte | Dirección | Naturaleza |
| :--- | :--- | :--- |
| Terminales (`Sales & Customer`, `Inventory`) | Ambas | Push de eventos, pull de catálogo, WebSocket de notificaciones |
| `Omnichannel Bot Service` | Consume | Le avisa al POS que entró un pedido digital |
| `Auditoria.Utility` | Consume | Cada ciclo de sincronización queda registrado |

---

## Garantía que debe cumplir

**Idempotencia extremo a extremo** (RF-SYNC-07, RNF-09): reenviar un evento ya procesado no
puede duplicar la venta, el movimiento de caja ni el comprobante. Es lo que hace seguro el
reintento automático con backoff.

---

## Estado

Implementación: pendiente (Nivel N2).
