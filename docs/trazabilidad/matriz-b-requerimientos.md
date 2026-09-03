# Matriz B — Requerimiento ↔ Servicio

> Formato obligatorio de [`CLAUDE.md` §10](../../CLAUDE.md). Cada RF/RNF de
> [`requerimientos.md`](../00-base/requerimientos.md) tiene servicio responsable y operación del
> contrato.

**Estado:** ✅ implementado y probado · 🔶 parcial · ⏳ diseñado, sin implementar

Los grupos RF-CAJA, RF-POS, RF-CRM, RF-CAT y RF-SERV son responsabilidad de
`Sales & Customer Service` — **no porque falte separarlos, sino porque son sus cuatro
sub-dominios internos** ([`CLAUDE.md` §3](../../CLAUDE.md)). Fragmentarlos está prohibido.

---

## RF-ARQ — Arquitectura de despliegue

| RF | Descripción | Servicio | Capa | Operación / artefacto | Estado |
| :--- | :--- | :--- | :--- | :--- | :-: |
| RF-ARQ-01 | Un solo código para Desktop, Tablet y Web | `Sales & Customer Service` | Entidad | `RepositoryFactory` | ⏳ |
| RF-ARQ-02 | Build Desktop y Tablet con datos locales | `Sales & Customer Service` | Entidad | Tauri 2.0 + SQLCipher | ⏳ |
| RF-ARQ-03 | Build Web contra la réplica cloud | `Sales & Customer Service` | Entidad | React estático → REST | ⏳ |

## RF-CAJA — Turnos, movimientos y arqueo

| RF | Descripción | Servicio | Capa | Operación | Estado |
| :--- | :--- | :--- | :--- | :--- | :-: |
| RF-CAJA-01 | Apertura de turno con fondo inicial | `Sales & Customer` | Entidad | `AbrirTurno` | ✅ |
| RF-CAJA-02 | Sin turno abierto no se registra venta | `Sales & Customer` | Entidad | `CrearTicket` (regla) | ✅ |
| RF-CAJA-03 | Movimientos manuales con motivo obligatorio | `Sales & Customer` | Entidad | `RegistrarMovimientoCaja` | ✅ |
| RF-CAJA-04 | Consulta del turno vigente | `Sales & Customer` | Entidad | `ConsultarTurnoActual` | ✅ |
| RF-CAJA-05 | Cierre con arqueo | `Sales & Customer` · `CierreCaja.Task` | Entidad · Tarea | `CerrarTurno` · `EjecutarCierreCaja` | ✅ |
| RF-CAJA-06 | Arqueo ciego y asistido | `Sales & Customer` | Entidad | `CerrarTurno` (`modo`) | ✅ |
| RF-CAJA-07 | Desglose por forma de pago | `Sales & Customer` | Entidad | `calcularDesglose` | ✅ |
| RF-CAJA-08 | Registro del descuadre para revisión | `CierreCaja.Task` | Tarea | Desenlace `FinDescuadre` | ✅ |
| RF-CAJA-09 | Autorización de supervisor para cerrar | `Sales & Customer` | Entidad | `codigoAutorizacion` ([ADR-001](../adr/001-seguridad-roles-pin.md)) | ✅ |
| RF-CAJA-10 | Historial de cierres | `Sales & Customer` | Entidad | `ConsultarCierres` | ✅ |

## RF-POS — Venta y comprobantes

