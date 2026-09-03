/**
 * Bootstrap común de todo servicio del inventario.
 *
 * Cada servicio se reduce a: `crearServicio({...})` + sus rutas. Todo lo
 * transversal — correlación, validación, envelope, errores, idempotencia,
 * auditoría, health — vive aquí una sola vez (CLAUDE.md §2.1 P4).
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

import { type ConfigServicio } from './config.js';
import { exito, fallo, type MetaRespuesta } from './envelope.js';
import { ErrorServicio, esErrorServicio } from './errores.js';
import {
  AlmacenMemoria,
  CABECERA_IDEMPOTENCIA,
  METODOS_PROTEGIDOS,
  claveDeOperacion,
  esUuidV4,
  type AlmacenIdempotencia,
} from './idempotencia.js';
import { AuditoriaConsola, type ClienteAuditoria } from './auditoria.js';

export const CABECERA_CORRELACION = 'x-correlation-id';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
  interface FastifyInstance {
    config: ConfigServicio;
    auditoria: ClienteAuditoria;
    meta(peticion: FastifyRequest): MetaRespuesta;
  }
}

export interface OpcionesServicio {
  config: ConfigServicio;
  auditoria?: ClienteAuditoria;
  almacenIdempotencia?: AlmacenIdempotencia;
}

export type Servicio = FastifyInstance & {
  withTypeProvider<T>(): FastifyInstance;
};

export async function crearServicio(
  opciones: OpcionesServicio,
): Promise<FastifyInstance> {
  const { config } = opciones;
  const auditoria = opciones.auditoria ?? new AuditoriaConsola();
  const almacen = opciones.almacenIdempotencia ?? new AlmacenMemoria();

  const app = Fastify({
    logger: {
      level: config.nivelLog,
      // El correlationId acompaña cada línea de log: sin eso la auditoría
      // a través del bus es inservible.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: (req) =>
      (req.headers[CABECERA_CORRELACION] as string | undefined) ?? randomUUID(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('config', config);
  app.decorate('auditoria', auditoria);
  app.decorateRequest('correlationId', '');

  app.decorate('meta', (peticion: FastifyRequest): MetaRespuesta => ({
    correlationId: peticion.correlationId,
    servicio: config.nombre,
    timestamp: new Date().toISOString(),
  }));

  // ── Correlación: entra o se genera, y siempre sale en la respuesta ─────
  app.addHook('onRequest', async (peticion, respuesta) => {
    const entrante = peticion.headers[CABECERA_CORRELACION];
    peticion.correlationId =
      typeof entrante === 'string' && entrante.length > 0 ? entrante : peticion.id;
    respuesta.header(CABECERA_CORRELACION, peticion.correlationId);
  });

  // ── Idempotencia sobre métodos que cambian estado ──────────────────────
  app.addHook('preHandler', async (peticion, respuesta) => {
    if (!METODOS_PROTEGIDOS.has(peticion.method)) return;

    const clave = peticion.headers[CABECERA_IDEMPOTENCIA];
    if (typeof clave !== 'string') return; // opcional: sin clave, sin protección

    if (!esUuidV4(clave)) {
      throw new ErrorServicio(
        'VALIDACION',
        'CLAVE_IDEMPOTENCIA_INVALIDA',
        `La cabecera ${CABECERA_IDEMPOTENCIA} debe ser un UUIDv4.`,
      );
    }

    // Acotada a la operación: la misma clave sobre dos endpoints distintos son
    // dos cosas distintas, no un reenvío.
    const clavePorOperacion = claveDeOperacion(
      peticion.method,
      rutaDe(peticion),
      clave,
    );

    const previa = await almacen.obtener(clavePorOperacion);
    if (previa) {
      // Reenvío de algo ya procesado: se devuelve la respuesta original.
      respuesta.header('idempotent-replay', 'true');
      return respuesta.code(previa.estado).send(previa.cuerpo);
    }

    const reservada = await almacen.reservar(clavePorOperacion);
    if (!reservada) {
      throw new ErrorServicio(
        'CONFLICTO',
        'OPERACION_EN_CURSO',
        'Ya hay una petición en curso con esta clave de idempotencia.',
      );
    }
  });

  // ── Guarda la respuesta para futuros reenvíos ──────────────────────────
  app.addHook('onSend', async (peticion, respuesta, cuerpo) => {
    const clave = peticion.headers[CABECERA_IDEMPOTENCIA];
    if (typeof clave !== 'string' || !esUuidV4(clave)) return cuerpo;
    if (!METODOS_PROTEGIDOS.has(peticion.method)) return cuerpo;
    if (respuesta.getHeader('idempotent-replay')) return cuerpo;

    const clavePorOperacion = claveDeOperacion(
      peticion.method,
      rutaDe(peticion),
      clave,
    );

    if (respuesta.statusCode < 500) {
      await almacen.guardar(clavePorOperacion, {
        estado: respuesta.statusCode,
        cuerpo: typeof cuerpo === 'string' ? JSON.parse(cuerpo) : cuerpo,
        guardadoEn: Date.now(),
      });
    } else {
      await almacen.liberar(clavePorOperacion);
    }
    return cuerpo;
  });

  // ── Errores: siempre envelope, nunca stack trace al cliente ────────────
  app.setErrorHandler((error, peticion, respuesta) => {
    const meta = app.meta(peticion);

    if (esErrorServicio(error)) {
      peticion.log.warn(
        { codigo: error.codigo, correlationId: meta.correlationId },
        error.message,
      );
      return respuesta
        .code(error.estadoHttp)
        .send(
          fallo(
            { codigo: error.codigo, mensaje: error.message, detalles: error.detalles },
            meta,
          ),
        );
    }

    // Error de validación de esquema de Fastify
    if ((error as { validation?: unknown }).validation) {
      return respuesta.code(400).send(
        fallo(
          {
            codigo: 'VALIDACION_ESQUEMA',
            mensaje: 'La petición no cumple el contrato del servicio.',
            detalles: (error as { validation?: unknown }).validation,
          },
          meta,
        ),
      );
    }

    // Fastify anota el estado en sus propios errores (cuerpo mal formado,
    // ruta no permitida...). Devolver 500 a ciegas convertiria un error del
    // llamante en un fallo aparente del servicio, y quien depura buscaria
    // en el sitio equivocado.
    const estadoFramework = (error as { statusCode?: number }).statusCode;
    const esErrorDelLlamante =
      typeof estadoFramework === 'number' && estadoFramework >= 400 && estadoFramework < 500;

    if (esErrorDelLlamante) {
      peticion.log.warn(
        { err: error, correlationId: meta.correlationId },
        'Peticion invalida',
      );
      return respuesta.code(estadoFramework).send(
        fallo(
          {
            codigo: (error as { code?: string }).code ?? 'SOLICITUD_INVALIDA',
            mensaje: (error as Error).message,
          },
          meta,
        ),
      );
    }

    peticion.log.error({ err: error, correlationId: meta.correlationId }, 'Error no controlado');
    return respuesta.code(500).send(
      fallo(
        { codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servicio.' },
        meta,
      ),
    );
  });

  app.setNotFoundHandler((peticion, respuesta) =>
    respuesta.code(404).send(
      fallo(
        { codigo: 'RUTA_NO_ENCONTRADA', mensaje: `No existe ${peticion.method} ${peticion.url}` },
        app.meta(peticion),
      ),
    ),
  );

  // ── Health: lo consulta el registro para saber si el servicio vive ─────
  app.get('/health', async (peticion) =>
    exito(
      {
        estado: 'ok',
        servicio: config.nombre,
        version: config.version,
        entorno: config.entorno,
        auditoriaPendiente: auditoria.pendientes(),
      },
      app.meta(peticion),
    ),
  );

  return app;
}

/**
 * Plantilla de la ruta (`/ventas/tickets/:uuid/cierre`). Si Fastify no la
 * expone —ruta no encontrada, por ejemplo— cae a la URL concreta, que sigue
 * distinguiendo operaciones aunque sea menos estable.
 */
function rutaDe(peticion: FastifyRequest): string {
  return peticion.routeOptions?.url ?? peticion.url;
}
