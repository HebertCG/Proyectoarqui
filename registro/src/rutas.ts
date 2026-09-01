/**
 * API REST del registro UDDI.
 *
 * Expone el modelo de datos UDDI sobre REST: publicación, descubrimiento y
 * resolución de endpoint (CLAUDE.md §5.4).
 *
 * Las rutas siguen la nomenclatura del estándar —`businessEntity`,
 * `businessService`, `bindingTemplate`, `tModel`— en vez de inventar nombres
 * propios. Esa correspondencia literal **es** la evidencia de la sesión 24.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { exito, errorNoEncontrado, errorValidacion } from '@pos/service-kit';

import { ErrorReferenciaInvalida, type RegistroUddi } from './repositorio.js';
import type { BusinessService, FiltroBusqueda } from './modelo-uddi.js';

const EsquemaBinding = Type.Object({
  bindingKey: Type.String({ minLength: 1 }),
  accessPoint: Type.String({ minLength: 1 }),
  tipoAcceso: Type.Union([
    Type.Literal('REST'),
    Type.Literal('SOAP'),
    Type.Literal('AMQP'),
  ]),
  tModelKeys: Type.Array(Type.String({ minLength: 1 })),
  descripcion: Type.Optional(Type.String()),
});

const EsquemaServicio = Type.Object({
  serviceKey: Type.String({ minLength: 1 }),
  businessKey: Type.String({ minLength: 1 }),
  nombre: Type.String({ minLength: 1, maxLength: 120 }),
  descripcion: Type.String({ maxLength: 1000 }),
  capa: Type.Union([
    Type.Literal('entidad'),
    Type.Literal('tarea'),
    Type.Literal('utilidad'),
    Type.Literal('orquestacion'),
    Type.Literal('infraestructura'),
  ]),
  nivel: Type.Union([Type.Literal('N1'), Type.Literal('N2'), Type.Literal('N3')]),
  categorias: Type.Array(Type.String()),
  bindings: Type.Array(EsquemaBinding, { minItems: 1 }),
  simulado: Type.Optional(Type.Boolean({ default: false })),
});

const EsquemaTModel = Type.Object({
  tModelKey: Type.String({ minLength: 1 }),
  nombre: Type.String({ minLength: 1 }),
  descripcion: Type.String(),
  urlContrato: Type.String(),
  categorias: Type.Array(Type.String()),
});

export function registrarRutas(app: FastifyInstance, registro: RegistroUddi): void {
  // ── PublicarServicio (save_service) ─────────────────────────────
  app.post(
    '/uddi/servicios',
    { schema: { body: EsquemaServicio } },
    async (peticion, respuesta) => {
      const servicio = peticion.body as BusinessService;

      try {
        const nuevo = registro.publicarServicio({
          ...servicio,
          simulado: servicio.simulado ?? false,
        });

        await app.auditoria.registrar({
          correlationId: peticion.correlationId,
          servicio: app.config.nombre,
          accion: nuevo ? 'SERVICIO_PUBLICADO' : 'SERVICIO_ACTUALIZADO',
          recurso: 'businessService',
          recursoId: servicio.serviceKey,
          usuario: 'sistema',
          timestamp: new Date().toISOString(),
          detalle: { nombre: servicio.nombre, capa: servicio.capa, nivel: servicio.nivel },
        });

        return respuesta.code(nuevo ? 201 : 200).send(exito(servicio, app.meta(peticion)));
      } catch (causa) {
        if (causa instanceof ErrorReferenciaInvalida) {
          // Un registro con referencias rotas es peor que uno vacío: el
          // consumidor cree haber descubierto algo invocable.
          throw errorValidacion('REFERENCIA_INVALIDA', causa.message);
        }
        throw causa;
      }
    },
  );

  // ── BuscarServicios (find_service) ──────────────────────────────
  app.get(
    '/uddi/servicios',
    {
      schema: {
        querystring: Type.Object({
          nombre: Type.Optional(Type.String()),
          capa: Type.Optional(Type.String()),
          nivel: Type.Optional(Type.String()),
          categoria: Type.Optional(Type.String()),
          tModelKey: Type.Optional(Type.String()),
          tipoAcceso: Type.Optional(Type.String()),
          incluirSimulados: Type.Optional(Type.Boolean({ default: true })),
        }),
      },
    },
    async (peticion) => {
      const q = peticion.query as Record<string, string | boolean | undefined>;

      const servicios = registro.buscarServicios({
        nombre: q['nombre'] as string | undefined,
        capa: q['capa'] as FiltroBusqueda['capa'],
        nivel: q['nivel'] as FiltroBusqueda['nivel'],
        categoria: q['categoria'] as string | undefined,
        tModelKey: q['tModelKey'] as string | undefined,
        tipoAcceso: q['tipoAcceso'] as FiltroBusqueda['tipoAcceso'],
        incluirSimulados: q['incluirSimulados'] as boolean | undefined,
      });

      return exito(servicios, app.meta(peticion), {
        total: servicios.length,
        pagina: 1,
        limite: servicios.length,
      });
    },
  );

  // ── ConsultarServicio (get_serviceDetail) ───────────────────────
  app.get(
    '/uddi/servicios/:serviceKey',
    { schema: { params: Type.Object({ serviceKey: Type.String() }) } },
    async (peticion) => {
      const { serviceKey } = peticion.params as { serviceKey: string };
      const servicio = registro.servicio(serviceKey);

      if (!servicio) {
        throw errorNoEncontrado(
          'SERVICIO_NO_REGISTRADO',
          `No hay ningún servicio publicado con la clave ${serviceKey}.`,
        );
      }

      return exito(
        { ...servicio, salud: registro.salud(serviceKey) },
        app.meta(peticion),
      );
    },
  );

  // ── ResolverEndpoint ────────────────────────────────────────────
  // Lo consume el ESB para no llevar direcciones cableadas.
  app.get(
    '/uddi/servicios/:serviceKey/endpoint',
    {
      schema: {
        params: Type.Object({ serviceKey: Type.String() }),
        querystring: Type.Object({
          tipoAcceso: Type.Optional(
            Type.Union([Type.Literal('REST'), Type.Literal('SOAP'), Type.Literal('AMQP')]),
          ),
        }),
      },
    },
    async (peticion) => {
      const { serviceKey } = peticion.params as { serviceKey: string };
      const { tipoAcceso } = peticion.query as {
        tipoAcceso?: 'REST' | 'SOAP' | 'AMQP';
      };

      const endpoint = registro.resolverEndpoint(serviceKey, tipoAcceso);

      if (!endpoint) {
        throw errorNoEncontrado(
          'ENDPOINT_NO_RESUELTO',
          tipoAcceso
            ? `El servicio ${serviceKey} no expone una interfaz ${tipoAcceso}.`
            : `No hay ningún servicio publicado con la clave ${serviceKey}.`,
        );
      }

      return exito({ serviceKey, tipoAcceso, endpoint }, app.meta(peticion));
    },
  );

  // ── RetirarServicio (delete_service) ────────────────────────────
  // Etapa de retiro del ciclo de vida del servicio (CLAUDE.md §2.2).
  app.delete(
    '/uddi/servicios/:serviceKey',
    { schema: { params: Type.Object({ serviceKey: Type.String() }) } },
    async (peticion) => {
      const { serviceKey } = peticion.params as { serviceKey: string };

      if (!registro.retirarServicio(serviceKey)) {
        throw errorNoEncontrado(
          'SERVICIO_NO_REGISTRADO',
          `No hay ningún servicio publicado con la clave ${serviceKey}.`,
        );
      }

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: 'SERVICIO_RETIRADO',
        recurso: 'businessService',
        recursoId: serviceKey,
        usuario: 'sistema',
        timestamp: new Date().toISOString(),
      });

      return exito({ serviceKey, retirado: true }, app.meta(peticion));
    },
  );

  // ── tModels ─────────────────────────────────────────────────────
  app.post(
    '/uddi/tmodels',
    { schema: { body: EsquemaTModel } },
    async (peticion, respuesta) => {
      const tModel = peticion.body as Parameters<RegistroUddi['publicarTModel']>[0];
      registro.publicarTModel(tModel);
      return respuesta.code(201).send(exito(tModel, app.meta(peticion)));
    },
  );

  app.get('/uddi/tmodels', async (peticion) => {
    const tModels = registro.tModels();
    return exito(tModels, app.meta(peticion), {
      total: tModels.length,
      pagina: 1,
      limite: tModels.length,
    });
  });

  // ── Entidades ───────────────────────────────────────────────────
  app.get('/uddi/entidades', async (peticion) =>
    exito(registro.entidades(), app.meta(peticion)),
  );

  // ── Salud ───────────────────────────────────────────────────────
  app.put(
    '/uddi/servicios/:serviceKey/salud',
    {
      schema: {
        params: Type.Object({ serviceKey: Type.String() }),
        body: Type.Object({
          estado: Type.Union([
            Type.Literal('ARRIBA'),
            Type.Literal('ABAJO'),
            Type.Literal('DESCONOCIDO'),
          ]),
          detalle: Type.Optional(Type.String()),
        }),
      },
    },
    async (peticion) => {
      const { serviceKey } = peticion.params as { serviceKey: string };
      const { estado, detalle } = peticion.body as {
        estado: 'ARRIBA' | 'ABAJO' | 'DESCONOCIDO';
        detalle?: string;
      };

      if (!registro.servicio(serviceKey)) {
        throw errorNoEncontrado(
          'SERVICIO_NO_REGISTRADO',
          `No hay ningún servicio publicado con la clave ${serviceKey}.`,
        );
      }

      registro.registrarSalud(serviceKey, estado, detalle);
      return exito(registro.salud(serviceKey), app.meta(peticion));
    },
  );

  // ── Inventario consolidado ──────────────────────────────────────
  // Vista del inventario por capa y nivel. Es lo que se muestra en la demo.
  app.get('/uddi/inventario', async (peticion) => {
    const servicios = registro.buscarServicios();

    const porCapa = servicios.reduce<Record<string, number>>((acc, s) => {
      acc[s.capa] = (acc[s.capa] ?? 0) + 1;
      return acc;
    }, {});

    const porNivel = servicios.reduce<Record<string, number>>((acc, s) => {
      acc[s.nivel] = (acc[s.nivel] ?? 0) + 1;
      return acc;
    }, {});

    return exito(
      {
        total: servicios.length,
        porCapa,
        porNivel,
        simulados: servicios.filter((s) => s.simulado).length,
        conSoap: servicios.filter((s) =>
          s.bindings.some((b) => b.tipoAcceso === 'SOAP'),
        ).length,
        servicios: servicios.map((s) => ({
          serviceKey: s.serviceKey,
          nombre: s.nombre,
          capa: s.capa,
          nivel: s.nivel,
          simulado: s.simulado,
          protocolos: s.bindings.map((b) => b.tipoAcceso),
        })),
      },
      app.meta(peticion),
    );
  });
}
