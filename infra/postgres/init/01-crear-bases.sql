-- Una base de datos por servicio — principio de autonomía P5 (CLAUDE.md §4.6).
-- Ningún servicio lee las tablas de otro. Esta separación física lo hace imposible por accidente.

-- ── Servicios de Entidad ────────────────────────────────────────────────
CREATE DATABASE svc_catalogo;
CREATE DATABASE svc_cliente;
CREATE DATABASE svc_caja;
CREATE DATABASE svc_venta;
CREATE DATABASE svc_inventario;
CREATE DATABASE svc_agenda;

-- ── Servicios de Utilidad ───────────────────────────────────────────────
CREATE DATABASE svc_seguridad;
CREATE DATABASE svc_auditoria;
CREATE DATABASE svc_reglas_precio;
CREATE DATABASE svc_sincronizacion;
CREATE DATABASE svc_notificacion;

-- ── Servicios de Tarea (estado de procesos orquestados) ─────────────────
CREATE DATABASE svc_proceso_venta;
CREATE DATABASE svc_cierre_caja;
CREATE DATABASE svc_reserva_servicio;
CREATE DATABASE svc_devolucion_anulacion;

-- ── Infraestructura SOA ─────────────────────────────────────────────────
CREATE DATABASE svc_einvoicing;
CREATE DATABASE svc_registro;
CREATE DATABASE svc_esb;
