/**
 * Rutas del sub-dominio **Catálogo**.
 *
 * Contract-first: cada operación corresponde a un `operationId` de
 * `contratos/openapi/sales-customer-v1.yaml`. El contrato manda (CLAUDE.md §9.1.1).
 *
 * `ConsultarItemCatalogo` es la operación que consumen `Inventory Service`,
 * `Order & Booking Engine` y `Omnichannel Bot Service` (documento base §5.1). Por
 * eso el catálogo se expone aunque viva dentro del servicio compuesto.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { exito, errorNoEncontrado } from '@pos/service-kit';

import type { RepositorioCatalogo, TipoItem } from './repositorio.js';

const EsquemaBusqueda = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 120 })),
  tipoItem: Type.Optional(
    Type.Union([
      Type.Literal('PRODUCTO'),
      Type.Literal('SERVICIO'),
      Type.Literal('COMBO'),
    ]),
  ),
  categoria: Type.Optional(Type.String({ maxLength: 120 })),
  soloActivos: Type.Optional(Type.Boolean({ default: true })),
  pagina: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

const EsquemaSku = Type.Object({
  sku: Type.String({ pattern: '^[A-Z0-9][A-Z0-9\\-_]{1,31}$' }),
});

export function registrarRutasCatalogo(
  app: FastifyInstance,
  repositorio: RepositorioCatalogo,
): void {
  // ── BuscarItemsCatalogo ─────────────────────────────────────────
  app.get(
    '/catalogo/items',
    { schema: { querystring: EsquemaBusqueda } },
    async (peticion) => {
      const q = peticion.query as {
        q?: string;
        tipoItem?: TipoItem;
        categoria?: string;
        soloActivos?: boolean;
        pagina?: number;
        limite?: number;
      };

      const pagina = q.pagina ?? 1;
      const limite = q.limite ?? 50;

      const { items, total } = await repositorio.buscar({
        q: q.q,
        tipoItem: q.tipoItem,
        categoria: q.categoria,
        soloActivos: q.soloActivos ?? true,
        pagina,
        limite,
      });

      return exito(items, app.meta(peticion), { total, pagina, limite });
    },
  );

  // ── ConsultarItemCatalogo ───────────────────────────────────────
  app.get(
    '/catalogo/items/:sku',
    { schema: { params: EsquemaSku } },
    async (peticion) => {
      const { sku } = peticion.params as { sku: string };
      const item = await repositorio.porSku(sku);

      if (!item) {
        throw errorNoEncontrado(
          'ITEM_CATALOGO_NO_ENCONTRADO',
          `No existe un item con SKU ${sku}.`,
        );
      }

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: 'ITEM_CATALOGO_CONSULTADO',
        recurso: 'item-catalogo',
        recursoId: sku,
        usuario: 'sistema',
        timestamp: new Date().toISOString(),
      });

      return exito(item, app.meta(peticion));
    },
  );
}
