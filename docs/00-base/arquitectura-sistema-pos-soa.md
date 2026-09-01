# Especificación Extendida: Sistema POS & E-Commerce Multirrubro (SOA Offline-First)

## 0. Historial de Decisiones de esta Iteración

Este documento parte del resumen ejecutivo original (arquitectura SOA pura en la nube) y lo evoluciona en base a las siguientes decisiones tomadas durante la sesión de diseño:

1. El módulo de **Clientes/CRM** se fusiona con el **POS y Gestión de Caja** en un solo servicio de dominio, porque el cajero necesita la ficha del cliente en el mismo flujo del ticket de venta.
2. El **Catálogo** (productos, variantes, servicios, precios, promociones) también se integra a ese mismo servicio unificado, ya que es información que el cajero consulta constantemente durante la venta.
3. El sistema deja de ser "cloud puro" y pasa a un modelo **offline-first**: existe un **proyecto Desktop** (con base de datos local SQLite) y un **proyecto Web** (backoffice + servicios cloud), sincronizados entre sí.
4. El negocio opera con **una sola sucursal/caja** (por ahora), lo cual elimina la necesidad de resolver conflictos de escritura entre múltiples orígenes remotos.
5. La **Facturación Electrónica** se emite localmente (ticket/PDF inmediato al cliente) y el envío tributario a SUNAT se encola para cuando haya conexión a internet.
6. La numeración de comprobantes se resuelve con el modelo estándar de SUNAT: **series independientes por caja/punto de emisión**, evitando así la necesidad de coordinar correlativos con la nube en tiempo real.
7. El **stock** se maneja de forma aislada por local/almacén físico, sin sincronización cruzada automática entre locales (si en el futuro hay más de uno).
8. Pendiente de definir: si un mismo local operará con **más de una caja simultánea**, lo cual determinará si se necesita un "hub local" (mini-servidor en LAN) o si cada caja sincroniza de forma completamente independiente contra la nube.

---

## 1. Visión General del Proyecto

Sistema SaaS de arquitectura orientada a servicios (SOA) para digitalizar operaciones de comercio minorista y empresas de servicios (peluquerías, centros de estética, consultorías, centros de atención, etc.), con foco principal en un **Terminal de Punto de Venta (POS)** operable desde PC o Tablet.

El sistema debe funcionar de manera confiable **incluso sin conexión a internet**, ya que la venta de mostrador no puede depender de la disponibilidad de red en el momento del cobro. Esto obliga a un diseño de dos proyectos complementarios:

- **Proyecto Desktop (POS local):** aplicación instalada en PC/Tablet del negocio, con base de datos local SQLite, capaz de operar de forma autónoma.
- **Proyecto Web (Backoffice + servicios cloud):** panel de administración y servicios centralizados que sí requieren conectividad permanente (pasarelas de pago online, envío tributario, WhatsApp/IVR, analítica consolidada).

Ambos proyectos comparten el mismo modelo de dominio, pero cada uno es responsable de una porción distinta de la operación.

---

## 2. Filosofía de Diseño: Offline-First con Sincronización

### 2.1 Principio rector

> El Desktop es la **fuente de verdad operativa del día a día** (ventas, caja, cliente, catálogo local). La nube es **respaldo, consolidación y puerta de entrada a servicios externos** que sí requieren internet por naturaleza.

### 2.2 Qué opera 100% offline (SQLite local)

| Funcionalidad | Detalle |
| :--- | :--- |
| Venta de mostrador | Registro completo del ticket, cálculo de totales, aplicación de promociones locales. |
| Cobro en efectivo / tarjeta física (POS bancario externo) | No depende de la pasarela online. |
| Apertura y cierre de caja | Fondo inicial, arqueos, turnos. |
| Búsqueda y alta de cliente | CRUD local de clientes, historial de compras visible. |
| Consulta de catálogo y precios | Copia local sincronizada periódicamente desde la nube. |
| Descuento de stock local | Kardex del almacén asociado a esa caja/local. |
| Emisión de comprobante (ticket/PDF) | Se entrega al cliente de inmediato, con numeración local por serie de caja. |

### 2.3 Qué requiere internet obligatoriamente

| Funcionalidad | Detalle |
| :--- | :--- |
| Pasarela de pago online | Stripe, Niubiz, Culqi, Mercado Pago, PayU, etc. |
| Envío tributario a SUNAT | Firma digital y validación del comprobante ante la autoridad. |
| Bot de WhatsApp / IVR | Requiere conexión a APIs externas de Meta/telefonía. |
| Generación de Links de Pago / QR dinámicos remotos | Depende de la pasarela online. |
| Reportes consolidados multi-caja/multi-local (si aplica a futuro) | Requiere agregación en la nube. |

### 2.4 Patrón de sincronización (Outbox Pattern)

