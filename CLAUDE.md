# CLAUDE.md — Reglas Estrictas del Proyecto

> **Curso:** Arquitectura Orientada al Servicio (100000S08I) — Ingeniería de Sistemas e Informática, UTP
> **Ciclo:** 2026 — Ciclo 2 Agosto · 3 créditos · 4 horas semanales · 18 semanas
> **Producto:** Sales & Customer Service — Sistema POS bajo Arquitectura Orientada al Servicio
> **Naturaleza del curso:** PRÁCTICA. El entregable final es un sistema SOA funcional, no solo documentación.

Este archivo es la **constitución del proyecto**. Define cómo debo trabajar, qué debo producir y bajo qué
vocabulario. No es una guía de estilo opcional.

---

## 0. REGLA SUPREMA — Jerarquía de Autoridad

Ante cualquier conflicto, este es el orden de precedencia. **El de arriba siempre gana.**

| # | Fuente | Autoridad |
| :--- | :--- | :--- |
| 1 | `ARQUITECTURAORIENTADAALSERVICIO_undefined.pdf` (sílabo) | **ABSOLUTA.** Define temario, semanas y evaluación. |
| 2 | Este `CLAUDE.md` | Traduce el sílabo a reglas ejecutables. |
| 3 | `sales_customer_service_requerimientos.md` | Requisitos funcionales del producto (RF/RNF). |
| 4 | `sales_customer_service_arquitectura.md` + `.puml` | Diseño técnico previo. **Reencuadrado según §3.** |
| 5 | Reglas globales de ingeniería (`~/.claude/rules/`) | Aplican solo donde no contradigan lo anterior. |

**Consecuencia práctica:** si una decisión técnica es "mejor ingeniería" pero se sale del temario, **NO se toma**.
El sílabo manda. Si es indispensable, se documenta como *extensión justificada* (§12).

---

## 1. Identidad y Evaluación del Proyecto

### 1.1 Fórmula de nota

```
NOTA FINAL = (20% × APF1) + (20% × APF2) + (20% × APF3) + (40% × PROY)
```

- Nota mínima aprobatoria: **12**
- **NO existe examen rezagado.**
- **NINGUNA nota se reemplaza.**
- Por lo tanto: **cada hito es irrecuperable.** Ningún entregable se entrega incompleto.

### 1.2 Calendario de hitos (INAMOVIBLE)

| Hito | Semana | Sesión | Peso | Cubre |
| :--- | :--- | :--- | :--- | :--- |
| Prueba de entrada | 1 | 1–2 | 0% | Saberes previos (no califica) |
| **APF1** | **5** | **10** | **20%** | Unidad 1 completa (sesiones 1–9) |
| **APF2** | **10** | **20** | **20%** | Unidad 2 completa (sesiones 11–19) |
| **APF3** | **15** | **30** | **20%** | Unidad 3 parcial (sesiones 21–29) |
| **PROY** | **18** | **35** | **40%** | Sistema íntegro (sesiones 31–34 + todo) |

**Regla:** al iniciar cualquier tarea debo declarar a qué hito pertenece. Si no pertenece a ninguno, cuestiono
si debe hacerse ahora.

### 1.3 Logro general que debe evidenciar el producto

> *"El estudiante planifica las arquitecturas orientadas al servicio que permitan garantizar el apoyo de las
> tecnologías de información, alineadas a los objetivos estratégicos de las empresas para un soporte óptimo
> a sus procesos."*

Todo entregable debe poder responder: **¿qué objetivo estratégico del negocio soporta este servicio?**
Un servicio que no se puede vincular a un proceso de negocio está mal diseñado para este curso.

---

## 2. Marco Conceptual Obligatorio

El temario usa terminología canónica de **SOA (línea Thomas Erl)**. Es el único vocabulario permitido.

### 2.1 Los 8 Principios de Diseño de Servicios — CHECKLIST OBLIGATORIO

Ningún servicio se da por diseñado sin llenar esta tabla. Va en la ficha de cada servicio.

| # | Principio | Qué debo demostrar |
| :--- | :--- | :--- |
| P1 | **Contrato estandarizado** | Contrato formal y versionado (XSD + WSDL/OpenAPI) antes del código. |
| P2 | **Bajo acoplamiento** | El consumidor depende del contrato, nunca de la implementación ni del esquema de BD. |
| P3 | **Abstracción** | El contrato no filtra tecnología, tablas, ni lógica interna. |
| P4 | **Reutilización** | El servicio sirve a ≥2 consumidores o procesos. Si sirve a uno solo, se justifica. |
| P5 | **Autonomía** | Control sobre su propio entorno y datos. Sin BD compartida entre servicios. |
| P6 | **Sin estado (Statelessness)** | Estado delegado; si es stateful se declara y se justifica explícitamente. |
| P7 | **Descubribilidad** | Registrado y consultable (UDDI / catálogo de servicios) con metadatos. |
| P8 | **Componibilidad** | Puede participar como miembro de una composición sin modificarse. |

### 2.2 Ciclo de vida de servicios (sesiones 1–2)

Todo servicio recorre y documenta estas etapas:

```
Análisis orientado a servicios → Diseño de servicio → Desarrollo → Pruebas
→ Despliegue y Registro (UDDI) → Administración/Gobernanza → Versionado → Retiro
```

### 2.3 Clasificación obligatoria de cada servicio (sesiones 3–4)

Cada servicio DEBE declarar, sin excepción:

| Atributo | Valores permitidos |
| :--- | :--- |
| **Tipo/capa** | Entidad · Tarea · Utilidad · Orquestación |
| **Estado** | Stateless · Stateful (con justificación) |
| **Comunicación** | Síncrona · Asíncrona (con justificación) |
| **Granularidad** | Fina · Media · Gruesa |
| **Rol** | Proveedor · Consumidor · Intermediario · Compositor |
| **Seguridad** | Mecanismo de autenticación, autorización, cifrado en tránsito |

### 2.4 Partes de un servicio (sesión 3)

Todo servicio se documenta con: **Contrato · Lógica de negocio (implementación) · Interfaz de exposición ·
Metadatos de registro.**

---

## 3. PRINCIPIO ARQUITECTÓNICO — `Sales & Customer Service` es UN servicio del inventario, no todo el proyecto

