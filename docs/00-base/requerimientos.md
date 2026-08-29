# Sales & Customer Service — Requerimientos Funcionales y No Funcionales

## Alcance del Servicio

Servicio núcleo del sistema que unifica: operativa de caja, punto de venta, gestión de clientes/CRM, catálogo de productos y servicios (con distribución por horario), y motor de promociones. Opera bajo un modelo Local-First (SQLite en Desktop/Tablet) con sincronización hacia una nube basada en MySQL/PostgreSQL, y aplica Clean Architecture para compartir la lógica de UI entre plataformas.

---

## 1. Requerimientos Funcionales (RF)

### 1.1 Caja

| ID | Requerimiento |
| :--- | :--- |
| RF-CAJA-01 | Permitir apertura de caja con registro de fondo inicial antes de habilitar ventas. |
| RF-CAJA-02 | Impedir el registro de ventas sin una caja abierta para el turno/usuario actual. |
| RF-CAJA-03 | Registrar ingresos y egresos parciales de efectivo con motivo obligatorio. |
| RF-CAJA-04 | Calcular balance esperado al cierre (fondo inicial + ventas efectivo + ingresos − egresos) y compararlo contra el conteo físico. |
| RF-CAJA-05 | Soportar arqueos ciegos y asistidos. |
| RF-CAJA-06 | Mostrar desglose de ventas por forma de pago al cierre. |
| RF-CAJA-07 | Soportar múltiples turnos de cajero por día, cada uno con su propio arqueo. |
| RF-CAJA-08 | Registrar el usuario responsable de cada apertura, movimiento y cierre (trazabilidad). |
| RF-CAJA-09 | Mostrar visualizador dinámico del monto actual en caja, actualizado en tiempo real. |
| RF-CAJA-10 | Permitir consulta de historial de cierres anteriores (solo lectura, auditoría). |

### 1.2 Venta (POS)

| ID | Requerimiento |
| :--- | :--- |
| RF-POS-01 | Crear ticket y agregar productos/servicios por búsqueda alfanumérica o escaneo. |
| RF-POS-02 | Escanear código de barras/QR vía cámara de tablet, webcam o escáner USB HID. |
| RF-POS-03 | Modificar cantidades, aplicar descuentos manuales (con permiso) y eliminar ítems antes del cierre. |
| RF-POS-04 | Asociar cliente existente o registrar uno nuevo sin abandonar el ticket. |
| RF-POS-05 | Permitir ventas sin cliente asociado. |
| RF-POS-06 | Cobrar con múltiples formas de pago combinadas en un mismo ticket. |
| RF-POS-07 | Calcular vueltos automáticamente en pagos en efectivo. |
| RF-POS-08 | Suspender/guardar un ticket en curso y retomarlo posteriormente. |
| RF-POS-09 | Persistir cada modificación del ticket en curso de forma incremental en SQLite (no solo al cierre), permitiendo recuperación ante crash o corte de energía. |
| RF-POS-10 | Anular una venta cerrada, con motivo y usuario autorizante registrados. |
| RF-POS-11 | Realizar devoluciones parciales o totales, actualizando stock y caja. |
| RF-POS-12 | Generar el comprobante correspondiente (nota de venta, boleta o factura) al cerrar la venta. |
| RF-POS-13 | Mostrar catálogo visual por categorías, con navegación táctil. |
| RF-POS-14 | Aplicar promociones automáticamente cuando el ticket cumpla las condiciones configuradas. |
| RF-POS-15 | Aplicar cupones de descuento por código manual o escaneo. |
| RF-POS-16 | Aplicar automáticamente la lista de precios correspondiente al cliente asociado. |
| RF-POS-17 | Incorporar un validador de tipo de documento que condicione el tipo de comprobante disponible: DNI → habilita Boleta; RUC → habilita Factura; cliente genérico → restringe a Nota de venta. |
| RF-POS-18 | Impedir el cierre de un ticket con un tipo de comprobante incompatible con el identificador del cliente asociado. |
| RF-POS-19 | Permitir cambiar el tipo de identificador del cliente antes del cierre del ticket, si se desea un comprobante distinto al inicialmente seleccionado. |

### 1.3 Cliente / CRM