1. Cada operación relevante (venta, movimiento de caja, alta de cliente, comprobante emitido) se guarda en SQLite y se marca como **evento pendiente de sincronización**.
2. Un proceso en segundo plano en el Desktop revisa la conectividad periódicamente.
3. Cuando hay internet, el Desktop **empuja (push)** los eventos pendientes hacia la nube.
4. El Desktop también **descarga (pull)** los cambios que no tiene localmente (ej. catálogo actualizado desde el backoffice web).
5. Las operaciones son **append-only** (se insertan, nunca se sobrescriben) para evitar pérdida de datos históricos de ventas y caja.

### 2.5 Reglas de resolución (simplificadas por ser una sola sucursal/caja)

Al no existir múltiples orígenes de escritura concurrente sobre el mismo dato, el sistema no necesita una estrategia compleja de resolución de conflictos tipo "last-write-wins" entre nodos. Aun así, se definen reglas claras por tipo de dato:

| Tipo de dato | Regla |
| :--- | :--- |
| Catálogo / precios | La nube manda (los cambios hechos desde el backoffice web se descargan al Desktop). |
| Ventas / movimientos de caja | Nunca se sobrescriben; se insertan y se consolidan en la nube. |
| Stock | Aislado por local; no requiere reconciliación cruzada al ser una sola sucursal. |
| Comprobantes fiscales | El correlativo se genera localmente por serie de caja; el estado tributario (aceptado/observado/rechazado) se actualiza al sincronizar. |

---

## 3. Facturación Electrónica Offline-First (Contexto Perú - SUNAT)

### 3.1 Problema de origen

Un comprobante fiscal no puede depender de tener internet en el momento exacto de la venta, pero tampoco puede arriesgarse a duplicar numeración ni a emitir comprobantes inválidos.

### 3.2 Solución adoptada: Serie de numeración por caja/punto de emisión

SUNAT permite (y de hecho es la práctica estándar de los sistemas de facturación electrónica homologados) que **cada punto de emisión tenga su propia serie de comprobantes**. Esto no es un workaround del proyecto, es el modelo esperado por la propia normativa.

- Cada caja tiene asignada una serie fija (ej. Caja 1 → serie `B001` para boletas, `F001` para facturas; Caja 2 → `B002` / `F002`).
- Cada caja lleva su propio correlativo de forma **totalmente local e independiente**, sin necesidad de validar con la nube ni con otras cajas antes de emitir.
- No existe riesgo de colisión de numeración entre cajas, porque cada una escribe en su propio "carril".
- No se requiere un mecanismo de "rangos pre-asignados que se agotan": cada caja simplemente continúa su secuencia indefinidamente dentro de su serie.

### 3.3 Flujo de emisión

1. El cliente paga en el POS.
2. El sistema genera el comprobante **localmente**: numeración correlativa de la serie asignada a esa caja, PDF/ticket para impresión térmica, entrega inmediata al cliente.
3. El comprobante se marca en SQLite como `pendiente_envio_tributario = true`.
4. Cuando hay conexión, el Desktop envía la cola de comprobantes pendientes al `E-Invoicing Service` en la nube.
5. La nube firma digitalmente (o gestiona la firma vía PSE/OSE homologado) y envía a SUNAT.
6. SUNAT responde con un estado: `aceptado`, `observado` o `rechazado`.
7. Ese estado se sincroniza de vuelta al Desktop, actualizando el registro local del comprobante.
8. Si un comprobante es rechazado, el sistema debe alertar claramente al negocio, ya que la responsabilidad legal de la emisión correcta recae en el negocio, incluso si en el momento de la venta el ticket se entregó sin inconvenientes aparentes.

### 3.4 Seguimiento del cliente/negocio sobre sus comprobantes

Aunque cada caja emite con su propia serie, el **Backoffice web** consolida todas las series de todas las cajas en una sola vista unificada de comprobantes emitidos, evitando que el dueño del negocio tenga que revisar caja por caja. Esta consolidación es responsabilidad del `Analytics & Reporting Service`.

---

## 4. Topología de Cajas dentro de un Mismo Local (pendiente de definición final)

Se identificaron dos posibles enfoques, a decidir según si el local operará con una o varias cajas simultáneas:

### Opción A — Cajas independientes

- Cada caja tiene su propio SQLite y su propia sincronización directa contra la nube.
- Más simple de implementar.
- Limitación: si Caja 1 necesita ver en tiempo real lo que vendió Caja 2 (ej. stock compartido dentro del mismo local), esa información solo estará disponible después de que ambas cajas sincronicen con la nube y descarguen los cambios — lo cual depende de tener internet en ese momento.

### Opción B — Hub local (mini-servidor en red local / LAN)

