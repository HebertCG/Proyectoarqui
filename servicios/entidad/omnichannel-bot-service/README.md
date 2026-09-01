# Omnichannel Bot Service

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"
> Unidad 3 — Sesión 23, 25–26 — "Business to Business"

**Servicio de entidad** · Nivel **N3 — stub con contrato real** · Base propia: `svc_omnichannel_bot`

---

## Propósito

Atiende y vende por canales conversacionales: WhatsApp e IVR telefónico. Es la puerta de
entrada digital al mismo catálogo y la misma agenda que usa el mostrador.

### Objetivo estratégico que soporta

> *Que el negocio atienda fuera del horario y fuera del local, sin contratar a nadie más.*

---

## Alcance

| Canal | Capacidad |
| :--- | :--- |
| **WhatsApp** (Cloud API de Meta) | Bot conversacional: catálogo, cotizaciones, agendamiento, confirmación de pedidos |
| **IVR telefónico** | Agente de voz automatizado para pedidos o reservas por llamada |
| **Notificación al POS** | Avisa en tiempo real cuando entra una venta o reserva digital |

**Requiere internet obligatoriamente.**

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad | Centrado en la Conversación como entidad |
| **Estado** | **Stateful**, justificado | Una conversación tiene hilo: el bot debe recordar qué preguntó y qué respondió el cliente |
| **Comunicación** | **Asíncrona** | El cliente responde cuando quiere; puede pasar una hora entre mensajes |
| **Granularidad** | **Gruesa** | `ProcesarMensaje` encapsula interpretar, consultar y responder |
| **Rol** | **Consumidor** e **Intermediario** | Consume catálogo y reservas; media entre el cliente y el inventario |
| **Seguridad** | Verificación de firma de webhooks de Meta · tokens en gestor de secretos · **no persiste contenido sensible de conversaciones** | |

---

## El riesgo que introduce

Este servicio es el que hace real la advertencia **W-04**: *consistencia entre mostrador y canal
digital*.

Si el bot promete una cita a las 3pm mientras el cajero está agendando esa misma franja para
otro cliente, el sistema queda inconsistente **y alguien se queda sin atención**. Lo mismo con
el stock de un producto.

Por eso el bot **nunca decide disponibilidad por su cuenta**: consulta a `Order & Booking
Engine` o a `Inventory Service`, que son las autoridades. Es consumidor, no dueño de ningún
dato.

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | `contratos/openapi/omnichannel-bot-v1.yaml` |
| **P2** | Bajo acoplamiento | No conoce cómo se guardan catálogo ni agenda: los consulta por contrato |
| **P3** | Abstracción | El contrato no expone si detrás hay WhatsApp o IVR |
| **P4** | Reutilización | Sirve a cualquier canal conversacional que se añada después |
| **P5** | Autonomía | Base propia con el estado de las conversaciones |
| **P6** | Sin estado | ⚠️ **No cumple, justificado**: el hilo conversacional es su núcleo |
| **P7** | Descubribilidad | Registrado en UDDI, incluso siendo stub |
| **P8** | Componibilidad | Inicia `ReservaMulticanal.Task` |

---

## Con quién habla

| Contraparte | Dirección | Para qué |
| :--- | :--- | :--- |
| `Sales & Customer Service` | Consume | Catálogo de productos y servicios |
| `Order & Booking Engine` | Consume | Disponibilidad y creación de reservas |
| `Payment Gateway Service` | Consume | Link de pago enviado por el chat |
| `Notification & Sync Service` | Provee | Avisa al POS que entró un pedido digital |
| WhatsApp Cloud API / telefonía | Consume | **Integración B2B** con proveedores externos |

---

## Qué significa "stub con contrato real"

Se diseña completo y se registra en UDDI, pero responde de forma simulada en vez de conectar
con la API de Meta.

Razón: WhatsApp Cloud API exige un número verificado, una cuenta de Meta Business y aprobación
de plantillas de mensaje. Nada de eso enseña SOA, y el tiempo que consume lo necesita el Nivel
N1.

---

## Estado

Diseñado. Implementación como stub registrado (Nivel N3).