| RF | Descripción | Servicio | Capa | Operación | Estado |
| :--- | :--- | :--- | :--- | :--- | :-: |
| RF-POS-01 | Búsqueda de items durante la venta | `Sales & Customer` | Entidad | `BuscarItemsCatalogo` | ✅ |
| RF-POS-02…03 | Armado del ticket con líneas | `Sales & Customer` | Entidad | `CrearTicket` · `AgregarLineaTicket` | ✅ |
| RF-POS-04 | Alta rápida de cliente sin salir del ticket | `Sales & Customer` | Entidad | `RegistrarCliente` | ✅ |
| RF-POS-05…06 | Totales e IGV desagregado | `Sales & Customer` | Entidad | `recalcular` | ✅ |
| RF-POS-07 | Vuelto solo sobre efectivo | `Sales & Customer` | Entidad | `CerrarVenta` | ✅ |
| RF-POS-08 | Pago combinado en varias formas | `Sales & Customer` | Entidad | `CerrarVenta` | ✅ |
| RF-POS-09 | Persistencia incremental del ticket | `Sales & Customer` | Entidad | `guardar` tras cada línea | ✅ |
| RF-POS-10…13 | Anulación y devolución | `Sales & Customer` | Entidad | `RevertirVenta` ([ADR-002](../adr/002-anulacion-nota-credito.md)) | ✅ |
| RF-POS-14…16 | Emisión local del comprobante | `Sales & Customer` | Entidad | `CerrarVenta` (correlativo por serie) | ✅ |
| RF-POS-17 | Validación del documento del cliente | `Sales & Customer` | Entidad | `validarDocumento` | ✅ |
| RF-POS-18 | Bloqueo del comprobante incompatible | `Sales & Customer` · `ProcesoVenta.Task` | Entidad · Tarea | `VerificarComprobante` → `FinIncompatible` | ✅ |
| RF-POS-19 | Promociones y cupones | `Sales & Customer` | Entidad | `aplicarCascada` ([ADR-003](../adr/003-precedencia-precios.md)) | ✅ |

## RF-CRM — Clientes

| RF | Descripción | Servicio | Capa | Operación | Estado |
| :--- | :--- | :--- | :--- | :--- | :-: |
| RF-CRM-01 | Alta en las tres modalidades (DNI/RUC/genérico) | `Sales & Customer` | Entidad | `RegistrarCliente` | ✅ |
| RF-CRM-02 | Validación de formato antes de asociar | `Sales & Customer` | Entidad | `validarDocumento` | ✅ |
| RF-CRM-03 | Búsqueda en tiempo real | `Sales & Customer` | Entidad | `BuscarClientes` | ✅ |
| RF-CRM-04 | Ficha completa del cliente | `Sales & Customer` | Entidad | `ConsultarCliente` | ✅ |
| RF-CRM-05 | Segmentación | `Sales & Customer` | Entidad | Campo `segmento` → lista de precios | ✅ |
| RF-CRM-06 | Fidelización por puntos | `Sales & Customer` | Entidad | Campo `fidelizacion` | 🔶 |
| RF-CRM-07 | Desactivar, nunca eliminar | `Sales & Customer` | Entidad | `ActualizarCliente` (`activo`) | ✅ |

## RF-CAT — Catálogo

| RF | Descripción | Servicio | Capa | Operación | Estado |
| :--- | :--- | :--- | :--- | :--- | :-: |
| RF-CAT-01…03 | Productos, variantes y combos | `Sales & Customer` | Entidad | `RegistrarItemCatalogo` | ✅ |
| RF-CAT-04…05 | Listas de precios y promociones | `Sales & Customer` | Entidad | `CalcularPrecio` | ✅ |
| RF-CAT-06 | Búsqueda por texto, tipo y categoría | `Sales & Customer` | Entidad | `BuscarItemsCatalogo` | ✅ |
| RF-CAT-07 | Desactivar sin borrar del histórico | `Sales & Customer` | Entidad | Campo `activo` | ✅ |
| RF-CAT-08 | Versionado del catálogo | `Sales & Customer` | Entidad | `vigenteDesde` / `vigenteHasta` | 🔶 |

## RF-SERV — Servicios con horario y personal

| RF | Descripción | Servicio | Capa | Operación | Estado |
| :--- | :--- | :--- | :--- | :--- | :-: |
| RF-SERV-01…02 | Item de tipo SERVICIO con duración | `Sales & Customer` | Entidad | `datosServicio` en el catálogo | ✅ |
| RF-SERV-03…04 | Especialista y recurso asignados | `Sales & Customer` | Entidad | `datosServicio.especialistas` / `.recursos` | ✅ |
| RF-SERV-05…08 | Agenda, disponibilidad y bloqueo de franja | `Order & Booking Engine` | Entidad | Contrato definido — **sujeto a [V-08](../../CLAUDE.md)** | ⏳ |

