# Matriz A — Temario ↔ Entregable

> Formato obligatorio de [`CLAUDE.md` §10](../../CLAUDE.md). Garantiza que **ningún ítem del
> sílabo quede sin artefacto**.

Los ítems se transcriben **literalmente** del sílabo
([`silabo-soa.pdf`](../00-base/silabo-soa.pdf), sección *Unidades y logros específicos de
aprendizaje*). No se reordenan ni se reinterpretan.

**Estado:** ✅ cubierto con artefacto ejecutable · 📄 cubierto con documento · ⏳ pendiente

---

## Unidad 1 — Fundamentos de las Arquitecturas Orientadas al Servicio
*Semanas 1–5 · evaluada en APF1*

| Ítem del temario | Artefacto | Estado |
| :--- | :--- | :-: |
| Objetivos y beneficios estratégicos | Sección *Objetivo estratégico que soporta* en la ficha de cada servicio (`servicios/**/README.md`) | 📄 |
| Orientación a servicios | [`CLAUDE.md` §2](../../CLAUDE.md) · [`README.md`](../../README.md) | 📄 |
| Terminología fundamental y conceptos | [`CLAUDE.md` §14 — Glosario canónico](../../CLAUDE.md) | 📄 |
| Ciclo de vida de servicios | [`CLAUDE.md` §2.2](../../CLAUDE.md) · registro UDDI con retiro implementado (`registro/`) | ✅ |
| ¿Qué es un Servicio? · Partes de un servicio | Ficha por servicio: contrato · lógica · interfaz · metadatos | 📄 |
| Tipos de servicios | Inventario en tres capas: entidad · tarea · utilidad (`servicios/`) | ✅ |
| Buenas prácticas en el diseño de servicios | [`CLAUDE.md` §9.3](../../CLAUDE.md) · contract-first en `contratos/` | ✅ |
| Seguridad en los servicios | [ADR-001](../adr/001-seguridad-roles-pin.md) · autorización por PIN exigida en caja y reversión | ✅ |
| Sincronismo vs. Asincronismo | Síncrono: REST del inventario · Asíncrono: `sync_outbox` y cola de comprobantes | ✅ |
| Stateless vs Stateful | [Matriz C](matriz-c-principios.md), columna P6, servicio por servicio | 📄 |
| Encapsulación | Los sub-dominios de `Sales & Customer` no son alcanzables desde fuera: solo su contrato | ✅ |
| Interoperabilidad | REST/JSON y SOAP/XML coexistiendo, mediados por el ESB | ✅ |
| Remoto (invocación remota) | Todo servicio se invoca por HTTP a través del bus | ✅ |
| Conceptos básicos de XML, XML Schema | [`contratos/xsd/`](../../contratos/xsd/) — 3 esquemas · validación con `xmllint-wasm` | ✅ |
| XSLT | [`contratos/xslt/comprobante-a-ubl-v1.xsl`](../../contratos/xslt/) — interno → UBL 2.1 con `saxon-js` | ✅ |
| XQuery | `packages/xml-kit/src/consulta-xml.ts` — XQuery 3.1 con `fontoxpath` | ✅ |
| XPath | Ruteo por contenido del ESB (`esb/src/ruteo.ts`) | ✅ |
| Servicios web · WSDL · SOAP | [`contratos/wsdl/einvoicing-v1.wsdl`](../../contratos/wsdl/) · servidor SOAP en `einvoicing-service` | ✅ |
| UDDI | [`registro/`](../../registro/) — modelo `businessEntity → businessService → bindingTemplate → tModel` | ✅ |
| JSON | Contratos OpenAPI 3.1 de todo el inventario salvo E-Invoicing | ✅ |
| Servicios vs. Arquitectura distribuida Tradicional | [`docs/01-analisis/soa-vs-distribuida.md`](../01-analisis/soa-vs-distribuida.md) | 📄 |
| Conceptos Fundamentales de Seguridad | [ADR-001](../adr/001-seguridad-roles-pin.md) · WS-Security UsernameToken hacia SUNAT · XMLDSig | ✅ |
| Roles de Servicios y Agentes de Servicios | [`docs/01-analisis/roles-y-agentes.md`](../01-analisis/roles-y-agentes.md) | 📄 |
| Principios de diseño de servicios | [Matriz C](matriz-c-principios.md) — los 8 principios, servicio por servicio | 📄 |
| Tipos de arquitectura SOA | [`docs/01-analisis/tipos-arquitectura-soa.md`](../01-analisis/tipos-arquitectura-soa.md) | 📄 |
| Capas de SOA | [`CLAUDE.md` §4.1](../../CLAUDE.md) · [`README.md`](../../README.md) | 📄 |

