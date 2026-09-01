# Order & Booking Engine

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"

**Servicio de entidad** · Nivel **N2** · Base propia: `svc_order_booking`

> ## ⚠️ DECISIÓN PENDIENTE — V-08
>
> **El documento base deja abierto si este servicio se mantiene separado o se fusiona dentro de
> `Sales & Customer Service`** (§5.3 y §8.2).
>
> No es un detalle: **determina si el inventario tiene 8 servicios o 7.** Esta ficha describe la
> Opción A (separado). Si se decide la fusión, este documento se retira y su contenido pasa al
> sub-dominio Catálogo/Agenda de `Sales & Customer Service`.
>
> Ver §"La decisión" al final.

---

## Propósito

Motor centralizado de carritos de compra y agendamiento de citas/turnos. Es el punto donde una
intención de compra o de reserva se convierte en un compromiso con fecha, hora y recurso
asignado.

### Objetivo estratégico que soporta

> *Que el negocio pueda vender también fuera del mostrador, sin prometer lo que no puede cumplir.*

---

## Qué hace distinto a un producto de un servicio

| Criterio | Producto | Servicio |
| :--- | :--- | :--- |
| Recurso principal | Stock físico | Disponibilidad de personal + franja horaria |
| Unidad de venta | SKU / unidades | Duración + especialista |
| Reserva | Bloqueo temporal de stock en carrito | **Bloqueo de agenda y asignación de recurso** |
| Cobro | Venta directa o link/QR | Seña/anticipo o cobro total al agendar |
| Despacho | Entrega en mostrador o envío | Asistencia presencial |

Consulta el catálogo de servicios — duración, especialistas habilitados, recursos requeridos —
**a través de `Sales & Customer Service`**, que es su dueño.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad | Centrado en Carrito y Reserva como entidades |
| **Estado** | **Stateful**, justificado | Un carrito abierto y una franja bloqueada son estado que persiste entre interacciones |
| **Comunicación** | **Síncrona** | Confirmar una reserva exige validar disponibilidad en el momento: no se puede prometer y comprobar después |
| **Granularidad** | **Media** | `ConsultarDisponibilidad`, `ReservarFranja`, `ConfirmarReserva`, `CancelarReserva` |
| **Rol** | **Proveedor** y **Consumidor** | Provee reservas al bot omnicanal; consume el catálogo de Sales & Customer |
| **Seguridad** | Token de servicio · toda reserva registra quién la creó | |

---

## La regla que no puede fallar

**Doble asignación.** Validar disponibilidad de personal **y** de recurso físico antes de
confirmar, e impedir que dos reservas ocupen la misma franja del mismo especialista o de la
misma sala.

Es la regla crítica del dominio de servicios, equivalente a la sobreventa en productos.

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | `contratos/openapi/order-booking-v1.yaml` |
| **P2** | Bajo acoplamiento | No conoce cómo Sales & Customer guarda el catálogo |
| **P3** | Abstracción | El contrato no expone cómo se modela la agenda internamente |
| **P4** | Reutilización | Lo consumen Omnichannel Bot y el propio POS de mostrador |
| **P5** | Autonomía | Base propia con las reservas y bloqueos de franja |
| **P6** | Sin estado | ⚠️ **No cumple, justificado**: carrito y reserva son estado de negocio |
| **P7** | Descubribilidad | Registrado en UDDI |
| **P8** | Componibilidad | Miembro de `ReservaMulticanal.Task` |

---

## Con quién habla

| Servicio | Dirección | Naturaleza |
| :--- | :--- | :--- |
| `Sales & Customer Service` | Consume | Catálogo de servicios: duración, especialistas, recursos |
| `Inventory Service` | Consume | Disponibilidad de insumos del servicio |
| `Omnichannel Bot Service` | Provee | Reservas creadas por WhatsApp o IVR |
| `Payment Gateway Service` | Consume | Cobro de seña o anticipo al agendar |

---

## La decisión (V-08)

### Opción A — Servicio separado *(la que describe esta ficha)*

Un motor centralizado que sirve a todos los canales por igual: mostrador, WhatsApp, e-commerce.
Una sola autoridad sobre la agenda, sin importar por dónde entre la reserva.

**A favor:** evita que dos canales prometan la misma franja. Es la respuesta natural a W-04
(consistencia mostrador vs. canal digital).
**En contra:** agendar y cobrar en mostrador pasan a ser dos servicios, con la latencia y el
acoplamiento que eso implica en el momento del ticket.

### Opción B — Fusionado en `Sales & Customer Service`

**A favor:** en peluquerías, estética o consultorios, **agendar y cobrar ocurren en el mismo
momento con el mismo cliente**. Es exactamente el mismo argumento que ya justificó fusionar CRM
y Catálogo en el servicio compuesto. Y el catálogo de servicios (duración, especialista,
recurso) ya vive ahí.
**En contra:** el bot omnicanal y el e-commerce tendrían que reservar contra un servicio
diseñado como local-first, lo que complica la disponibilidad en tiempo real desde canales
remotos.

### Qué inclina la balanza

La pregunta real es **por qué canal entran las reservas**:

- Si la mayoría entra **por mostrador** → la coherencia con la fusión ya decidida pesa más → **Opción B**.
- Si entra un volumen relevante **por WhatsApp o web** → hace falta una autoridad de agenda
  accesible desde la nube → **Opción A**.

**Pendiente de decisión del estudiante** (CLAUDE.md §9.2: toda decisión que cambie el
inventario se detiene y se pregunta).

---

## Estado

Diseño en pausa hasta resolver V-08. Implementación: Nivel N2.