## RF-SYNC — Sincronización

| RF | Descripción | Servicio | Capa | Operación | Estado |
| :--- | :--- | :--- | :--- | :--- | :-: |
| RF-SYNC-01…05 | Outbox, empuje y descarga de cambios | `Sales & Customer` · `Sincronizacion.Utility` | Entidad · Utilidad | `EmpujarEventos` · `DescargarCambios` | ⏳ |
| RF-SYNC-06 | Backoff exponencial en el reintento | `E-Invoicing Service` | Entidad | `proximoIntento` | ✅ |
| RF-SYNC-07 | Idempotencia por UUIDv4 | Todo el inventario | Transversal | `claveDeOperacion` en `service-kit` | ✅ |

---

## Requisitos no funcionales

| RNF | Descripción | Dónde se cumple | Estado |
| :--- | :--- | :--- | :-: |
| RNF-01 | Opera sin conexión | Emisión local del correlativo · `FinPendiente` en `ProcesoVenta` · drenaje best-effort en `CierreCaja` | ✅ |
| RNF-02 | Escritura local < 200 ms | Repositorios en memoria hoy; a validar sobre SQLCipher | ⏳ |
| RNF-03 | Búsqueda < 300 ms sobre 50k/100k | Semántica lista (búsqueda normalizada); **falta medir** — vacío V-05 | 🔶 |
| RNF-04 | Modo táctil, objetivos de 48 px | Terminal POS | ⏳ |
| RNF-05 | Atajos F1–F12 en escritorio | Terminal POS | ⏳ |
| RNF-06 | Autenticación y roles | [ADR-001](../adr/001-seguridad-roles-pin.md) — `codigoAutorizacion` en operaciones sensibles | 🔶 |
| RNF-07 | Cifrado en tránsito y en reposo | SQLCipher ([ADR-005](../adr/005-sqlcipher-openssl.md)) · TLS hacia SUNAT | 🔶 |
| RNF-08 | Nada se borra físicamente | Cliente y catálogo se desactivan · auditoría append-only | ✅ |
| RNF-09 | Reprocesar no duplica | Idempotencia acotada por operación en `service-kit` | ✅ |
| RNF-10 | Recuperación tras cierre forzado | Ticket persistido antes de la primera línea | ✅ |
| RNF-11 | Trazabilidad con usuario, fecha y detalle | `Auditoria.Utility` — 24 pasos por venta bajo un `correlationId` | ✅ |
| RNF-12…14 | Disponibilidad, respaldo, despliegue | `infra/docker-compose.yml` | 🔶 |
| RNF-15 | Rendimiento con catálogo grande | Junto con RNF-03 | 🔶 |
| RNF-16 | REST/JSON como transporte primario | Todo el inventario salvo `E-Invoicing` ([`CLAUDE.md` §5.1](../../CLAUDE.md)) | ✅ |
| RNF-17 | Contratos versionados | `contratos/**/*-v1.*` · namespaces `urn:pos:*:v1` | ✅ |
| RNF-18 | Comprobante coherente con el documento | `verificarCompatibilidad` + desenlace `FinIncompatible` | ✅ |
| RNF-19 | Cobertura de pruebas ≥ 80 % | 465 pruebas; umbral en `vitest.config.base.ts` | ✅ |

---

## Dónde está el hueco real

Todo lo que falta se concentra en **dos frentes**, no repartido por el dominio:

1. **El terminal (RF-ARQ, RNF-02/04/05)** — sin él no hay medición de rendimiento local ni modo
   táctil. Es también el ítem *Creando aplicaciones web* de la [Matriz A](matriz-a-temario.md).
2. **La agenda (RF-SERV-05…08)** — bloqueada por **V-08**: decidir si `Order & Booking Engine`
   es un servicio separado o se fusiona en `Sales & Customer`. Esa decisión cambia el inventario
   de 8 a 7 servicios de entidad y no debe tomarse por inercia.

El resto del dominio de venta —caja, ticket, comprobante, cliente, catálogo, reversión— está
implementado y probado.
