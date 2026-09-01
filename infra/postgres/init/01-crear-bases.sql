-- Una base de datos por SERVICIO DEL INVENTARIO — principio de autonomía P5
-- (CLAUDE.md §4.5). Ningún servicio lee las tablas de otro.
--
-- La regla se aplica ENTRE los ocho servicios del inventario, no dentro de uno.
-- Los sub-dominios internos de `Sales & Customer Service` (Caja, Venta, CRM,
-- Catálogo) comparten intencionalmente una misma base: son parte de un solo
-- servicio autónomo, y esa fusión es precisamente lo que evita llamadas
-- cruzadas en el momento del ticket de venta (documento base §0, decisiones 1 y 2).

-- ── Servicios de Entidad (los 8 del inventario canónico, §4.2) ──────────

-- Réplica cloud del servicio. Su autoridad operativa del día a día es la
-- base SQLite/SQLCipher local del terminal (documento base §2.1).
CREATE DATABASE svc_sales_customer;

-- También opera local-first: descuenta stock sin internet y sincroniza
-- después (documento base §6, §2.2).
CREATE DATABASE svc_inventory;

CREATE DATABASE svc_order_booking;
CREATE DATABASE svc_payment_gateway;
CREATE DATABASE svc_einvoicing;
CREATE DATABASE svc_omnichannel_bot;
CREATE DATABASE svc_notification_sync;
CREATE DATABASE svc_analytics_reporting;

-- ── Servicios de Utilidad (§4.4) ────────────────────────────────────────
-- Solo tres. `ValidacionDocumento` y `ReglasPrecio` NO se extraen: son reglas
-- de negocio internas de Sales & Customer Service y ningún otro servicio
-- del inventario las necesita.

CREATE DATABASE svc_auditoria;
CREATE DATABASE svc_sincronizacion;
CREATE DATABASE svc_notificacion;

-- ── Servicios de Tarea — estado de procesos orquestados (§4.3) ──────────
-- Atraviesan varios servicios del inventario. Viven en el ESB o en el motor
-- BPM, no dentro de ningún servicio de entidad.

CREATE DATABASE svc_proceso_venta;
CREATE DATABASE svc_reserva_multicanal;
CREATE DATABASE svc_conciliacion_pago;

-- ── Infraestructura SOA ─────────────────────────────────────────────────

CREATE DATABASE svc_registro;   -- Registro con modelo de datos UDDI (§5.4)
CREATE DATABASE svc_esb;        -- Trazas y estado del bus (§5.3)
