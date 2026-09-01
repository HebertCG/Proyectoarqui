# Orquestación

Procesos de negocio modelados en BPMN 2.0 y **ejecutados** con `bpmn-engine`.
Ver [`CLAUDE.md` §4.3](../CLAUDE.md).

Los `.bpmn` que se diagraman son los mismos que corren: no son dibujos decorativos.

| Proceso | Atraviesa |
| :--- | :--- |
| `ProcesoVenta` | `Sales & Customer Service` → `E-Invoicing Service` |
| `ReservaMulticanal` | `Omnichannel Bot` → `Sales & Customer` / `Order & Booking` |
| `ConciliacionPago` | `Payment Gateway` → `Sales & Customer Service` |

Cada proceso declara su **compensación**: qué se revierte y en qué orden si un paso falla
a mitad de camino (integridad de procesos, sesión 29).

Modelar con [bpmn.io](https://bpmn.io) o Camunda Modeler.