- Una PC o dispositivo (tipo mini-servidor, ej. Raspberry Pi o PC dedicada) actúa como base de datos local compartida para todas las cajas del mismo local.
- Las cajas se comunican entre sí por red local (LAN/WiFi), viendo stock y ventas del local **en tiempo real, sin depender de internet**.
- Solo el hub local sincroniza con la nube (una sola sincronización por local, no una por caja).
- Más robusto para negocios con 2 o más cajas trabajando en simultáneo en el mismo mostrador.

**Estado:** pendiente de confirmar si el negocio operará con más de una caja por local, lo cual definirá cuál de las dos opciones se adopta como arquitectura base.

---

## 5. Alcance Funcional del Sistema (heredado y consolidado)

### 5.1 Sales & Customer Service (servicio unificado: POS + Caja + CRM + Catálogo)

Este es el **núcleo del sistema**, y absorbe lo que originalmente eran tres módulos separados (POS/Caja, Clientes/CRM, Catálogo):

**Operativa de Caja:**
- Registro de aperturas de caja con fondo inicial.
- Control de turnos de cajeros/operadores.
- Registro de ingresos y egresos parciales de efectivo.
- Arqueos de caja (ciegos o asistidos) y cierre diario con balance consolidado.
- Visualizador dinámico de montos y desglose de formas de pago en pantalla.

**Estrategia Cero-Hardware Dedicado (Hardware-Light):**
- Escaneo con cámara integrada (tablets, smartphones, webcams) mediante librerías de lectura óptica/QR (ZXing/OCR), sustituyendo el lector de barras físico.
- Navegación táctil y búsqueda inteligente por catálogo visual y buscador alfanumérico.

**Cliente / CRM:**
- Ficha de cliente: alta rápida, búsqueda, historial de compras y de citas.
- Motor de fidelización (puntos, categorías VIP), consultado y actualizado en cada venta.
- Segmentación básica visible para el cajero (cliente frecuente, moroso, VIP, etc.).

**Catálogo:**
- Productos físicos: variantes (talla, color, sabor), combos/packs, productos compuestos, personalizaciones.
- Servicios: duración, insumos requeridos, disponibilidad de recursos, asignación de personal especialista.
- Precios y listas diferenciadas (cliente VIP, mayorista).
- Motor de promociones y descuentos: reglas configurables (porcentuales, monto fijo), 2x1, 3x2, descuentos por volumen o combos, cupones.

> Nota de diseño: aunque el Catálogo vive dentro de este servicio unificado, se expone como **sub-dominio con su propia API interna**, ya que otros servicios (Inventory, Order & Booking Engine, Omnichannel Bot Service) necesitan consultarlo sin quedar acoplados a la lógica exclusiva de venta/caja.

### 5.2 Inventory Service

- Control multialmacén y ubicaciones (aislado por local, sin sincronización cruzada entre locales).
- Trazabilidad por SKU, lotes y fechas de vencimiento.
- Kardex automático en tiempo real: entradas, salidas por venta, mermas, transferencias, reingresos.
- Alertas automáticas de stock mínimo y reabastecimiento.

### 5.3 Order & Booking Engine

- Motor centralizado de carritos de compra y agendamiento de citas/turnos.
- Consulta el catálogo de servicios (duración, especialista, recursos) a través del Sales & Customer Service.
- **Pendiente de decisión:** si este motor se mantiene como servicio separado o se fusiona también dentro de Sales & Customer Service (relevante especialmente para negocios de servicios como peluquerías/estética, donde agendar y cobrar ocurren en el mismo momento).

### 5.4 Payment Gateway Service

- Cobro multimedio en POS: efectivo, tarjetas, transferencias en un único ticket.
- Cobro digital remoto sin POS físico: integración con pasarelas (Stripe, Niubiz, Culqi, Mercado Pago, PayU, etc.).
- Generación de links de pago y QR dinámicos para envío por correo o WhatsApp (venta telefónica, reservas previas, pedidos a distancia).
- Requiere internet obligatoriamente (ver sección 2.3).

### 5.5 E-Invoicing Service

- Generación automática de comprobantes (Boletas, Facturas, Notas de Crédito, Notas de Débito).
- Firmado digital y envío asíncrono a SUNAT.
- Generación de XML y PDF formateado para ticketera térmica o envío digital.
- Opera bajo el modelo de emisión local + cola de envío tributario descrito en la sección 3.

### 5.6 Omnichannel Bot Service

- Atención y pedidos por WhatsApp (API Cloud): bot/IA conversacional para catálogo, cotizaciones, agendamiento y confirmación de pedidos.
- Agente de voz / IVR automatizado para pedidos o reservas vía llamada telefónica.
- Notificaciones en tiempo real dentro del POS cuando ingresa una venta o reserva por canal digital.
- Requiere internet obligatoriamente.

