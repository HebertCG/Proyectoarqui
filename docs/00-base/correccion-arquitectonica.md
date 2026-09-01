# Prompt de Corrección — Reencuadre Arquitectónico de `Sales & Customer Service`

> Este prompt está pensado para pegarse directamente a Claude (u otro asistente) trabajando sobre el proyecto,
> como corrección explícita antes de continuar cualquier desarrollo sobre el `CLAUDE.md`.

---

Necesito que corrijas un error de interpretación arquitectónica que se cometió al generar el `CLAUDE.md` de este
proyecto. Te explico el contexto completo para que la corrección quede bien fundamentada y no se repita en
próximas iteraciones.

## 1. Qué es realmente `Sales & Customer Service`

`Sales & Customer Service` es **uno entre ocho servicios** de un inventario SOA ya definido para un sistema
POS/E-commerce multirrubro. No es el proyecto completo, no es un prototipo aislado, y no debe tratarse como si
tuviera que "convertirse" por sí solo en toda la arquitectura orientada a servicios del curso.

El documento `resumen_arquitectura_sistema_pos_soa.md` (fuente original del proyecto) ya define el inventario
completo de servicios que el sistema necesita:

| Servicio | Función Principal |
| :--- | :--- |
| `Sales & Customer Service` | Caja, Venta/POS, Cliente/CRM y Catálogo (productos y servicios), unificados por decisión arquitectónica deliberada. |
| `Inventory Service` | Control de stock, Kardex, alertas de reabastecimiento. |
| `Order & Booking Engine` | Motor de carritos y agendamiento de citas/turnos. |
| `Payment Gateway Service` | Integración con pasarelas de pago externas, links de pago y QR dinámicos. |
| `E-Invoicing Service` | Generación de XML/UBL, firma digital, envío tributario a SUNAT. |
| `Omnichannel Bot Service` | WhatsApp Cloud API e IVR para pedidos/reservas por canal digital. |
| `Notification & Sync Service` | Notificaciones en tiempo real y orquestación de sincronización. |
| `Analytics & Reporting Service` | Dashboards, reportes consolidados, métricas de negocio. |

Toda la información de arquitectura, requerimientos funcionales/no funcionales y diagramas que se entregaron
previamente (`sales_customer_service_arquitectura.md`, `sales_customer_service_diagrama.puml`,
`sales_customer_service_requerimientos.md`) corresponde **exclusivamente** al diseño ya cerrado de este primer
servicio. Esa información fue **determinante para la ejecución de este servicio en particular** — no es un
punto de partida a reinterpretar libremente, y no debe usarse como excusa para redefinir cómo se relaciona con
el resto del inventario.

## 2. La decisión arquitectónica que NO se debe tocar

`Sales & Customer Service` fusiona deliberadamente cuatro sub-dominios (Caja, Venta, Cliente/CRM, Catálogo) en
un único servicio autónomo, con una sola base de datos (SQLite/SQLCipher local + réplica cloud en
MySQL/PostgreSQL). Esta fusión se decidió explícitamente para evitar llamadas cruzadas constantes entre
servicios que se necesitan en el mismo instante del ticket de venta (ej. el cajero busca el cliente y el
producto en el mismo flujo, en el mismo momento).

**Esta decisión no se reabre.** No se debe:
- Fragmentar Catálogo, Cliente, Caja o Venta en servicios separados con bases de datos independientes.
- Degradar este servicio a la categoría de "consumidor" o "agente de borde" de otros servicios que no existían
  en el diseño original.
- Forzar que este servicio, por sí solo, "demuestre" toda la teoría SOA del curso (ESB, UDDI, SOAP, BPM)
  como si fuera el único artefacto evaluable.

## 3. Por qué se llegó a ese error (para que no se repita)

El error surgió al intentar hacer que **un solo servicio cumpliera, por sí solo, con toda la rúbrica de un
curso de Arquitectura Orientada a Servicios** (contratos SOAP/WSDL, UDDI, ESB, autonomía estricta por entidad).
Como el servicio ya estaba diseñado como un monorepo compuesto y coherente, la única forma de "hacerlo parecer
más SOA" fue fragmentarlo internamente y relegarlo a un rol secundario (consumidor) mientras se inventaban
servicios nuevos en la nube que no formaban parte del diseño original.

Esa lectura es incorrecta por dos razones:

1. **Arquitectónicamente:** el propósito real de SOA no es que todos los servicios hablen el mismo protocolo
   o se fragmenten al máximo nivel de granularidad posible. El valor de un ESB está en mediar entre servicios
   que **genuinamente** tienen necesidades de comunicación distintas — por ejemplo, un servicio que produce
   XML, otro que lo transforma, y otro que lo recibe en otro formato. Forzar SOAP/WSDL en todos los servicios
   sin que exista una necesidad real de interoperabilidad heterogénea no demuestra dominio de SOA, demuestra
   lo contrario: aplicar tecnología sin justificación de diseño.

2. **De alcance del proyecto:** `Sales & Customer Service` es y debe seguir siendo **un servicio entre varios**.
   El objetivo del curso se cumple construyendo el inventario completo (aunque algunos servicios queden como
   diseño con contrato + implementación simulada, ver niveles de alcance en el `CLAUDE.md` corregido), no
   intentando que uno solo cargue con la responsabilidad de representar toda la arquitectura.

## 4. Dónde SÍ tiene sentido SOAP/WSDL/XML en este proyecto

El único punto del inventario donde SOAP, WSDL y XML tienen una justificación técnica real es el
`E-Invoicing Service`, porque:

- SUNAT (autoridad tributaria peruana) exige el comprobante en formato **XML/UBL**.
- El comprobante requiere **firma digital XML** (XMLDSig).
- La respuesta de SUNAT es un **CDR (Constancia de Recepción)**, también en XML.

Aquí el ESB demuestra su función real: mediar entre el `Sales & Customer Service` (que opera internamente en
REST/JSON) y SUNAT (que exige SOAP/XML), transformando y ruteando el mensaje sin que ninguno de los dos lados
necesite conocer los detalles internos del otro. El resto de servicios del inventario debe comunicarse vía
REST/JSON con contratos OpenAPI, salvo que surja una justificación de negocio equivalente a la de SUNAT.

## 5. Contexto de despliegue multiplataforma que debe respetarse

`Sales & Customer Service` se diseñó explícitamente para operar bajo un modelo **Local-First** con tres
entregables de build a partir de un mismo monorepo:

- **Web (principal, backoffice/administración):** compilación estática de React, consumidora directa de la API
  REST contra la réplica cloud (MySQL/PostgreSQL) del propio servicio. No tiene SQLite local.
- **Desktop (Windows):** ejecutable nativo vía Tauri 2.0, con SQLite/SQLCipher local, operando de forma
  autónoma sin depender de conexión a internet para las funciones de caja, venta, cliente y catálogo.
- **Tablet (Android, y iOS como fase futura):** mismo núcleo Tauri, adaptado a interacción táctil.

La capa de Clean Architecture (`RepositoryFactory` + interfaces de dominio como `ITicketRepository`) es lo que
permite que **el mismo código de UI se comparta entre las tres plataformas**, resolviendo en tiempo de arranque
si debe hablar con SQLite local (Desktop/Tablet) o con la API REST (Web), sin bifurcaciones de código por
plataforma. Esta capa es interna al servicio y no debe confundirse con un mecanismo de comunicación entre
servicios distintos del inventario.

## 6. Qué necesito que hagas ahora

1. Toma el `CLAUDE.md` corregido que te voy a proporcionar (o aplica estas correcciones si estás editando el
   existente) como la referencia vigente. Las secciones corregidas son: §3 (Principio Arquitectónico), §4
   (Inventario de Servicios, sin fragmentar `Sales & Customer Service`), §6 (Estructura de Carpetas), §9.1
   regla 7, y §12 (Prohibiciones).
2. No reinterpretes ni reabras las decisiones ya documentadas en `sales_customer_service_arquitectura.md`,
   `sales_customer_service_diagrama.puml` y `sales_customer_service_requerimientos.md`. Esa información es
   determinante para este servicio y debe usarse tal cual para continuar el desarrollo de sus tres
   plataformas (Web, Desktop, Tablet).
3. Para continuar avanzando en la arquitectura SOA completa del proyecto, el siguiente trabajo debe enfocarse
   en **definir el resto del inventario** (`Inventory Service`, `Order & Booking Engine`, `Payment Gateway
   Service`, `E-Invoicing Service`, `Omnichannel Bot Service`, `Notification & Sync Service`,
   `Analytics & Reporting Service`) con el mismo nivel de detalle que ya tiene `Sales & Customer Service`, y
   luego diseñar cómo se conectan entre sí a través del ESB — no en seguir ajustando o fragmentando el
   servicio que ya está cerrado.
4. Cualquier duda sobre si una decisión toca el inventario de servicios, se detiene y se pregunta antes de
   aplicarse — tal como ya establece la propia regla de "cuándo detenerse" del `CLAUDE.md`.
