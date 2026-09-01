/**
 * Esquema de la base de `Auditoria.Utility` — `svc_auditoria`.
 *
 * **Append-only, sin excepciones** (RNF-08). No hay `updatedAt` ni borrado lógico:
 * una entrada equivocada se corrige con otra entrada que la referencia, nunca
 * modificando la original. Por eso el repositorio no expone actualizar ni eliminar.
 */
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const entradasAuditoria = pgTable(
  'entradas_auditoria',
  {
    uuid: uuid('uuid').primaryKey(),

    /** Une todos los pasos de una misma operación a través de los servicios. */
    correlationId: text('correlation_id').notNull(),

    /** Servicio que produjo la entrada. */
    servicio: text('servicio').notNull(),

    /** Qué se hizo, en pasado y mayúsculas: `VENTA_REGISTRADA`. */
    accion: text('accion').notNull(),

    recurso: text('recurso').notNull(),
    recursoId: text('recurso_id'),

    /**
     * Quién lo hizo. En operaciones elevadas es el **supervisor que autorizó**,
     * no el cajero que operó (ADR-001). `sistema` para procesos automáticos.
     */
    usuario: text('usuario').notNull(),

    /** Cuándo ocurrió, según el emisor. */
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),

    /** Cuándo lo recibió este servicio. Difiere si el emisor estaba offline. */
    recibidoEn: timestamp('recibido_en', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Contexto del cambio. Nunca datos sensibles en claro. */
    detalle: jsonb('detalle'),
  },
  (tabla) => [
    // Reconstruir la traza de una operación es la consulta más frecuente.
    index('idx_correlation').on(tabla.correlationId),
    index('idx_servicio_accion').on(tabla.servicio, tabla.accion),
    index('idx_usuario').on(tabla.usuario),
    index('idx_timestamp').on(tabla.timestamp),
  ],
);

export type EntradaFila = typeof entradasAuditoria.$inferSelect;
export type NuevaEntradaFila = typeof entradasAuditoria.$inferInsert;