| ID | Requerimiento |
| :--- | :--- |
| RF-CRM-01 | Registrar cliente bajo tres modalidades: DNI (persona natural), RUC (persona jurídica), o identificador genérico interno + nombre (sin documento tributario). |
| RF-CRM-02 | Validar el formato del documento ingresado (DNI: 8 dígitos; RUC: 11 dígitos con estructura válida) antes de asociarlo al cliente. |
| RF-CRM-03 | Buscar clientes por nombre, documento, teléfono o correo, en tiempo real. |
| RF-CRM-04 | Mostrar historial de compras y citas del cliente al seleccionarlo en la venta. |
| RF-CRM-05 | Categorizar/segmentar clientes (VIP, frecuente, mayorista, etc.) manual o automáticamente. |
| RF-CRM-06 | Gestionar motor de fidelización: acumulación y redención de puntos. |
| RF-CRM-07 | Editar y desactivar (no eliminar físicamente) clientes, preservando historial. |

### 1.4 Catálogo — Productos

| ID | Requerimiento |
| :--- | :--- |
| RF-CAT-01 | Crear productos con SKU, nombre, categoría, precio base y variantes (talla, color, sabor). |
| RF-CAT-02 | Definir combos/packs compuestos por múltiples productos con precio propio. |
| RF-CAT-03 | Definir múltiples listas de precios (regular, VIP, mayorista). |
| RF-CAT-04 | Configurar reglas de promoción (porcentual, monto fijo, 2x1, 3x2, volumen, combos). |
| RF-CAT-05 | Gestionar cupones con vigencia, uso único/múltiple y restricciones. |
| RF-CAT-06 | Exponer el catálogo mediante API interna consumible por otros sub-dominios y servicios externos. |
| RF-CAT-07 | Activar/desactivar productos sin eliminarlos del histórico. |
| RF-CAT-08 | Versionar cambios de precio (histórico de precios anteriores). |

### 1.5 Catálogo — Servicios (distribución por horario)

| ID | Requerimiento |
| :--- | :--- |
| RF-SERV-01 | Definir un producto de tipo "Servicio" con duración estimada (minutos/horas). |
| RF-SERV-02 | Asociar uno o más especialistas/personal encargado a un servicio, cada uno con su propia agenda individual. |
| RF-SERV-03 | Asociar recursos físicos limitados al servicio cuando corresponda (sala, silla, equipo). |
| RF-SERV-04 | Registrar cada instancia de servicio agendado con horario específico único (fecha, hora de inicio, duración), bloqueando esa franja para el personal/recurso asignado. |
| RF-SERV-05 | Validar disponibilidad del personal y del recurso asociado antes de confirmar una reserva, impidiendo doble asignación en la misma franja. |
| RF-SERV-06 | Permitir reprogramar o cancelar una reserva de servicio, liberando la franja horaria bloqueada. |
| RF-SERV-07 | Mostrar al operador la agenda del personal (disponible/ocupado) al momento de ofrecer horarios al cliente. |
| RF-SERV-08 | Registrar insumos requeridos por el servicio, si aplica, para su descuento correspondiente al momento de la atención. |

### 1.6 Sincronización

| ID | Requerimiento |
| :--- | :--- |
| RF-SYNC-01 | Registrar cada operación relevante como evento pendiente (`sync_outbox`) con UUIDv4 único. |
| RF-SYNC-02 | Sincronizar automáticamente eventos pendientes hacia la nube al detectar conectividad. |
| RF-SYNC-03 | Descargar (pull) actualizaciones de catálogo y precios desde el backoffice web. |
| RF-SYNC-04 | Mostrar indicador visual del estado de sincronización (sincronizado / pendiente / error). |
| RF-SYNC-05 | Operar completamente sin conexión para todas las funcionalidades locales (caja, venta, cliente, catálogo, servicios). |
| RF-SYNC-06 | Reintentar automáticamente eventos fallidos mediante backoff exponencial. |
| RF-SYNC-07 | Garantizar idempotencia: el reenvío de un evento ya procesado no debe duplicar la venta, movimiento de caja o comprobante en la nube. |

### 1.7 Arquitectura (Clean Architecture)