Los documentos base (`sales_customer_service_arquitectura.md`, `.puml`, `sales_customer_service_requerimientos.md`)
describen el diseño **completo y cerrado** de uno de los ocho servicios del inventario SOA del proyecto:
`Sales & Customer Service`. Esa información es **determinante y no se reabre**: define cómo se implementa ese
servicio (stack, patrones, contratos internos), no cómo se relaciona con el resto del inventario.

**Regla dura:** `Sales & Customer Service` NO es "el consumidor" ni "el proyecto completo" — es **un servicio de
entidad compuesto**, autónomo, con su propia base de datos local (SQLite/SQLCipher) como autoridad operativa de
sus cuatro sub-dominios internos (Caja, Venta, CRM, Catálogo — incluyendo Servicios con horario/personal). Se
comunica con el resto del inventario (`E-Invoicing`, `Payment Gateway`, `Inventory`, `Omnichannel Bot`,
`Order & Booking Engine`, `Notification & Sync`, `Analytics & Reporting`) a través de contratos definidos —
síncronos donde el negocio lo requiere, asíncronos vía `sync_outbox` donde aplica (ej. facturación).

**Rol de cada pieza dentro de la arquitectura SOA (sin degradar ni fragmentar):**

| Elemento | Rol en la arquitectura SOA |
| :--- | :--- |
| `Sales & Customer Service` (monorepo Tauri/React/SQLite) | **Servicio de entidad compuesto**, autónomo, con contrato propio hacia el resto del inventario. NO es "el consumidor de otros servicios" ni "toda la SOA". |
| `RepositoryFactory` | **Adaptador de transporte interno** del servicio — desacopla la UI de si el origen de datos es SQLite local (ejecutable) o la réplica cloud del propio servicio (Web/backoffice). No es un Service Broker entre servicios distintos. |
| Interfaces de dominio (`ITicketRepository`…) | **Contratos internos** del servicio, entre su UI y su capa de datos. No sustituyen el contrato externo (OpenAPI) que este servicio expone al resto del inventario. |
| `sync_outbox` + worker Rust | **Mensajería asíncrona confiable** entre la instancia local del servicio y su réplica/nube — mismo patrón que usará este servicio para comunicarse con otros (ej. cola de comprobantes hacia `E-Invoicing`). |
| SQLite local | **Base de datos propia de este servicio** en su despliegue local-first (cumple P5: autonomía). No es una caché de otro servicio. |
| Nube (réplica del servicio + API REST) | Contraparte cloud del **mismo** `Sales & Customer Service`, consumida directamente por su propio Backoffice Web. No es "donde vive la SOA real" — la SOA real es el conjunto de los ocho servicios, cada uno con su propia autonomía. |

**Consecuencia práctica:** ningún entregable debe presentar este servicio como si fuera insuficiente o como si
debiera fragmentarse para "parecer más SOA". Es correcto y suficiente tal como está diseñado. Lo que sí falta,
y es lo que corresponde construir en las siguientes fases, es el **resto del inventario** (§4) con el que este
servicio se conecta.

---

## 4. Inventario de Servicios — CANÓNICO

Este es el inventario oficial, heredado directamente del documento base del proyecto (`resumen_arquitectura_sistema_pos_soa.md`,
sección 3). **No se inventan servicios fuera de esta lista sin actualizar este archivo, y no se fragmenta
ninguno de los ya definidos como compuestos.**