---

## Unidad 2 — Diseño y Arquitectura SOA
*Semanas 6–10 · evaluada en APF2*

| Ítem del temario | Artefacto | Estado |
| :--- | :--- | :-: |
| Diseño de Composición de Servicios | `ProcesoVenta.Task` y `CierreCaja.Task`: compositor, miembros y contratos declarados en su `.bpmn` | ✅ |
| Enterprise Service Bus | [`esb/`](../../esb/) — ruteo, ruteo por contenido, transformación, mediación, políticas, auditoría | ✅ |
| Diseño de Inventario de Servicios | [`CLAUDE.md` §4.2–4.4](../../CLAUDE.md) · publicado en el registro UDDI (16 entradas) | ✅ |
| Resultados de la Aplicación de la Orientación a Servicios | [`docs/02-diseno/resultados-orientacion-servicios.md`](../02-diseno/resultados-orientacion-servicios.md) | 📄 |
| Diseño de Servicios | Ficha completa por servicio en su `README.md` (§2.1 + §2.3) | 📄 |
| Orquestación de Servicios | [`orquestacion/`](../../orquestacion/) — motor BPMN 2.0 ejecutando dos procesos reales | ✅ |

---

## Unidad 3 — Programación Distribuida y Administración de Procesos
*Semanas 11–18 · evaluada en APF3 y PROY*

| Ítem del temario | Artefacto | Estado |
| :--- | :--- | :-: |
| Tecnología para el desarrollo de servicios Web | Node 22 + TypeScript + Fastify 5 ([`CLAUDE.md` §5.2](../../CLAUDE.md)) | ✅ |
| Tipos de servicios | Entidad · tarea · utilidad, los tres implementados y distinguidos en el registro | ✅ |
| Capas a nivel empresarial | `infra/docker-compose.yml` — una base por servicio, bus y registro separados | ✅ |
| Integración de procesos Empresariales | `ProcesoVenta` atravesando `Sales & Customer` → ESB → `E-Invoicing` | ✅ |
| Business to Business | `E-Invoicing` ⇄ SUNAT: UBL 2.1, XMLDSig, SOAP con WS-Security | ✅ |
| Modelos de creación de servicios Web | Top-down desde contrato: OpenAPI/WSDL → tipos → handlers ([`contratos/`](../../contratos/)) | ✅ |
| Creando aplicaciones web | Backoffice web consumidor | ⏳ |
| Registro de Servicios - UDDI | [`registro/`](../../registro/) — publicación, búsqueda por categoría/tModel, resolución de endpoint | ✅ |
| Introducción a BPM | Modelos BPMN 2.0 reales, abribles en Camunda Modeler ([`orquestacion/definiciones/`](../../orquestacion/definiciones/)) | ✅ |
| La relación entre BPM y procesos SOA | Los `.bpmn` **son** los que ejecuta el motor; cada `serviceTask` invoca un servicio del inventario por el bus | ✅ |
| Integridad de procesos | Compensación BPMN en `ProcesoVenta` · idempotencia por UUIDv4 acotada por operación | ✅ |
| Mejores prácticas SOA | [`CLAUDE.md` §9](../../CLAUDE.md) · [`CONTRIBUTING.md`](../../CONTRIBUTING.md) · ADRs | 📄 |
| Servicio bus | `esb/src/mediacion.ts` — REST/JSON ⇄ SOAP/XML, el caso que justifica el bus | ✅ |
| Auditoría | [`servicios/utilidad/auditoria/`](../../servicios/utilidad/auditoria/) — append-only, traza por `correlationId` | ✅ |

---

## Lo que falta, dicho sin adornos

| Ítem | Por qué no está |
| :--- | :--- |
| **Creando aplicaciones web** | El backoffice consumidor no está construido. Es el único ítem del temario sin artefacto de ningún tipo. |
| Servicios N2 (`Inventory`, `Order & Booking`, `Notification & Sync`) | Diseñados y registrados, sin implementar. No bloquean ningún ítem del temario: los conceptos ya están demostrados con N1. |
| Stubs N3 | Registrados en UDDI con su naturaleza simulada declarada, como permite [`CLAUDE.md` §4.6](../../CLAUDE.md). |
| **V-08** — ¿`Order & Booking` separado o fusionado? | Decisión abierta. Cambia el inventario de 8 a 7 servicios de entidad. |

Los documentos marcados 📄 en Unidad 1 y 2 que aún no existen como archivo
(`soa-vs-distribuida`, `roles-y-agentes`, `tipos-arquitectura-soa`,
`resultados-orientacion-servicios`) están pendientes de redacción; el contenido está decidido y
disperso en `CLAUDE.md` y las fichas de servicio.
