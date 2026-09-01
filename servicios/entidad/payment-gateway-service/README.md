# Payment Gateway Service

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"
> Unidad 3 — Sesión 23, 25–26 — "Business to Business"

**Servicio de entidad** · Nivel **N3 — stub con contrato real** · Base propia: `svc_payment_gateway`

---

## Propósito

Cobro digital: integra con pasarelas externas y genera links de pago y QR dinámicos para cobrar
sin POS físico.

### Objetivo estratégico que soporta

> *Que el negocio pueda cobrar aunque el cliente no esté frente al mostrador.*

---

## Alcance

| Capacidad | Detalle |
| :--- | :--- |
| Pasarelas externas | Stripe, Niubiz, Culqi, Mercado Pago, PayU |
| Links de pago | Enviables por correo o WhatsApp — venta telefónica, reservas previas |
| QR dinámicos | Cobro presencial sin terminal bancario |
| Webhooks | Confirmación asíncrona de pago desde la pasarela |

**Requiere internet obligatoriamente.** Es la diferencia con el cobro en efectivo o con POS
bancario externo, que sí operan offline dentro de `Sales & Customer Service`.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad | Centrado en la Transacción de pago |
| **Estado** | **Stateful**, justificado | Una transacción recorre estados (iniciada → autorizada → capturada / fallida) que deben persistir |
| **Comunicación** | **Ambas** | Síncrona al iniciar el cobro; **asíncrona por webhook** al confirmarlo |
| **Granularidad** | **Media** | `IniciarCobro`, `GenerarLinkPago`, `ConsultarEstado` |
| **Rol** | **Proveedor** e **Intermediario** | Media entre el inventario y las pasarelas externas |
| **Seguridad** | Credenciales de pasarela en gestor de secretos · verificación de firma en webhooks · **jamás se guardan datos de tarjeta** | |

---

## Por qué el webhook obliga a un servicio de tarea

El pago digital es **asíncrono por naturaleza**: el cliente paga minutos u horas después de que
se generó el link. Cuando la pasarela confirma, hay que encontrar el ticket o la reserva que
esperaba ese pago y actualizarlo.

Esa coordinación es `ConciliacionPago.Task`, no responsabilidad de este servicio.

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | `contratos/openapi/payment-gateway-v1.yaml` |
| **P2** | Bajo acoplamiento | Quien cobra no sabe si detrás hay Culqi o Niubiz |
| **P3** | Abstracción | **Su valor central**: el contrato es idéntico sea cual sea la pasarela |
| **P4** | Reutilización | Lo consumen Sales & Customer, Order & Booking y Omnichannel Bot |
| **P5** | Autonomía | Base propia con las transacciones |
| **P6** | Sin estado | ⚠️ **No cumple, justificado**: la transacción es estado de negocio |
| **P7** | Descubribilidad | Registrado en UDDI, **incluso siendo stub** |
| **P8** | Componibilidad | Miembro de `ConciliacionPago.Task` |

---

## Qué significa "stub con contrato real"

El servicio se **diseña completo** y se **registra en UDDI** con su contrato formal, pero su
implementación devuelve respuestas simuladas en vez de llamar a una pasarela real.

**No es trampa** — es *service virtualization*, práctica legítima. Lo sería presentarlo como
servicio real. Su naturaleza simulada se documenta aquí y en el registro.

Razón: integrar una pasarela real exige cuentas de comercio, credenciales de producción y
homologación con cada proveedor. Nada de eso aporta al aprendizaje de SOA, y consumiría tiempo
que necesita el Nivel N1.

---

## Con quién habla

| Contraparte | Dirección |
| :--- | :--- |
| `Sales & Customer Service` | Provee — cobro digital en el ticket |
| `Order & Booking Engine` | Provee — seña o anticipo al agendar |
| `Omnichannel Bot Service` | Provee — link de pago por WhatsApp |
| Pasarelas externas | Consume — **integración B2B** |

---

## Estado

Diseñado. Implementación como stub registrado (Nivel N3).