### 4.1 Capas SOA del proyecto (sesión 9 — "Capas de SOA")

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA DE CONSUMIDORES                                       │
│  Backoffice Web (admin) · Apps externas (si las hubiera)    │
├─────────────────────────────────────────────────────────────┤
│  CAPA DE ORQUESTACIÓN / PROCESOS DE NEGOCIO (BPM)           │
│  Procesos BPMN · Coordinador de transacciones/compensación  │
├─────────────────────────────────────────────────────────────┤
│  ENTERPRISE SERVICE BUS (ESB)                               │
│  Ruteo · Transformación · Mediación · Registro · Auditoría  │
├─────────────────────────────────────────────────────────────┤
│  CAPA DE SERVICIOS DE ENTIDAD (autónomos, BD propia c/u)     │
├─────────────────────────────────────────────────────────────┤
│  CAPA DE SERVICIOS DE UTILIDAD (utility, agnósticos)        │
├─────────────────────────────────────────────────────────────┤
│  CAPA DE RECURSOS — una BD por servicio del inventario (P5)  │
└─────────────────────────────────────────────────────────────┘
```

> Nota: `Sales & Customer Service` opera en modo Local-First (terminal Desktop/Tablet + réplica cloud), por lo
> que además de exponerse como servicio del inventario, tiene su propia capa de despliegue en el borde
> (ver §5.2). Esto no lo saca del inventario ni lo convierte en "capa de consumidores" — su Backoffice Web sí
> es un consumidor de sí mismo, tal como cualquier panel de administración consume su propio servicio.

### 4.2 Servicios de Entidad (inventario canónico — 8 servicios, sin fragmentar)

| Servicio | Responsabilidad | RF que cubre | Origen |
| :--- | :--- | :--- | :--- |
| `Sales & Customer Service` | **Servicio compuesto único**: Caja, Venta/POS, Cliente/CRM, Catálogo (productos y servicios con horario/personal). Una sola BD (SQLite/SQLCipher local + réplica cloud). | RF-CAJA, RF-POS, RF-CRM, RF-CAT, RF-SERV, RF-SYNC, RF-ARQ (documento de requerimientos ya cerrado) | Diseño ya cerrado y determinante — no se reabre. |
| `Inventory Service` | Stock, Kardex, alertas de mínimos (alcance parcial: descuento, reingreso, consulta — ver nota de alcance ya documentada). | Consumido por `Sales & Customer Service` | Documento base, sección 3 |
| `Order & Booking Engine` | Motor centralizado de carritos y agendamiento de citas/turnos (pendiente confirmar fusión vs. separación, ver warning). | Consulta catálogo de servicios vía `Sales & Customer Service` | Documento base, sección 3 |
| `Payment Gateway Service` | Integración con pasarelas externas (Stripe, Niubiz, Culqi, etc.), links de pago y QR dinámicos. | RF de pasarela (a definir en su propio hito) | Documento base, sección 3 |
| `E-Invoicing Service` | Generación de XML/UBL, firma digital, envío tributario a SUNAT, generación de PDF. **Único servicio con transporte SOAP/WSDL justificado** (ver §5.1). | Consumido por `Sales & Customer Service` vía `sync_outbox` | Documento base, sección 3 |
| `Omnichannel Bot Service` | WhatsApp Cloud API, IVR, notificaciones de venta/reserva por canal digital. | Consulta catálogo vía `Sales & Customer Service` | Documento base, sección 3 |
| `Notification & Sync Service` | Notificaciones en tiempo real (WebSockets), orquestación de sincronización entre terminales y nube. | RF-SYNC (transversal) | Documento base, sección 3 |
| `Analytics & Reporting Service` | Dashboards, consolidación de ventas por canal, cierres de caja, comprobantes multi-serie. | Consume eventos de todos los demás servicios | Documento base, sección 3 |

**Importante:** Caja, Venta, Cliente/CRM y Catálogo **no son servicios separados**. Son sub-dominios internos de
`Sales & Customer Service`, ya documentados con su propia separación de responsabilidades *dentro* del servicio
(ver `sales_customer_service_arquitectura.md`, sección 5.1: "Separación de Responsabilidades del Sistema").
Esa separación interna es suficiente para el principio de **Abstracción** y **Bajo Acoplamiento** — no requiere
convertirse en servicios independientes con bases de datos distintas para cumplir SOA.

### 4.3 Servicios de Tarea (procesos que atraviesan varios servicios del inventario)

| Servicio | Proceso de negocio | Servicios que orquesta |
| :--- | :--- | :--- |
| `ProcesoVenta.Task` | Venta de mostrador hasta comprobante fiscal | `Sales & Customer Service` → `E-Invoicing Service` |
| `ReservaMulticanal.Task` | Reserva/pedido por canal digital validado contra disponibilidad real | `Omnichannel Bot Service` → `Sales & Customer Service` / `Order & Booking Engine` |
| `ConciliacionPago.Task` | Confirmación de pago remoto y actualización del ticket/reserva asociado | `Payment Gateway Service` → `Sales & Customer Service` |

> Estos procesos de tarea son la evidencia de **Composición** y **Orquestación** exigidas por el temario
> (sesiones 12, 17–19), y viven en el ESB o en un motor BPM que los coordina — no dentro de ningún servicio
> de entidad individual.

### 4.4 Servicios de Utilidad (agnósticos al negocio — máxima reutilización, P4)

| Servicio | Responsabilidad | Justificación |
| :--- | :--- | :--- |
| `Auditoria.Utility` | Registro append-only de usuario/fecha/detalle de toda operación relevante en el bus. | RNF-11 + tema de Auditoría (sesiones 31–34) |
| `Sincronizacion.Utility` | Patrón de idempotencia (UUIDv4) y backoff exponencial, reutilizable por cualquier servicio que necesite comunicación asíncrona confiable (no solo `Sales & Customer Service`). | RF-SYNC-01…07 |
| `Notificacion.Utility` | Envío de comprobantes y alertas transversales entre servicios. | Transversal |

> `ValidacionDocumento` (DNI/RUC/genérico) y `ReglasPrecio` (promociones/cupones) **no se extraen** como
> servicios de utilidad separados: son reglas de negocio propias del dominio de venta, ya resueltas dentro de
> `Sales & Customer Service` (RF-POS-17/18/19, RF-CAT-04/05). Extraerlas violaría el principio de Autonomía
> (P5) sin ningún beneficio de reutilización real, ya que ningún otro servicio del inventario las necesita.

### 4.5 Regla de autonomía (P5) — aplicada entre servicios del inventario

**Cada servicio del inventario (§4.2) tiene su propia base de datos. Ningún servicio lee directamente las tablas
de otro.** Toda interacción entre servicios distintos ocurre por contrato a través del ESB.

Esta regla se aplica **entre los ocho servicios del inventario**, no dentro de un mismo servicio compuesto. Los
sub-dominios internos de `Sales & Customer Service` (Caja, Venta, CRM, Catálogo) comparten intencionalmente una
misma base de datos local, porque son parte de un solo servicio autónomo — esa es precisamente la decisión
arquitectónica que evita llamadas cruzadas constantes en el momento del ticket de venta, ya justificada y
cerrada en el diseño base.

### 4.6 Alcance de implementación por niveles — REALISMO DE ENTREGA

El inventario tiene 8 servicios de entidad + servicios de tarea + servicios de utilidad. **Diseñarlos todos es
obligatorio; implementarlos todos con el mismo nivel de profundidad no es viable en 18 semanas.** El sílabo
evalúa la *arquitectura*, no la cantidad de código.

**Regla de oro:** los 8 servicios de entidad se **diseñan con contrato completo** (APF2, donde el diseño es lo
evaluado). La implementación se prioriza por niveles. **Nunca se empieza un nivel sin cerrar el anterior.**

| Nivel | Servicios | Estado exigido |
| :--- | :--- | :--- |
| **N1 — Núcleo demostrable** | `Sales & Customer Service` (implementación completa, ya diseñada)<br>`Auditoria.Utility` · `Sincronizacion.Utility`<br>`ProcesoVenta.Task` · `E-Invoicing Service` (SOAP)<br>**ESB · Registro UDDI** | **Implementado y funcionando.** Es el mínimo que sostiene la demo del PROY end-to-end. |
| **N2 — Ampliación** | `Inventory Service` · `Order & Booking Engine`<br>`Notification & Sync Service`<br>`ReservaMulticanal.Task` | **Implementado si N1 está cerrado.** Prioridad en ese orden. |
| **N3 — Simulado** | `Payment Gateway Service` · `Omnichannel Bot Service` · `Analytics & Reporting Service` | **Diseñado + stub registrado en UDDI.** Contrato real, respuesta simulada. Se documenta como tal. |

**Por qué N1 es exactamente este conjunto:** cubre el flujo completo *venta → comprobante → sincronización →
facturación → auditoría* que exige el PROY (§8.4), y demuestra la mediación de protocolos en el ESB
(REST del `Sales & Customer Service` ⇄ SOAP del `E-Invoicing Service` hacia SUNAT) — el único punto del
inventario donde SOAP tiene justificación técnica real (ver §5.1).

**Un stub de N3 no es trampa** si tiene contrato formal, está registrado y su naturaleza simulada está
documentada. Es una práctica legítima de *service virtualization*. Presentarlo como servicio real sí lo sería.

---

## 5. Tecnologías Obligatorias por Unidad

El sílabo nombra tecnologías explícitamente. **Todas deben aparecer demostradas en el proyecto.**
No basta con mencionarlas: debe existir un artefacto real.

| Tecnología | Sesión | Artefacto obligatorio en el proyecto |
| :--- | :--- | :--- |
| **XML + XML Schema (XSD)** | 5–6 | Esquemas canónicos del dominio en `contratos/xsd/` |
| **XSLT** | 5–6 | Transformación de mensajes en el ESB (ej. formato interno → formato SUNAT) |
| **XPath** | 5–6 | Ruteo basado en contenido dentro del ESB |
| **XQuery** | 5–6 | Consulta sobre documentos XML (ej. reportes de comprobantes) |
| **WSDL + SOAP** | 5–6, 21 | ≥1 servicio expuesto como SOAP con WSDL. **Obligatorio, sin excepción.** |
| **JSON + REST** | 5–6, 21 | Contratos OpenAPI 3.x para el resto de servicios |
| **UDDI** | 24 | Registro de servicios consultable con metadatos |
| **ESB** | 11, 15–16, 31–32 | Bus operativo con ruteo, transformación, mediación |
| **Orquestación** | 17–19 | Procesos orquestados con compensación |
| **BPM / BPMN** | 27–28 | Modelos BPMN de los procesos de negocio |
| **Auditoría** | 31–34 | Servicio de auditoría con trazabilidad completa |

### 5.1 Regla SOAP vs REST

- **REST/JSON** es el transporte primario (coherente con `RNF-16` y el diseño previo).
- **SOAP/WSDL** es **obligatorio en al menos un servicio completo** porque el sílabo lo exige (sesiones 5–6, 21).
- **Servicio designado para SOAP:** `EInvoicing.Service` — es la elección natural: la facturación electrónica
  peruana ante SUNAT usa SOAP/WSDL con firma digital XML real. Coherencia técnica + cumplimiento del temario.
- Ambos estilos se documentan comparativamente en APF1 (ítem "Servicios vs. Arquitectura distribuida Tradicional").

#### Aclaración conceptual (evita un error frecuente)

**WSDL no es una alternativa a SOAP: es su lenguaje de contrato.** No existe "WSDL sobre REST" en la práctica
(WSDL 2.0 lo permitía en teoría, pero no se adoptó). La equivalencia correcta es horizontal:

| Rol | Estilo SOAP | Estilo REST |
| :--- | :--- | :--- |
| Protocolo / formato de mensaje | SOAP (XML) | HTTP + JSON |
| Lenguaje de contrato | **WSDL** + XSD | **OpenAPI** |
| Registro / descubrimiento | UDDI | — |

Eliminar SOAP implica eliminar WSDL y UDDI con él — es decir, eliminar tres ítems explícitos del temario
(sesiones 5–6, 21, 24). **Por eso SOAP no se sustituye.**

**Sobre la verbosidad de SOAP:** es real, pero irrelevante aquí. SOAP queda confinado a **un solo servicio**
(`EInvoicing`) de todo el inventario; el resto es REST/JSON. Ese servicio emite un comprobante por venta y
opera de forma **asíncrona vía `sync_outbox`**, sin presión de latencia ni de throughput.

**Beneficio arquitectónico:** la coexistencia REST + SOAP es lo que da sentido a la **mediación de protocolos**
del ESB (REST/JSON del POS → SOAP/XML hacia SUNAT), material evaluado en el PROY (sesiones 31–32, "Servicio bus").
Un inventario 100% REST dejaría al ESB sin mediación que demostrar.

### 5.2 Stack de implementación — DECISIÓN CERRADA

> **V-06 RESUELTO.** Stack confirmado: **Node.js + TypeScript en todo el proyecto.**
> Un solo lenguaje desde el terminal POS hasta el ESB. Rust queda confinado al shell de Tauri (`src-tauri/`),
> tal como ya lo definían los documentos base. **Este stack ya no se renegocia**; cambiarlo obliga a rehacer
> los contratos y el plan de hitos.

| Componente | Tecnología | Estado |
| :--- | :--- | :--- |
| `Sales & Customer Service` (despliegue local-first) | React 18 + TS + Vite + Tailwind + Zustand + Tauri 2.0 + Rust + SQLite/SQLCipher | **Fijado, diseño ya cerrado** |
| Runtime de servicios | Node.js 22 LTS (o superior LTS) + TypeScript 5.x, ESM | **Fijado** |
| Framework de servicios | Fastify 5 + TypeBox (validación JSON Schema en el borde) | **Fijado** |
| Monorepo | pnpm workspaces (+ Turborepo si el build lo justifica) | **Fijado** |
| ESB | **Propio, en Node/TS** sobre Fastify + RabbitMQ (ver §5.3) | **Fijado** |
| Mensajería asíncrona | RabbitMQ (AMQP) — topic exchange + DLQ | **Fijado** |
| BD por servicio | PostgreSQL 16+ · **una instancia/BD por servicio** (P5) | **Fijado** |
| Acceso a datos | Drizzle ORM + migraciones propias por servicio | **Fijado** |
| Orquestación / BPM | `bpmn-engine` ejecutando `.bpmn` modelados en bpmn.io / Camunda Modeler | **Fijado** |
| Registro de servicios | Propio en Node/TS, con modelo de datos UDDI (ver §5.4) | **Fijado** |
| Pruebas | Vitest + `fastify.inject()` · cobertura v8 ≥ 80% | **Fijado** |
| Infraestructura local | Docker Compose (PostgreSQL, RabbitMQ, servicios) | **Fijado** |

#### Mapeo tecnología del sílabo → librería concreta

Cada tecnología exigida por el temario (§5) tiene una herramienta asignada. **No se improvisa en el momento.**

| Exigencia del sílabo | Librería Node/TS | Uso en el proyecto |
| :--- | :--- | :--- |
| **XML + XSD** (validación) | `xmllint-wasm` | Validación de mensajes contra XSD. WASM: no requiere compilación nativa en Windows. |
| **XSLT** | `saxon-js` + `xslt3` | Transformación de mensajes en el ESB (interno → UBL 2.1 SUNAT). XSLT 3.0. |
| **XPath** | `fontoxpath` | Ruteo por contenido en el ESB. XPath 3.1. |
| **XQuery** | `fontoxpath` | Consultas sobre documentos XML (reportes de comprobantes). XQuery 3.1. |
| **SOAP + WSDL** | `soap` (node-soap) | `EInvoicing.Service`: expone WSDL y consume el de SUNAT. WS-Security UsernameToken. |
| **Firma digital XML** | `xml-crypto` | XMLDSig sobre UBL 2.1, requisito real de SUNAT. |
| **REST + JSON + OpenAPI** | `openapi-typescript` + TypeBox/Ajv | Contract-first: OpenAPI YAML → tipos TS → handlers validados. |
| **UDDI** | Implementación propia | Modelo de datos UDDI sobre REST (§5.4). |
| **ESB** | Fastify + `amqplib` + las anteriores | Ruteo, transformación, mediación, auditoría (§5.3). |
| **BPM / BPMN** | `bpmn-engine` | Ejecuta los `.bpmn` reales de `ProcesoVenta`, `CierreCaja`, `ReservaServicio`. |

> Las versiones exactas se fijan (pin) en el `package.json` al instalar y se registran en
> `docs/03-implementacion/`. Ninguna dependencia se instala sin quedar anotada ahí.

### 5.3 Por qué un ESB propio y no uno de estante

En el ecosistema Node **no existe un ESB comercial equivalente a Apache Camel o Mule**. Construirlo es la
decisión correcta aquí, y además es la pedagógicamente superior: obliga a implementar y por tanto a demostrar
los cuatro mecanismos que el sílabo evalúa en las sesiones 11, 15–16 y 31–32.

El ESB del proyecto implementa, de forma explícita y documentada:

| Mecanismo | Implementación |
| :--- | :--- |
| **Ruteo** | Tabla de ruteo declarativa + ruteo por contenido con XPath (`fontoxpath`) |
| **Transformación** | XSLT (`saxon-js`) para XML; mapeadores TS para JSON |
| **Mediación de protocolos** | REST/JSON (POS) ⇄ SOAP/XML (SUNAT) — el caso estrella de la demo |
| **Mensajería asíncrona** | RabbitMQ: topic exchange, reintentos con backoff, dead-letter queue |
| **Auditoría** | Todo mensaje que cruza el bus se registra vía `Auditoria.Utility` (sesiones 31–34) |
| **Políticas** | Autenticación, autorización, límite de tasa, idempotencia por UUIDv4 |

**Regla:** el ESB no contiene lógica de negocio. Solo ruta, transforma, media y audita. Si aparece una regla de
negocio dentro del bus, está mal ubicada y debe moverse a un servicio.

### 5.4 Sobre UDDI

UDDI como estándar está en desuso y sus implementaciones vivas (jUDDI) son Java. Se implementa un **registro
propio en Node/TS que reproduce el modelo de datos UDDI** y lo expone vía REST:

`businessEntity` → `businessService` → `bindingTemplate` → `tModel`

Debe soportar: publicación, búsqueda por categoría/tModel, y resolución de endpoint. La correspondencia con el
estándar UDDI se documenta explícitamente en APF3 — esa documentación **es** la evidencia de la sesión 24.

---

## 6. Estructura de Carpetas OBLIGATORIA

```
ProyectoArqui/
├── CLAUDE.md                          ← este archivo
├── ARQUITECTURAORIENTADAALSERVICIO_undefined.pdf
│
├── docs/
│   ├── 00-base/                       ← requerimientos + arquitectura previa (fuente)
│   ├── 01-analisis/                   ← Unidad 1: análisis orientado a servicios
│   ├── 02-diseno/                     ← Unidad 2: diseño SOA
│   ├── 03-implementacion/             ← Unidad 3: implementación, BPM, bus, auditoría
│   ├── diagramas/                     ← .puml + .png exportados
│   ├── trazabilidad/                  ← matrices RF/RNF ↔ servicio ↔ temario
│   └── entregables/
│       ├── APF1-semana05/
│       ├── APF2-semana10/
│       ├── APF3-semana15/
│       └── PROY-semana18/
│
├── contratos/                         ← CONTRACT-FIRST. Siempre antes del código.
│   ├── xsd/                           ← esquemas canónicos del dominio
│   ├── wsdl/                          ← contratos SOAP
│   ├── openapi/                       ← contratos REST
│   └── xslt/                          ← transformaciones del ESB
│
├── servicios/
│   ├── entidad/
│   │   ├── sales-customer-service/    ← monorepo ya diseñado: src/ (React) + src-tauri/ (Rust) + réplica cloud
│   │   ├── inventory-service/
│   │   ├── order-booking-engine/
│   │   ├── payment-gateway-service/
│   │   ├── einvoicing-service/        ← único servicio con contrato SOAP/WSDL
│   │   ├── omnichannel-bot-service/
│   │   ├── notification-sync-service/
│   │   └── analytics-reporting-service/
│   ├── tarea/{proceso-venta,reserva-multicanal,conciliacion-pago}/
│   └── utilidad/{auditoria,sincronizacion,notificacion}/
│
├── esb/                               ← ruteo, mediación, transformación, políticas
├── orquestacion/                      ← BPMN, definiciones de proceso, compensación
├── registro/                          ← UDDI / catálogo de servicios
└── infra/                             ← docker-compose, scripts, despliegue
```

**Regla:** cada servicio de entidad, sin excepción, contiene: `contrato/` · `src/` · `tests/` · `README.md`
(con la ficha de servicio de §2.1 y §2.3) · `db/` (migraciones propias). En el caso de
`sales-customer-service/`, su `db/` corresponde al esquema SQLite local ya definido y su réplica cloud —
no se subdivide en carpetas por sub-dominio con bases de datos distintas.

---

## 7. Convenciones de Nomenclatura

| Elemento | Convención | Ejemplo |
| :--- | :--- | :--- |
| Servicio | `Dominio.Nombre.Tipo` | `Pos.SalesCustomer.Entity`, `Pos.EInvoicing.Entity` |
| Namespace XML | `urn:pos:{servicio}:v{n}` | `urn:pos:sales-customer:v1`, `urn:pos:einvoicing:v1` |
| Operación | Verbo + Sustantivo | `ConsultarProducto`, `RegistrarVenta` |
| Mensaje | `{Operacion}Request` / `{Operacion}Response` | `RegistrarVentaRequest` |
| Evento asíncrono | `{Entidad}{VerboPasado}` | `VentaRegistrada`, `CajaCerrada` |
| Carpeta / archivo | `kebab-case` | `validacion-documento/` |
| Documento entregable | `{HITO}-{NN}-{tema}.md` | `APF1-03-inventario-candidato.md` |
| Diagrama | `{NN}-{tema}.puml` | `02-capas-soa.puml` |
| Versión de contrato | SemVer en la ruta | `contratos/openapi/catalogo-v1.yaml` |

**Idioma:** toda la documentación en **español**. Identificadores de código en inglés solo si el dominio ya lo
usa (`sync_outbox`, `SKU`). Nombres de servicios y operaciones: **español**, por coherencia con el sílabo.

---

## 8. Entregables por Hito — DEFINICIÓN ESTRICTA

### 8.1 APF1 — Semana 5 (20%) · Unidad 1: Fundamentos

Cubre sesiones 1–9. **Producto: documento de análisis orientado a servicios + modelado conceptual.**

- [ ] **Contexto de negocio:** objetivos estratégicos del negocio ↔ procesos ↔ soporte tecnológico.
- [ ] **Marco conceptual SOA:** terminología fundamental, orientación a servicios, beneficios estratégicos.
- [ ] **Ciclo de vida de servicios** aplicado a este proyecto (las 8 etapas, §2.2).
- [ ] **Definición de servicio y sus partes** aplicada a ≥3 servicios del inventario.
- [ ] **Inventario candidato de servicios** (análisis orientado a servicios — versión preliminar).
- [ ] **Clasificación de cada servicio** según §2.3 (tipo, estado, sincronismo, granularidad, rol, seguridad).
- [ ] **Análisis Stateless vs Stateful** justificado servicio por servicio.
- [ ] **Análisis Síncrono vs Asíncrono** justificado (aquí entra el `sync_outbox` como caso asíncrono).
- [ ] **Encapsulación · Interoperabilidad · Invocación remota:** cómo los cumple el diseño.
- [ ] **SOA vs Arquitectura Distribuida Tradicional:** tabla comparativa aplicada al caso.
- [ ] **Roles de servicios y agentes de servicios** identificados en el sistema.
- [ ] **Conceptos fundamentales de seguridad** aplicados (mapea RNF-06, RNF-07, RNF-11).
- [ ] **Principios de diseño de servicios:** los 8, con la matriz de §2.1 llenada.
- [ ] **Tipos de arquitectura SOA** y cuál adopta el proyecto, con justificación.
- [ ] **Capas de SOA** del proyecto (diagrama de §4.1).
- [ ] **Tecnología SOA:** XSD del dominio + ejemplos XML + comparación SOAP/WSDL vs REST/JSON + rol de UDDI.
- [ ] **Matriz de trazabilidad** RF/RNF ↔ servicio candidato.

### 8.2 APF2 — Semana 10 (20%) · Unidad 2: Diseño y Arquitectura SOA

Cubre sesiones 11–19. **Producto: diseño arquitectónico completo. Aún sin implementación productiva.**

- [ ] **Diseño de Inventario de Servicios** definitivo (versión estable de §4).
- [ ] **Resultados de la aplicación de la orientación a servicios:** beneficios medibles obtenidos.
- [ ] **Diseño de Servicios:** ficha completa por servicio (contrato, operaciones, mensajes, políticas, SLA).
- [ ] **Contratos formales:** XSD canónicos + WSDL de `EInvoicing` + OpenAPI del resto. **Contract-first.**
- [ ] **Diseño de Composición de Servicios:** diagramas de composición de `ProcesoVenta`, `CierreCaja`,
      `ReservaServicio`, `DevolucionAnulacion`, indicando compositor, miembros y contratos.
- [ ] **Diseño del Enterprise Service Bus:** ruteo (XPath), transformación (XSLT), mediación, políticas,
      manejo de errores, patrones de mensajería aplicados.
- [ ] **Orquestación de Servicios:** flujos orquestados con estados, compensación y manejo de excepciones.
- [ ] **Matriz de los 8 principios** llenada y verificada para el inventario completo.
- [ ] **Diagramas actualizados:** el `.puml` previo reencuadrado a vista SOA (§3).
- [ ] **Modelo de datos por servicio** (una BD por servicio — P5).

### 8.3 APF3 — Semana 15 (20%) · Unidad 3: Implementación y BPM

Cubre sesiones 21–29. **Producto: servicios FUNCIONANDO. El curso es práctico.**

- [ ] **Nivel N1 completo** (§4.6) implementado y desplegado, consumible vía HTTP: `Sales & Customer Service`
      operativo (Desktop/Tablet + Web) y `E-Invoicing Service` conectados a través del ESB. N2 según tiempo disponible.
- [ ] **Servicios de Utilidad implementados**, con `Sincronizacion.Utility` demostrando reutilización real (P4)
      entre `Sales & Customer Service` y cualquier otro servicio que requiera comunicación asíncrona confiable.
- [ ] **≥1 servicio SOAP con WSDL** funcional e invocable.
- [ ] **Capas a nivel empresarial** evidenciadas en el despliegue.
- [ ] **Registro de Servicios (UDDI)** operativo, consultable, con metadatos de descubrimiento (P7).
- [ ] **Aplicación web consumidora** funcionando contra los servicios (backoffice).
- [ ] **Integración de procesos empresariales / B2B:** integración con `EInvoicing` (SUNAT) y/o `PaymentGateway`.
- [ ] **Modelos de creación de servicios web** aplicados y documentados (top-down desde contrato).
- [ ] **BPM:** modelos BPMN de `ProcesoVenta`, `CierreCaja`, `ReservaServicio` + relación BPM ↔ SOA explicada.
- [ ] **Integridad de procesos:** transacciones distribuidas, idempotencia (UUIDv4), compensación/saga,
      y cómo el `sync_outbox` la garantiza extremo a extremo (RF-SYNC-07, RNF-09).
- [ ] **Mejores prácticas SOA** aplicadas y evidenciadas.
- [ ] **Pruebas** de cada servicio con evidencia ejecutable.

### 8.4 PROY — Semana 18 (40%) · Sistema Íntegro

Cubre sesiones 31–34 + consolidación total. **Producto: sistema completo, operativo y demostrable.**

- [ ] **ESB operativo** — infraestructura de servicios en bus funcionando como punto único de integración.
- [ ] **Servicio bus:** ruteo por contenido, transformación de mensajes, mediación de protocolos (REST↔SOAP),
      desacoplamiento demostrado entre consumidores y proveedores.
- [ ] **Auditoría implementada** (tema de las sesiones 31–34, peso alto): registro append-only de toda operación
      con usuario, fecha/hora y detalle (RNF-11); trazabilidad de mensajes a través del bus; consulta de auditoría.
- [ ] **Orquestación end-to-end** ejecutándose sobre el bus.
- [ ] **`Sales & Customer Service` operativo end-to-end** en sus tres builds (Desktop, Tablet, Web), con
      sincronización asíncrona local↔cloud funcionando y conectado al resto del inventario vía ESB.
- [ ] **Demostración funcional completa:** venta → comprobante → sincronización → facturación → auditoría.
- [ ] **Operación offline demostrada** (RNF-01) con recuperación posterior.
- [ ] **Documentación arquitectónica final consolidada.**
- [ ] **Matriz de trazabilidad final:** temario del sílabo ↔ artefacto entregado. Cada ítem del temario cubierto.
- [ ] **Gobernanza de servicios:** versionado de contratos, políticas, ciclo de vida.

---

## 9. Reglas de Trabajo — Cómo Debo Operar

### 9.1 Reglas de proceso

1. **Contract-first, siempre.** Ningún servicio se implementa antes de tener su contrato (XSD + WSDL/OpenAPI)
   revisado. El contrato es el entregable; la implementación es su consecuencia.
2. **Declaro el hito.** Al empezar cualquier trabajo declaro: hito, unidad, semana y sesión del temario que cubre.
3. **Cito el temario.** Todo documento entregable abre con:
   `> Cubre: Unidad N — Sesión X — "<texto literal del temario>"`.
4. **Vocabulario canónico.** Uso los términos del sílabo, no sinónimos. "Servicio de entidad", no "microservicio
   de dominio". "Composición", no "agregación". "Inventario de servicios", no "catálogo de APIs".
5. **Checklist de los 8 principios** llenado antes de dar por diseñado cualquier servicio.
6. **Trazabilidad obligatoria.** Todo artefacto se enlaza a: (a) ítem del temario, (b) RF/RNF que cubre.
7. **Un servicio del inventario (§4.2), una BD.** Jamás propongo acceso cruzado a datos entre servicios
   distintos. Esto no obliga a fragmentar los sub-dominios internos ya definidos como parte de un mismo
   servicio compuesto (`Sales & Customer Service`: Caja, Venta, CRM, Catálogo comparten intencionalmente
   una misma base de datos, por diseño ya cerrado).
8. **Todo pasa por el ESB.** No propongo integración punto a punto entre servicios. Ese es exactamente el error
   que el curso enseña a evitar.
9. **Español** en documentación, nombres de servicios y operaciones.
10. **Entregables autocontenidos.** Cada carpeta de hito debe ser comprensible por el docente sin leer el resto.

### 9.2 Cuándo debo detenerme y preguntar

- Cuando una decisión cambie el inventario de servicios.
- Cuando el sílabo y los documentos de requerimientos se contradigan.
- Cuando falte definir el stack de implementación (§5.2) y la tarea requiera escribir código de servicios.
- Cuando un requerimiento no tenga servicio asignado.

### 9.3 Reglas de código (aplican a todo lo implementado)

- Funciones < 50 líneas · archivos < 800 líneas · anidamiento ≤ 4 niveles.
- Validación en todo borde de servicio contra su esquema (XSD/JSON Schema). **Nunca confiar en el mensaje entrante.**
- Manejo explícito de errores; nunca silenciarlos. Errores devueltos según el contrato (SOAP Fault / envelope REST).
- **Cero secretos hardcodeados.** Variables de entorno o gestor de secretos.
- Pruebas por servicio, con cobertura mínima **80%**.
- Operaciones idempotentes donde el contrato lo declare (UUIDv4).
- Auditoría append-only: nada se borra físicamente (RNF-08).

---

### 9.4 Control de versiones — UN COMMIT POR PASO

**Regla dura:** cada paso, cambio o corrección se commitea por separado. No se
acumulan varios cambios en un commit grande.

| Situación | Acción |
| :--- | :--- |
| Se implementa algo nuevo | `feat: <qué se implementó>` |
| Se corrige un fallo | `fix: <qué se arregló>` |
| Se cambia documentación | `docs: <qué documento>` |
| Se añaden o ajustan pruebas | `test: <qué se probó>` |
| Configuración, infraestructura, tooling | `chore:` o `build:` |
| Reestructuración sin cambio de comportamiento | `refactor:` |

**Nombres genéricos y descriptivos**: el título dice *qué se hizo*, en una línea.
El cuerpo explica *por qué*, cuando el porqué no es evidente.

**Antes de cada commit:** las pruebas del paquete tocado deben pasar. Un commit
que rompe la suite deja el historial inservible para volver atrás.

**Versiones marcadas:** cada hito relevante lleva un tag anotado
(`v0.1.0-n1-operativo`), para poder volver a un punto estable sin buscar entre
commits.

---

## 10. Matriz de Trazabilidad — Formato Obligatorio

Se mantiene en `docs/trazabilidad/` y se actualiza en cada hito.

**Matriz A — Temario ↔ Entregable** (garantiza que ningún ítem del sílabo quede sin cubrir)

| Unidad | Sesión | Ítem del temario | Artefacto | Hito | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |

**Matriz B — Requerimiento ↔ Servicio**

| RF/RNF | Descripción | Servicio responsable | Capa | Operación del contrato | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |

**Matriz C — Principios de diseño ↔ Servicio**

| Servicio | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | Observaciones |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |

---

## 11. Vacíos Detectados que DEBEN Resolverse

Detectados en el análisis de los documentos base. Se resuelven a más tardar en el hito indicado.

> Toda decisión que cierra un vacío se registra como ADR en [`docs/adr/`](docs/adr/README.md), con su
> justificación y lo que se descartó. Un ADR no se edita: se reemplaza.

| # | Vacío | Impacto | Resolver en |
| :--- | :--- | :--- | :--- |
| ~~V-01~~ | ~~Consulta de stock offline.~~ **RESUELTO:** `Inventory Service` también es local-first; no hay réplica dentro de Sales & Customer. Ver [ADR-006](docs/adr/006-stock-inventory-local-first.md) (reemplaza a ADR-004). | — | ✅ Cerrado |
| ~~V-02~~ | ~~Usuarios, roles y autenticación sin definir.~~ **RESUELTO:** tres roles fijos + elevación por PIN de supervisor. Ver [ADR-001](docs/adr/001-seguridad-roles-pin.md). | — | ✅ Cerrado |
| ~~V-03~~ | ~~Notas de crédito no modeladas.~~ **RESUELTO:** máquina de estados del comprobante; el estado tributario decide la reversión legal. Ver [ADR-002](docs/adr/002-anulacion-nota-credito.md). | — | ✅ Cerrado |
| ~~V-04~~ | ~~Precedencia de precios sin definir.~~ **RESUELTO:** cascada lista → promoción → cupón → manual, con bandera `acumulable`. Ver [ADR-003](docs/adr/003-precedencia-precios.md). | — | ✅ Cerrado |
| **V-07** | **Topología multi-caja por local** (documento base §4): Opción A cajas independientes vs. Opción B hub local en LAN. Define si hay concurrencia sobre el stock. | Alto | APF2 |
| **V-08** | **`Order & Booking Engine`: ¿separado o fusionado** en `Sales & Customer Service`? (documento base §5.3, §8.2). **Cambia el inventario: 8 servicios o 7.** | Alto | APF1 |
| **V-09** | **Homologación SUNAT** del modelo de series por caja con el PSE/OSE elegido (documento base §8.3). Riesgo legal, no técnico. | Medio | APF3 |
| **V-10** | **Expansión multi-local** (documento base §8.4): aislamiento de stock vs. transferencias entre almacenes. | Bajo | Fuera de alcance actual |
| V-05 | Búsqueda <300ms sobre 50k productos / 100k clientes (RNF-03 + RNF-15) requiere FTS5 sobre SQLCipher. Sin validar. | Medio | Fase 7 |
| ~~W-02~~ | ~~SQLCipher: compilación multiplataforma sin validar.~~ **RESUELTO:** OpenSSL vendorizado + Strawberry Perl como prerequisito. Ver [ADR-005](docs/adr/005-sqlcipher-openssl.md). | — | ✅ Cerrado |
| ~~V-06~~ | ~~Stack de servicios cloud y ESB sin confirmar.~~ **RESUELTO:** Node.js + TypeScript en todo el proyecto, ESB propio sobre Fastify + RabbitMQ (§5.2, §5.3). | — | ✅ Cerrado |

---

## 12. Prohibiciones Explícitas

- **Presentar `Sales & Customer Service` como si fuera *todo* el inventario SOA del proyecto.** Es uno de
  los ocho servicios (§4.2); el resto (`Inventory`, `Order & Booking`, `Payment Gateway`, `E-Invoicing`,
  `Omnichannel Bot`, `Notification & Sync`, `Analytics & Reporting`) también deben implementarse o al menos
  contractualmente definirse para que el proyecto sea evaluable como arquitectura orientada a servicios.
- **Fragmentar `Sales & Customer Service` en servicios separados con bases de datos distintas** (ej. tratar
  Catálogo, Cliente, Caja o Venta como servicios independientes) para intentar que el inventario "se vea más
  SOA". Su diseño compuesto ya está cerrado y es determinante (§3).
- **Compartir base de datos entre servicios.** Viola P5.
- **Integración punto a punto entre servicios** saltándose el ESB.
- **Implementar antes del contrato.**
- **Omitir SOAP/WSDL.** El sílabo lo exige literalmente.
- **Omitir Auditoría.** Ocupa las sesiones 31–34, justo antes del PROY que vale 40%.
- **Introducir tecnología fuera del temario** sin marcarla como *extensión justificada* con: (a) por qué el
  temario no basta, (b) qué ítem del temario refuerza, (c) aprobación explícita del estudiante.
- **Entregar un hito incompleto.** No hay rezagados ni reemplazo de notas.
- **Diseñar servicios sin vínculo a un objetivo estratégico del negocio.**
- **Cambiar el stack de §5.2.** La decisión está cerrada; cambiarla invalida contratos y plan de hitos.
- **Poner lógica de negocio dentro del ESB.** El bus rutea, transforma, media y audita — nada más (§5.3).
- **Instalar dependencias sin registrarlas** en `docs/03-implementacion/`.
- **Implementar servicios del Nivel 3** (§4.6) en lugar de completar los del Nivel 1.

---

## 13. Checklist de Cierre — Antes de Entregar CUALQUIER Hito

- [ ] Cada ítem del temario de la unidad correspondiente tiene artefacto (Matriz A).
- [ ] Cada servicio nuevo o modificado tiene su ficha completa (§2.1 + §2.3).
- [ ] Matrices A, B y C actualizadas.
- [ ] Diagramas regenerados y exportados a imagen.
- [ ] Vocabulario canónico verificado (§9.1, regla 4).
- [ ] Vacíos de §11 asignados a este hito: resueltos.
- [ ] Carpeta del hito autocontenida y legible de forma independiente.
- [ ] Sin secretos en el repositorio.
- [ ] Si hay código: pruebas pasando, cobertura ≥ 80%.
- [ ] Trazabilidad al logro general de aprendizaje (§1.3) explícita.

---

## 14. Glosario Canónico

| Término | Definición operativa en este proyecto |
| :--- | :--- |
| **Servicio** | Unidad de lógica autónoma, con contrato formal, reutilizable y componible. |
| **Contrato** | Especificación formal, versionada y tecnológicamente neutral (XSD + WSDL/OpenAPI). |
| **Inventario de servicios** | Colección gobernada de todos los servicios del dominio empresarial. |
| **Composición** | Agregación de servicios que resuelve una tarea de negocio. |
| **Orquestación** | Coordinación centralizada de una composición, con un compositor explícito. |
| **Coreografía** | Coordinación descentralizada por eventos, sin compositor central. |
| **ESB** | Infraestructura de integración: ruteo, transformación, mediación, políticas, auditoría. |
| **Servicio de entidad** | Centrado en una entidad de negocio (Cliente, Producto). Alta reutilización. |
| **Servicio de tarea** | Encapsula un proceso de negocio específico. Baja reutilización, alta composición. |
| **Servicio de utilidad** | Agnóstico al negocio, transversal (auditoría, validación, notificación). |
| **Agente de servicio** | Componente que intercepta y procesa mensajes de forma transparente. |
| **Idempotencia** | Reprocesar el mismo mensaje no produce efectos duplicados (UUIDv4). |
| **Compensación** | Transacción inversa que revierte un paso ya confirmado de un proceso largo. |
| **Gobernanza** | Políticas de versionado, ciclo de vida y cumplimiento del inventario. |

---

*Este archivo se actualiza cuando cambie el inventario de servicios, se resuelva un vacío de §11, o se confirme
una decisión pendiente de §5.2.*
