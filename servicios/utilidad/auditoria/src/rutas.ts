/**
 * Rutas de `Auditoria.Utility`.
 *
 * Contract-first: cada operación corresponde a un `operationId` de
 * `contratos/openapi/auditoria-v1.yaml`. **El contrato manda**: si difieren, se
 * corrige el código, no el contrato (CLAUDE.md §9.1.1).
 *
 * No hay `PUT` ni `DELETE`, y no es un descuido: el registro es append-only
 * (RNF-08). El contrato tampoco los declara.
 */
import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { exito, errorNoEncontrado } from '@pos/service-kit';

import type { EntradaAuditoria, RepositorioAuditoria } from './repositorio.js';

const LIMITE_LOTE = 500;

/** Esquema de una entrada entrante. Se valida en el borde (CLAUDE.md §9.3). */
const EsquemaNuevaEntrada = Type.Object({
  correlationId: Type.String({ minLength: 1, maxLength: 64 }),
  servicio: Type.String({ minLength: 1, maxLength: 120 }),
  accion: Type.String({ minLength: 1, maxLength: 120 }),
  recurso: Type.String({ minLength: 1, maxLength: 120 }),
  recursoId: Type.Optional(Type.String({ maxLength: 120 })),
  usuario: Type.String({ minLength: 1, maxLength: 120 }),
  timestamp: Type.Optional(Type.String({ format: 'date-time' })),
  detalle: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const EsquemaFiltro = Type.Object({
  servicio: Type.Optional(Type.String()),
  usuario: Type.Optional(Type.String()),
  accion: Type.Optional(Type.String()),
  recurso: Type.Optional(Type.String()),
  desde: Type.Optional(Type.String({ format: 'date-time' })),
  hasta: Type.Optional(Type.String({ format: 'date-time' })),
  pagina: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

type NuevaEntradaEntrante = {
  correlationId: string;
  servicio: string;
  accion: string;
  recurso: string;
  recursoId?: string;
  usuario: string;
  timestamp?: string;
  detalle?: Record<string, unknown>;
};

/** El emisor puede omitir el timestamp; entonces lo pone este servicio. */
function aEntrada(entrante: NuevaEntradaEntrante): EntradaAuditoria {
  return {
    uuid: randomUUID(),
    correlationId: entrante.correlationId,
    servicio: entrante.servicio,
    accion: entrante.accion,
    recurso: entrante.recurso,
    recursoId: entrante.recursoId,
    usuario: entrante.usuario,
    timestamp: entrante.timestamp ? new Date(entrante.timestamp) : new Date(),
    detalle: entrante.detalle,
  };
}

export function registrarRutas(
  app: FastifyInstance,
  repositorio: RepositorioAuditoria,
): void {
  // ── RegistrarEntrada ────────────────────────────────────────────
  app.post(
    '/entradas',
    { schema: { body: EsquemaNuevaEntrada } },
    async (peticion, respuesta) => {
      const entrada = aEntrada(peticion.body as NuevaEntradaEntrante);
      const insertada = await repositorio.registrar(entrada);

      // 202: se acusa recibo sin obligar al llamante a esperar. La auditoria
      // nunca debe tumbar la operacion de negocio que la origino.
      return respuesta
        .code(202)
        .send(
          exito(
            { uuid: entrada.uuid, aceptada: insertada },
            app.meta(peticion),
          ),
        );
    },
  );

  // ── RegistrarLote ───────────────────────────────────────────────
  app.post(
    '/entradas/lote',
    {
      schema: {
        body: Type.Object({
          entradas: Type.Array(EsquemaNuevaEntrada, {
            minItems: 1,
            maxItems: LIMITE_LOTE,
          }),
        }),
      },
    },
    async (peticion, respuesta) => {
      const { entradas } = peticion.body as { entradas: NuevaEntradaEntrante[] };
      const resultado = await repositorio.registrarLote(entradas.map(aEntrada));

      return respuesta.code(202).send(
        exito(
          {
            aceptadas: resultado.insertadas,
            duplicadas: resultado.duplicadas,
          },
          app.meta(peticion),
        ),
      );
    },
  );

  // ── BuscarEntradas ──────────────────────────────────────────────
  app.get(
    '/entradas/buscar',
    { schema: { querystring: EsquemaFiltro } },
    async (peticion) => {
      const q = peticion.query as Record<string, string | number | undefined>;
      const pagina = Number(q['pagina'] ?? 1);
      const limite = Number(q['limite'] ?? 50);

      const { entradas, total } = await repositorio.buscar({
        servicio: q['servicio'] as string | undefined,
        usuario: q['usuario'] as string | undefined,
        accion: q['accion'] as string | undefined,
        recurso: q['recurso'] as string | undefined,
        desde: q['desde'] ? new Date(q['desde'] as string) : undefined,
        hasta: q['hasta'] ? new Date(q['hasta'] as string) : undefined,
        pagina,
        limite,
      });

      return exito(entradas, app.meta(peticion), { total, pagina, limite });
    },
  );

  // ── ConsultarTraza ──────────────────────────────────────────────
  // La evidencia de trazabilidad que exige el PROY: responde
  // "que le paso exactamente a esta operacion" con un solo identificador.
  app.get(
    '/trazas/:correlationId',
    { schema: { params: Type.Object({ correlationId: Type.String({ minLength: 1 }) }) } },
    async (peticion) => {
      const { correlationId } = peticion.params as { correlationId: string };
      const pasos = await repositorio.traza(correlationId);

      if (pasos.length === 0) {
        throw errorNoEncontrado(
          'TRAZA_NO_ENCONTRADA',
          `No hay entradas para la operación ${correlationId}.`,
        );
      }

      const marcas = pasos.map((p) => p.timestamp.getTime());

      return exito(
        {
          correlationId,
          iniciadaEn: new Date(Math.min(...marcas)).toISOString(),
          finalizadaEn: new Date(Math.max(...marcas)).toISOString(),
          serviciosInvolucrados: [...new Set(pasos.map((p) => p.servicio))],
          pasos,
        },
        app.meta(peticion),
      );
    },
  );
}
