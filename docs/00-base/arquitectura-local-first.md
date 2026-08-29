# Sales & Customer Service — Arquitectura Local-First

## Contexto y Resultado de Diseño

Este documento consolida el diseño arquitectónico definido para el servicio **Sales & Customer Service**, núcleo del sistema POS, que unifica Caja, Punto de Venta, Clientes/CRM y Catálogo (productos y servicios) bajo un único dominio funcional.

El sistema se construye bajo un esquema **Local-First (Offline-First)**: la operación diaria del negocio (venta, caja, cliente, catálogo) funciona de manera completamente autónoma en el dispositivo local, sin depender de conexión a internet, y se sincroniza hacia la nube cuando la conexión está disponible.

---

## 1. Stack Tecnológico

| Capa / Módulo | Tecnología | Función Principal |
| :--- | :--- | :--- |
| Interfaz de Usuario (UI) | React 18 + TypeScript + Vite | Componentes reactivos, vistas del POS y flujos de usuario. |
| Diseño y Maquetación | Tailwind CSS | Sistema de diseño adaptativo para escritorio y tablet (objetivos táctiles). |
| Gestión de Estado | Zustand | Control en memoria de la sesión activa, estado de caja y ticket en curso. |
| Contenedor Nativo | Tauri 2.0 | Empaquetado de la app nativa para Windows y Android (iOS queda como fase futura). |
| Motor Backend Local | Rust (`tokio` / `rusqlite`) | Manejo de hardware, entrada/salida de disco, hilos secundarios, worker de sincronización. |
| Persistencia Local | SQLite + SQLCipher | Base de datos embebida en el dispositivo, con cifrado en reposo. |
| Base de Datos Cloud (Web/Backoffice) | MySQL / PostgreSQL | Base de datos principal para la versión Web (administración remota), consultada vía API REST. |
| Integración Cloud / Web | REST API (OpenAPI) | Contrato de comunicación bidireccional entre terminales locales y servicios en la nube. |

### Estructura del Monorepo

- `src/`: código React compartido — componentes de POS, CRM, Caja, Catálogo y Panel de Administración.
- `src-tauri/`: núcleo Rust — comandos IPC, controladores SQLite, integración de cámara/impresora, worker de sincronización.

### Entregables por plataforma

| Plataforma | Formato | Motor de renderizado |
| :--- | :--- | :--- |
| Windows Desktop | `.exe` / `.msi` | WebView2 |
| Android Tablet | `.apk` / `.aab` | Android System WebView |
| Web Browser (backoffice) | Compilación estática de React | Navegador estándar, sin SQLite local — consume API REST contra MySQL/PostgreSQL en la nube |

> iPad/iOS queda documentado como plataforma futura (ver sección de Warnings y Trabajo Futuro), dada la menor madurez de Tauri en ese entorno y las restricciones de Apple sobre acceso a hardware periférico (impresoras térmicas).

---

## 2. Patrón de Sincronización: Transactional Outbox

### Principio de funcionamiento

1. **Escritura local inmediata:** toda operación relevante (venta, movimiento de caja, alta/edición de cliente) se registra directamente en SQLite local. La respuesta a la interfaz se entrega en menos de 200ms, sin requerir conexión a internet.
2. **Cola de salida (`sync_outbox`):** cada transacción genera de forma atómica un evento con `UUIDv4` único en una tabla local de sincronización.
3. **Worker asíncrono en Rust:** proceso en segundo plano que verifica periódicamente la conectividad. Al detectar red disponible, envía los eventos pendientes de forma idempotente. Ante fallos de comunicación, reintenta automáticamente con backoff exponencial.

### Persistencia incremental del ticket en curso (recuperación ante fallos)