| ID | Requerimiento |
| :--- | :--- |
| RF-ARQ-01 | La capa de UI debe interactuar exclusivamente con interfaces de dominio (`ITicketRepository`, `IClientRepository`, `ICatalogRepository`), sin invocar directamente SQLite ni endpoints REST. |
| RF-ARQ-02 | El sistema debe implementar un `RepositoryFactory` que resuelva las interfaces de dominio hacia la implementación correspondiente según el entorno de ejecución detectado en tiempo de arranque (ejecutable instalado vs. navegador web). |
| RF-ARQ-03 | El código de UI (componentes, vistas, lógica de pantalla) debe ser compartido entre las builds de Desktop, Tablet y Web sin bifurcaciones condicionales por plataforma fuera de la capa de repositorios. |

---

## 2. Requerimientos No Funcionales (RNF)

| ID | Categoría | Requerimiento |
| :--- | :--- | :--- |
| RNF-01 | Disponibilidad | Las funciones locales deben estar operativas el 100% del tiempo, independientemente del estado de la conexión a internet. |
| RNF-02 | Rendimiento | Escritura de operaciones locales (venta, caja, cliente) en menos de 200ms. |
| RNF-03 | Rendimiento | Búsqueda de productos/clientes en menos de 300ms sobre SQLite local. |
| RNF-04 | Usabilidad | Interfaz completamente operable por pantalla táctil en modo Tablet (áreas de contacto mínimas de 48px). |
| RNF-05 | Usabilidad | Modo Desktop debe soportar atajos de teclado (F1–F12) para agilizar el cobro continuo. |
| RNF-06 | Seguridad | Funciones sensibles (anulación, descuento manual, apertura/cierre de caja) requieren autenticación/PIN de supervisor según rol. |
| RNF-07 | Seguridad | Datos de clientes cifrados en reposo mediante SQLCipher en la base local. |
| RNF-08 | Integridad de datos | Ninguna venta ni movimiento de caja se elimina físicamente; solo se anula/reversa con trazabilidad (append-only). |
| RNF-09 | Consistencia | Los eventos sincronizados deben ser idempotentes de extremo a extremo. |
| RNF-10 | Recuperación ante fallos | El ticket en curso debe recuperarse tras un cierre inesperado de la aplicación, mediante persistencia incremental. |
| RNF-11 | Auditoría | Todo movimiento de caja, venta, anulación, cambio de precio y reserva de servicio debe registrar usuario, fecha/hora y detalle del cambio. |
| RNF-12 | Mantenibilidad | Los sub-dominios internos (Caja, Venta, Cliente, Catálogo) deben mantener límites claros con API interna documentada, permitiendo su eventual extracción como servicio independiente. |
| RNF-13 | Portabilidad | El proyecto Desktop debe ejecutarse en Windows y Android sin cambios estructurales en el modelo de datos; soporte iOS queda fuera del alcance inicial. |
| RNF-14 | Compatibilidad de hardware | El módulo de escaneo debe funcionar en tablets y laptops de gama media sin hardware especializado adicional. |
| RNF-15 | Escalabilidad | Soportar catálogos de al menos 50,000 productos/servicios y bases de clientes de al menos 100,000 registros sin degradación perceptible en el dispositivo local. |
| RNF-16 | Interoperabilidad | La comunicación entre terminal local y nube debe realizarse exclusivamente vía API REST documentada (OpenAPI), sin acceso directo del Desktop a la base de datos cloud. |
| RNF-17 | Mantenibilidad | Cualquier nueva fuente de datos (ej. futura sincronización P2P u otro backend) debe poder incorporarse implementando las interfaces de dominio existentes, sin modificar la capa de UI. |
| RNF-18 | Consistencia | La validación de compatibilidad entre tipo de documento y tipo de comprobante debe aplicarse igual en Desktop (offline) y en Web (backoffice), usando la misma regla de negocio en ambos entornos. |

---

## 3. Nota sobre alcance de Inventario dentro de este servicio

Sales & Customer Service no implementa el conjunto completo de casos de uso de un sistema de inventario. Su interacción se limita a: descuento de stock al vender, reingreso ante devolución/anulación, y consulta de disponibilidad. Transferencias entre almacenes, control multialmacén y trazabilidad avanzada de lotes/vencimientos son capacidades del Inventory Service no consumidas por el flujo operativo actual.
