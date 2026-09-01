/**
 * Rutas REST de `E-Invoicing Service`.
 *
 * El servicio **recibe en REST/JSON** —así habla el resto del inventario— y
 * **envía en SOAP/XML** hacia SUNAT. Esa asimetría es exactamente la mediación
 * de protocolos que justifica el ESB (CLAUDE.md §5.3).
 *
 * Contract-first: corresponde a `contratos/wsdl/einvoicing-v1.wsdl` del lado
 * SOAP y al contrato REST de este archivo del lado interno.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { exito, errorNoEncontrado, errorReglaNegocio } from '@pos/service-kit';

import type { Comprobante, EstadoTributario } from './comprobante.js';
import type { Emisor } from './emisor.js';
import type { RepositorioComprobantes } from './repositorio.js';

const EsquemaLinea = Type.Object({
  sku: Type.String({ minLength: 1, maxLength: 32 }),
  descripcion: Type.String({ minLength: 1, maxLength: 120 }),
  cantidad: Type.Integer({ minimum: 1 }),
  precioUnitario: Type.Number({ minimum: 0 }),
  importe: Type.Number({ minimum: 0 }),
});

const EsquemaComprobante = Type.Object({
  uuid: Type.String({ format: 'uuid' }),
  tipoComprobante: Type.Union([
    Type.Literal('BOLETA'),
    Type.Literal('FACTURA'),
    Type.Literal('NOTA_VENTA'),
    Type.Literal('NOTA_CREDITO'),
  ]),
  serie: Type.String({ pattern: '^[BFN][A-Z0-9]{3}$' }),
  correlativo: Type.Integer({ minimum: 1 }),
  fechaEmision: Type.String({ format: 'date' }),
  cliente: Type.Object({
    tipoDocumento: Type.Union([
      Type.Literal('DNI'),
      Type.Literal('RUC'),
      Type.Literal('GENERICO'),
    ]),
    numeroDocumento: Type.Optional(Type.String({ maxLength: 15 })),
    razonSocial: Type.String({ minLength: 1, maxLength: 120 }),
  }),
  lineas: Type.Array(EsquemaLinea, { minItems: 1 }),
  totalGravado: Type.Number({ minimum: 0 }),
  totalIgv: Type.Number({ minimum: 0 }),
  total: Type.Number({ minimum: 0 }),
});

type ComprobanteEntrante = Omit<
  Comprobante,
  'estadoTributario' | 'intentos' | 'ultimoIntento' | 'respuestaSunat' | 'documentoReferencia'
>;

export function registrarRutas(
  app: FastifyInstance,
  repositorio: RepositorioComprobantes,
  emisor: Emisor,
): void {
  // ── RecibirComprobante ──────────────────────────────────────────
  app.post(
    '/comprobantes',
    { schema: { body: EsquemaComprobante } },
    async (peticion, respuesta) => {
      const entrante = peticion.body as ComprobanteEntrante;

      const comprobante: Comprobante = {
        ...entrante,
        estadoTributario: 'PENDIENTE_ENVIO',
        intentos: 0,
      };

      // Idempotente: el terminal reintenta con backoff y no debe duplicar.
      const nuevo = await repositorio.registrar(comprobante);

      if (!nuevo) {
        const existente = await repositorio.porUuid(entrante.uuid);
        return respuesta
          .code(200)
          .send(exito({ comprobante: existente, duplicado: true }, app.meta(peticion)));
      }

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: 'COMPROBANTE_RECIBIDO',
        recurso: 'comprobante',
        recursoId: comprobante.uuid,
        usuario: 'sistema',
        timestamp: new Date().toISOString(),
        detalle: {
          documento: `${comprobante.serie}-${comprobante.correlativo}`,
          total: comprobante.total,
        },
      });

      return respuesta
        .code(202)
        .send(exito({ comprobante, duplicado: false }, app.meta(peticion)));
    },
  );

  // ── EnviarComprobante ───────────────────────────────────────────
  app.post(
    '/comprobantes/:uuid/envio',
    { schema: { params: Type.Object({ uuid: Type.String({ format: 'uuid' }) }) } },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      const comprobante = await exigir(repositorio, uuid);

      const resultado = await emisor.emitir(comprobante);
      await repositorio.guardar(resultado.comprobante);

      const estado = resultado.comprobante.estadoTributario;

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: `COMPROBANTE_${estado}`,
        recurso: 'comprobante',
        recursoId: uuid,
        usuario: 'sistema',
        timestamp: new Date().toISOString(),
        detalle: {
          documento: `${comprobante.serie}-${comprobante.correlativo}`,
          codigoSunat: resultado.respuesta?.codigo,
          intentos: resultado.comprobante.intentos,
          ...(resultado.error ? { error: resultado.error } : {}),
        },
      });

      // Un rechazo de SUNAT no es un fallo de esta API: la operación se ejecutó
      // y su resultado es que el comprobante fue rechazado. Quien llama necesita
      // el detalle, no un 500.
      return exito(
        {
          comprobante: resultado.comprobante,
          respuestaSunat: resultado.respuesta,
          reintentable: resultado.reintentable,
          error: resultado.error,
        },
        app.meta(peticion),
      );
    },
  );

  // ── ConsultarComprobante ────────────────────────────────────────
  app.get(
    '/comprobantes/:uuid',
    { schema: { params: Type.Object({ uuid: Type.String({ format: 'uuid' }) }) } },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      return exito(await exigir(repositorio, uuid), app.meta(peticion));
    },
  );

  // ── ConsultarPorSerie ───────────────────────────────────────────
  app.get(
    '/comprobantes/serie/:serie/:correlativo',
    {
      schema: {
        params: Type.Object({
          serie: Type.String({ pattern: '^[BFN][A-Z0-9]{3}$' }),
          correlativo: Type.Integer({ minimum: 1 }),
        }),
      },
    },
    async (peticion) => {
      const { serie, correlativo } = peticion.params as {
        serie: string;
        correlativo: number;
      };

      const comprobante = await repositorio.porSerie(serie, correlativo);

      if (!comprobante) {
        throw errorNoEncontrado(
          'COMPROBANTE_NO_ENCONTRADO',
          `No existe el comprobante ${serie}-${correlativo}.`,
        );
      }

      return exito(comprobante, app.meta(peticion));
    },
  );

  // ── BuscarComprobantes ──────────────────────────────────────────
  // Lo consume Analytics & Reporting para consolidar todas las series.
  app.get(
    '/comprobantes',
    {
      schema: {
        querystring: Type.Object({
          estado: Type.Optional(Type.String()),
          serie: Type.Optional(Type.String()),
          desde: Type.Optional(Type.String({ format: 'date' })),
          hasta: Type.Optional(Type.String({ format: 'date' })),
          pagina: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
          limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
        }),
      },
    },
    async (peticion) => {
      const q = peticion.query as {
        estado?: EstadoTributario;
        serie?: string;
        desde?: string;
        hasta?: string;
        pagina?: number;
        limite?: number;
      };

      const pagina = q.pagina ?? 1;
      const limite = q.limite ?? 50;

      const { comprobantes, total } = await repositorio.buscar({
        estado: q.estado,
        serie: q.serie,
        desde: q.desde,
        hasta: q.hasta,
        pagina,
        limite,
      });

      return exito(comprobantes, app.meta(peticion), { total, pagina, limite });
    },
  );

  // ── ConsultarPendientes ─────────────────────────────────────────
  app.get(
    '/comprobantes/pendientes',
    {
      schema: {
        querystring: Type.Object({
          limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
        }),
      },
    },
    async (peticion) => {
      const { limite } = peticion.query as { limite?: number };
      const pendientes = await repositorio.pendientes(limite ?? 50);

      return exito(pendientes, app.meta(peticion), {
        total: pendientes.length,
        pagina: 1,
        limite: limite ?? 50,
      });
    },
  );
}

async function exigir(
  repositorio: RepositorioComprobantes,
  uuid: string,
): Promise<Comprobante> {
  const comprobante = await repositorio.porUuid(uuid);

  if (!comprobante) {
    throw errorNoEncontrado(
      'COMPROBANTE_NO_ENCONTRADO',
      `No existe el comprobante ${uuid}.`,
    );
  }

  return comprobante;
}

export { errorReglaNegocio };