Cada modificación al ticket de venta (agregar producto, cambiar cantidad, quitar ítem) se persiste de inmediato en SQLite como "ticket en progreso, no cerrado" — no solo se mantiene en el estado en memoria (Zustand). Ante un cierre inesperado de la aplicación (corte de energía, congelamiento, crash), al reiniciar el sistema debe ofrecer al operador recuperar el ticket sin terminar, evitando la pérdida de trabajo en curso. Este comportamiento es análogo al autoguardado de borradores en editores de texto o clientes de correo.

### Resolución simplificada (una sola sucursal/caja)

Al operar con una sola caja, no existen múltiples orígenes de escritura concurrente sobre el mismo dato, por lo que no se requiere una estrategia compleja de resolución de conflictos entre nodos. Las reglas aplicadas son:

| Tipo de dato | Regla |
| :--- | :--- |
| Catálogo / precios | La nube manda; los cambios desde el backoffice web se descargan (pull) al dispositivo local. |
| Ventas / movimientos de caja | Append-only: nunca se sobrescriben, se insertan y se consolidan en la nube. |
| Comprobantes fiscales | Correlativo generado localmente por serie de caja; el estado tributario se actualiza al sincronizar. |

---

## 3. Facturación Electrónica Offline-First (Perú — SUNAT)

- Cada caja/punto de emisión tiene asignada una **serie propia de comprobantes** (ej. Caja 1 → `B001`/`F001`), práctica estándar y esperada por la normativa de SUNAT.
- Cada caja lleva su propio correlativo de forma local e independiente, sin necesidad de validar con la nube ni con otras cajas antes de emitir.
- **Flujo:** el comprobante se genera y entrega al cliente de inmediato (ticket/PDF local); se marca como `pendiente_envio_tributario = true`; el worker de sincronización lo envía al `E-Invoicing Service` cuando hay conexión; SUNAT responde con estado (`aceptado`, `observado`, `rechazado`), que se refleja de vuelta en el registro local.
- El **Backoffice web** consolida todas las series de todas las cajas en una vista unificada, evitando revisión manual caja por caja.

---

## 4. Integración de Hardware y Adaptabilidad de Interfaz

### Escaneo de código de barras / QR

- **Tablet:** acceso directo a cámara mediante plugins nativos de Tauri (MLKit en Android, VisionKit en iOS a futuro).
- **Desktop / Web:** captura vía cámara USB/webcam con `@zxing/browser`, o lectura mediante escáneres ópticos USB HID.
- Ambas rutas se exponen bajo una interfaz común (adaptador de escaneo) para que el resto de la aplicación no dependa de cuál implementación esté corriendo.

### Impresión térmica y periféricos

- Envío de comandos ESC/POS desde el motor Rust hacia puertos USB, puerto serie (COM), o impresoras en red local (WiFi/Ethernet).

### Adaptabilidad UI/UX

- **Modo Tablet:** botones con área de contacto mínima de 48px, teclado numérico táctil, navegación optimizada para gestos.
- **Modo Desktop:** vista densa, con soporte de atajos de teclado (`F1`–`F12`) para agilizar el cobro continuo.

---

## 5. Separación de Responsabilidades del Sistema

### 5.1 Dentro del propio proyecto (Sales & Customer Service)

Aunque el servicio se implementa como un monorepo único, internamente mantiene una separación clara de sub-dominios, cada uno con su propia lógica y modelo de datos, comunicados dentro del mismo proceso (no como microservicios separados, sino como módulos con límites claros):

| Sub-dominio | Responsabilidad | Expone API interna a |
| :--- | :--- | :--- |
| Caja | Apertura/cierre, turnos, arqueos, movimientos de efectivo. | Módulo de Venta (POS) |
| Venta (POS) | Armado de ticket, cobro, comprobantes, promociones aplicadas. | Módulo de Caja, E-Invoicing Service |
| Cliente / CRM | Ficha de cliente, historial, fidelización, segmentación. | Módulo de Venta, Order & Booking Engine |
| Catálogo | Productos, variantes, servicios, precios, promociones. | Inventory Service, Order & Booking Engine, Omnichannel Bot Service |

