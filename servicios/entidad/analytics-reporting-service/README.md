# Analytics & Reporting Service

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"

**Servicio de entidad** · Nivel **N3 — stub con contrato real** · Base propia: `svc_analytics_reporting`

---

## Propósito

Consolida lo que ocurre en todos los servicios y lo convierte en indicadores para quien dirige
el negocio.

### Objetivo estratégico que soporta

> *Que el dueño sepa cómo va su negocio sin tener que revisar caja por caja ni canal por canal.*

---

## Alcance

| Reporte | Contenido |
| :--- | :--- |
| Ventas por canal | Mostrador, WhatsApp, e-commerce — consolidado |
| Productos y servicios | Los más vendidos y los más rentables |
| Márgenes y rotación | Análisis de ganancia y movimiento de inventario |
| Cierres de caja | Arqueos y **desviaciones de efectivo** |
| **Comprobantes multi-serie** | Todas las series de todas las cajas en una sola vista |

El último resuelve un problema concreto del documento base §3.4: como cada caja emite con su
propia serie, sin consolidación el dueño tendría que revisar caja por caja.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad | Centrado en el Indicador y el Reporte |
| **Estado** | **Stateless** ✅ | **El único del inventario que lo cumple limpiamente.** No guarda estado de negocio: proyecta eventos que otros ya persistieron |
| **Comunicación** | **Asíncrona** para ingesta, **síncrona** para consulta | Consume eventos del bus; responde consultas del backoffice |
| **Granularidad** | **Gruesa** | `ConsultarVentasPorCanal`, `ConsultarCierresCaja` — reportes completos, no datos sueltos |
| **Rol** | **Consumidor** | Consume eventos de todos los demás. No provee dato operativo a nadie |
| **Seguridad** | Solo rol ADMINISTRADOR · datos agregados, sin exponer fichas de cliente | |

**Requiere internet obligatoriamente:** la consolidación ocurre en la nube.

---

## Por qué es el más desacoplado del inventario

No participa en ningún flujo operativo. **Si se cae, el negocio sigue vendiendo** — solo se deja
de ver el tablero.

Consume eventos que ya ocurrieron (`VentaRegistrada`, `CajaCerrada`, `ComprobanteAceptado`) y
los proyecta. Nunca escribe hacia atrás.

Eso lo convierte en el mejor ejemplo del inventario para dos cosas:

- **Coreografía** frente a orquestación: reacciona a eventos sin que nadie lo coordine.
- **Bajo acoplamiento (P2)** en su forma más pura: puede añadirse o quitarse sin tocar ningún
  otro servicio.

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | `contratos/openapi/analytics-reporting-v1.yaml` |
| **P2** | Bajo acoplamiento | **El más desacoplado**: solo consume eventos publicados en el bus |
| **P3** | Abstracción | El contrato no expone cómo se calculan ni almacenan los agregados |
| **P4** | Reutilización | Sirve al backoffice web y a cualquier consumidor de reportes futuro |
| **P5** | Autonomía | Base propia con sus proyecciones |
| **P6** | Sin estado | ✅ **Cumple.** No mantiene estado de negocio propio |
| **P7** | Descubribilidad | Registrado en UDDI |
| **P8** | Componibilidad | No participa en composiciones: es terminal por diseño |

---

## Con quién habla

| Contraparte | Dirección | Qué consume |
| :--- | :--- | :--- |
| `Sales & Customer Service` | Consume | `VentaRegistrada`, `CajaCerrada` |
| `E-Invoicing Service` | Consume | `ComprobanteAceptado`, `ComprobanteRechazado` |
| `Inventory Service` | Consume | Movimientos de Kardex para rotación |
| `Payment Gateway Service` | Consume | Pagos por canal |
| Backoffice Web | Provee | Dashboards y reportes |

---

## Qué significa "stub con contrato real"

Se diseña completo y se registra en UDDI, con consultas que devuelven datos simulados en lugar
de agregaciones reales.

Razón: su valor arquitectónico —demostrar consumo de eventos y desacoplamiento total— se
evidencia con el contrato y el registro. Construir el motor de agregación no añade nada al
aprendizaje de SOA y consume tiempo que necesita el Nivel N1.

---

## Estado

Diseñado. Implementación como stub registrado (Nivel N3).