### 5.7 Notification & Sync Service

- Notificaciones en tiempo real (WebSockets) al POS.
- Orquesta la sincronización de datos entre Desktop y Cloud descrita en la sección 2.

### 5.8 Analytics & Reporting Service

- Dashboards ejecutivos: ventas consolidadas por canal (POS mostrador, WhatsApp, E-commerce).
- Rendimiento de productos y servicios más vendidos/rentables.
- Análisis de márgenes de ganancia y rotación de inventario.
- Reportes de cierres de caja, arqueos y desviaciones de efectivo.
- Consolidación de comprobantes fiscales de todas las series/cajas (ver sección 3.4).

---

## 6. Tabla de Servicios SOA Actualizada

| Servicio SOA | Función Principal | ¿Requiere internet? |
| :--- | :--- | :--- |
| `Sales & Customer Service` | Caja, turnos, arqueos, cliente/CRM, catálogo (productos/servicios/precios), promociones y descuentos. | No (opera local, sincroniza cuando hay conexión). |
| `Inventory Service` | Kardex, stock, ubicaciones, alertas (aislado por local). | No (opera local, sincroniza cuando hay conexión). |
| `Order & Booking Engine` | Carritos y agendamiento de citas; consulta catálogo de servicios vía Sales & Customer Service. | Parcial (pendiente de definición, ver 5.3). |
| `Payment Gateway Service` | Pasarelas de pago online, links de pago/QR remotos, webhooks. | Sí, obligatorio. |
| `E-Invoicing Service` | XML, firma digital, envío tributario a SUNAT, generación de PDF. | Emisión local sin internet; envío tributario requiere conexión. |
| `Omnichannel Bot Service` | WhatsApp Cloud API, IVR; consulta catálogo vía Sales & Customer Service. | Sí, obligatorio. |
| `Notification & Sync Service` | WebSockets, orquestación de sincronización Desktop-Cloud. | Sí, obligatorio (solo para sincronizar). |
| `Analytics & Reporting Service` | Métricas e indicadores, consolidación multi-serie/multi-caja. | Sí, obligatorio. |

---

## 7. Matriz Diferencial de Dominio: Productos vs. Servicios (heredada del documento original)

| Criterio | Venta de Productos | Venta de Servicios |
| :--- | :--- | :--- |
| **Recurso Principal** | Stock físico en almacén. | Disponibilidad de personal y franja horaria. |
| **Unidad de Venta** | SKU / Unidades. | Duración (minutos/horas) + Especialista. |
| **Reserva** | Bloqueo temporal de stock en carrito. | Bloqueo de agenda y asignación de recurso. |
| **Cobro** | Venta directa o envío de Link/QR. | Señas/Anticipo o cobro total al agendar/finalizar. |
| **Despacho** | Entrega inmediata en mostrador o envío. | Asistencia presencial en el local. |

---

## 8. Temas Pendientes de Definición

1. **Topología multi-caja dentro de un mismo local** (sección 4): definir si se adopta Opción A (cajas independientes) o Opción B (hub local en LAN), en función de si el negocio operará con más de una caja simultánea.
2. **Fusión o separación del Order & Booking Engine** respecto al Sales & Customer Service: relevante para negocios de servicios donde agendar y cobrar ocurren en el mismo momento con el mismo cliente.
3. **Validación legal/técnica formal ante SUNAT** del modelo de series por caja y emisión offline con cola de envío tributario, para confirmar homologación con el proveedor de facturación electrónica (PSE/OSE) que se utilice.
4. **Política de expansión a múltiples locales**: si en el futuro el negocio crece a más de una sucursal, definir si se mantiene el mismo principio de aislamiento de stock por local, o si se requiere una capa adicional de transferencias entre almacenes.

---

## 9. Próximos Pasos Sugeridos

1. **Modelado de Base de Datos:** esquema unificado para SQLite (Desktop) y su contraparte en la nube, incluyendo campos de sincronización (`sync_status`, `updated_at`, `pending_sync`) en las tablas relevantes.
2. **Definición de Contratos API (OpenAPI/Swagger):** especificación de endpoints entre el Desktop, el Backoffice web y los servicios SOA en la nube, incluyendo los endpoints específicos de sincronización (push/pull).
3. **Diseño del proceso de sincronización (Outbox):** definir la estructura de la cola de eventos pendientes, frecuencia de intentos de sincronización, y manejo de errores de red.
4. **Flujo de Pantallas UX/UI:** wireframe del terminal POS para Tablet y Laptop, incluyendo indicadores visuales de estado de sincronización (ej. ícono de "pendiente de sincronizar" en ventas y comprobantes).
5. **Definición del proveedor de facturación electrónica (PSE/OSE)** para Perú, y validación formal del modelo de series por caja con dicho proveedor.