Esta separación interna es la que permite que, en una eventual evolución del sistema, alguno de estos sub-dominios pueda extraerse como servicio independiente sin rediseñar el modelo de datos desde cero.

### 5.2 Relación con el Inventory Service (alcance parcial)

El sistema contempla la existencia de un `Inventory Service` para el control de stock (Kardex, alertas de mínimos, trazabilidad por lote/vencimiento). Sin embargo, **no todos los casos de uso de un sistema de inventario completo aplican a este proyecto**. El alcance real utilizado por Sales & Customer Service se limita a:

- Descuento de stock al confirmar una venta.
- Reingreso de stock ante anulación o devolución.
- Consulta de disponibilidad al momento de agregar un producto al ticket.

Quedan fuera del alcance actual (por no ser necesarios para la operación de una sola caja/sucursal): transferencias entre almacenes, control multialmacén complejo, y trazabilidad avanzada de lotes/vencimientos en escenarios multi-sucursal. Estos casos de uso permanecen documentados en el `Inventory Service` como capacidades disponibles del servicio, pero no forman parte del flujo operativo actual de Sales & Customer Service.

---

## 6. Separación de Capas (Clean Architecture)

Independientemente de la separación de sub-dominios funcionales (sección 5.1), el proyecto aplica un segundo nivel de separación a nivel técnico, orientado a que la UI nunca dependa directamente de un mecanismo de persistencia o transporte concreto.

### 6.1 Contratos de Dominio

- La UI en React interactúa **únicamente con interfaces abstractas** (ej. `ITicketRepository`, `IClientRepository`, `ICatalogRepository`), nunca con SQLite ni con llamadas HTTP directas.
- Estas interfaces definen los casos de uso del dominio (crear venta, buscar cliente, consultar catálogo) sin exponer detalles de implementación.

### 6.2 Conmutación Transparente (`RepositoryFactory`)

- Un `RepositoryFactory` detecta el entorno de ejecución en tiempo de arranque de la aplicación:
  - **Ejecutable instalado (Desktop/Tablet, Tauri):** el factory resuelve las interfaces hacia implementaciones que invocan comandos IPC de Rust, los cuales operan sobre SQLite local.
  - **Entorno Web (backoffice):** el factory resuelve las mismas interfaces hacia implementaciones que realizan llamadas REST directas contra la API en la nube.
- Gracias a este patrón, **el mismo código de UI (componentes, vistas, lógica de pantalla) es compartido entre Desktop, Tablet y Web**, sin necesidad de ramas condicionales dispersas por plataforma. La diferencia de origen de datos queda completamente aislada en la capa de implementación de repositorios.

### 6.3 Beneficio directo para el modelo Local-First

Este patrón es lo que permite que el mismo monorepo (sección 1) compile hacia binarios nativos u hoja estática web sin duplicar lógica de negocio: la lógica de dominio (reglas de venta, validación de documentos, promociones) vive una sola vez, y solo cambia el adaptador de datos según la plataforma.

---

## 7. Identificación de Cliente y Tipo de Comprobante

### 7.1 Modelo de identificación de cliente

El cliente asociado a una venta puede registrarse bajo tres modalidades:

| Modalidad | Identificador | Uso típico |
| :--- | :--- | :--- |
| Persona natural | DNI | Emisión de Boleta de venta. |
| Persona jurídica / empresa | RUC | Emisión de Factura. |
| Cliente genérico | Identificador genérico interno + nombre (sin documento tributario formal) | Emisión de Nota de venta (comprobante no fiscal). |

### 7.2 Validador de tipo de documento

El sistema incorpora un **validador de tipo de documento** que condiciona el tipo de comprobante disponible para emisión, evitando que se genere un comprobante fiscal inválido para el identificador ingresado:

- Si el cliente se identifica con **DNI** → habilita la emisión de **Boleta de venta**.
- Si el cliente se identifica con **RUC** → habilita la emisión de **Factura**.
- Si el cliente se registra como **genérico** (solo nombre, sin documento tributario) → el sistema restringe la emisión a **Nota de venta**, no siendo válido para Boleta ni Factura ante SUNAT.

Esta validación ocurre en el mismo sub-dominio de Venta (POS), antes del cierre del ticket, para evitar que el comprobante se genere y luego resulte rechazado o inválido en el envío tributario posterior (ver sección 3, Facturación Electrónica Offline-First).

---

## 8. Productos como Servicios: Modelo de Distribución por Horario

Dentro del Catálogo, un producto puede definirse como tipo **Servicio**, lo cual habilita un conjunto de características adicionales no aplicables a productos físicos:

- **Registro de servicio con horario específico único:** cada instancia de un servicio agendado ocupa una franja horaria concreta (fecha, hora de inicio, duración), y esa franja queda bloqueada para evitar doble asignación.
- **Personal encargado:** el servicio se asocia a uno o más especialistas/recursos humanos disponibles, cuya agenda individual se contempla al momento de reservar.
- **Duración estimada:** determina cuánto tiempo ocupa la franja horaria del especialista y del recurso asociado.
- **Disponibilidad de recursos:** más allá del personal, un servicio puede requerir recursos físicos limitados (ej. una sala, una silla, un equipo), que también deben validarse como disponibles en la franja solicitada.

Este modelo diferencia claramente la venta de un producto físico (que depende de stock) de la venta de un servicio (que depende de disponibilidad de tiempo y personal), tal como se definió en la matriz diferencial de dominio del documento base del proyecto.

---

## 9. Warnings y Trabajo Futuro (con complejidad estimada)

| # | Tema | Descripción | Complejidad futura | Condición de activación |
| :--- | :--- | :--- | :--- | :--- |
| W-01 | Soporte iOS/iPad | Empaquetado Tauri para iPad, integración de impresión térmica bajo restricciones de Apple, proceso de revisión de App Store. | Media-Alta | Si el negocio requiere operar desde iPad. |
| W-02 | Build multiplataforma de SQLCipher | Compilación de `rusqlite` con `bundled-sqlcipher` contra OpenSSL/LibreSSL por plataforma (Windows/Android/iOS) dentro del pipeline de CI/CD. | Media | Se mantiene como advertencia de configuración; no bloquea el desarrollo actual. |
| W-03 | Hub local (topología multi-caja) | Introducción de un nodo intermedio (mini-servidor en LAN) para que múltiples cajas del mismo local compartan stock y cliente en tiempo real sin depender de internet. | Alta | Si el negocio escala a 2+ cajas operando simultáneamente en el mismo local. |
| W-04 | Consistencia mostrador vs. canal digital | Validación de disponibilidad de stock/agenda entre la venta física de mostrador y los canales digitales (WhatsApp, E-commerce), para evitar promesas de productos o citas ya no disponibles. | Media-Alta | Al integrarse el `Omnichannel Bot Service` y/o `Order & Booking Engine` con operación simultánea al mostrador. |
| W-05 | Alcance ampliado del Inventory Service | Activación de transferencias entre almacenes, control multialmacén y trazabilidad avanzada de lotes/vencimientos. | Media | Si el negocio se expande a múltiples sucursales o requiere trazabilidad regulatoria de lotes. |

---

## 10. Próximos Pasos

1. Definir el modelo de datos detallado (esquema ER) para SQLite y su contraparte en MySQL/PostgreSQL, incluyendo los campos de sincronización (`sync_status`, `updated_at`, `uuid`).
2. Especificar el contrato OpenAPI de los endpoints de sincronización (push/pull) y de los sub-dominios expuestos (Catálogo, Cliente).
3. Diseñar el flujo de reserva de servicios con validación de disponibilidad de personal/recurso en la franja horaria solicitada.
4. Definir el proveedor de facturación electrónica (PSE/OSE) para Perú y validar formalmente el modelo de series por caja.
