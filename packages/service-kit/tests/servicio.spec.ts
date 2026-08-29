import { describe, it, expect, beforeEach } from 'vitest';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { crearServicio, CABECERA_CORRELACION } from '../src/servicio.js';
import { cargarConfig } from '../src/config.js';
import { AuditoriaConsola, nuevaEntrada } from '../src/auditoria.js';
import { AlmacenMemoria, CABECERA_IDEMPOTENCIA } from '../src/idempotencia.js';
import { errorNoEncontrado, errorReglaNegocio } from '../src/errores.js';
import { exito } from '../src/envelope.js';

const config = cargarConfig({
  nombre: 'servicio-prueba',
  puertoPorDefecto: 3999,
  env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
});

let app: FastifyInstance;
let auditoria: AuditoriaConsola;

beforeEach(async () => {
  auditoria = new AuditoriaConsola();
  app = await crearServicio({
    config,
    auditoria,
    almacenIdempotencia: new AlmacenMemoria(),
  });

  app.get('/ok', async (peticion) => exito({ valor: 42 }, app.meta(peticion)));

  app.get('/no-existe', async () => {
    throw errorNoEncontrado('CLIENTE_NO_ENCONTRADO', 'El cliente no existe.');
  });

  app.post('/regla', async () => {
    throw errorReglaNegocio(
      'RUC_REQUIERE_FACTURA',
      'Un cliente con RUC no puede recibir Boleta.',
      { tipoDocumento: 'RUC', comprobanteSolicitado: 'BOLETA' },
    );
  });

  let contador = 0;
  app.post(
    '/contar',
    { schema: { body: Type.Object({ monto: Type.Number() }) } },
    async (peticion) => {
      contador += 1;
      return exito({ ejecuciones: contador }, app.meta(peticion));
    },
  );

  await app.ready();
});

describe('health', () => {
  it('responde con el envelope estándar', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    const cuerpo = r.json();

    expect(r.statusCode).toBe(200);
    expect(cuerpo.exito).toBe(true);
    expect(cuerpo.datos.estado).toBe('ok');
    expect(cuerpo.datos.servicio).toBe('servicio-prueba');
    expect(cuerpo.error).toBeNull();
    expect(cuerpo.meta.correlationId).toBeTruthy();
  });
});

describe('correlación', () => {
  it('propaga el correlationId entrante', async () => {
    const id = 'corr-abc-123';
    const r = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [CABECERA_CORRELACION]: id },
    });

    expect(r.headers[CABECERA_CORRELACION]).toBe(id);
    expect(r.json().meta.correlationId).toBe(id);
  });

  it('genera uno cuando no viene', async () => {
    const r = await app.inject({ method: 'GET', url: '/ok' });
    expect(r.headers[CABECERA_CORRELACION]).toBeTruthy();
    expect(r.json().meta.correlationId).toBeTruthy();
  });
});

describe('manejo de errores', () => {
  it('convierte ErrorServicio en envelope con su estado HTTP', async () => {
    const r = await app.inject({ method: 'GET', url: '/no-existe' });
    const cuerpo = r.json();

    expect(r.statusCode).toBe(404);
    expect(cuerpo.exito).toBe(false);
    expect(cuerpo.datos).toBeNull();
    expect(cuerpo.error.codigo).toBe('CLIENTE_NO_ENCONTRADO');
  });

  it('usa 422 para violaciones de regla de negocio y conserva detalles', async () => {
    const r = await app.inject({ method: 'POST', url: '/regla' });
    const cuerpo = r.json();

    expect(r.statusCode).toBe(422);
    expect(cuerpo.error.codigo).toBe('RUC_REQUIERE_FACTURA');
    expect(cuerpo.error.detalles.tipoDocumento).toBe('RUC');
  });

  it('rechaza un cuerpo que no cumple el esquema del contrato', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/contar',
      payload: { monto: 'no-es-numero' },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe('VALIDACION_ESQUEMA');
  });

  it('devuelve envelope también en rutas inexistentes', async () => {
    const r = await app.inject({ method: 'GET', url: '/ruta-fantasma' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe('RUTA_NO_ENCONTRADA');
  });
});

describe('idempotencia (RF-SYNC-07, RNF-09)', () => {
  const clave = '3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17';

  it('ejecuta una sola vez aunque la petición se reenvíe', async () => {
    const enviar = () =>
      app.inject({
        method: 'POST',
        url: '/contar',
        headers: { [CABECERA_IDEMPOTENCIA]: clave },
        payload: { monto: 100 },
      });

    const primera = await enviar();
    const segunda = await enviar();
    const tercera = await enviar();

    expect(primera.json().datos.ejecuciones).toBe(1);
    expect(segunda.json().datos.ejecuciones).toBe(1);
    expect(tercera.json().datos.ejecuciones).toBe(1);
    expect(segunda.headers['idempotent-replay']).toBe('true');
  });

  it('claves distintas ejecutan de forma independiente', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/contar',
      headers: { [CABECERA_IDEMPOTENCIA]: clave },
      payload: { monto: 100 },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/contar',
      headers: { [CABECERA_IDEMPOTENCIA]: '8a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d' },
      payload: { monto: 200 },
    });

    expect(a.json().datos.ejecuciones).toBe(1);
    expect(b.json().datos.ejecuciones).toBe(2);
  });

  it('rechaza una clave que no es UUIDv4', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/contar',
      headers: { [CABECERA_IDEMPOTENCIA]: 'clave-cualquiera' },
      payload: { monto: 100 },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe('CLAVE_IDEMPOTENCIA_INVALIDA');
  });

  it('sin cabecera de idempotencia, cada petición ejecuta', async () => {
    await app.inject({ method: 'POST', url: '/contar', payload: { monto: 1 } });
    const segunda = await app.inject({
      method: 'POST',
      url: '/contar',
      payload: { monto: 1 },
    });
    expect(segunda.json().datos.ejecuciones).toBe(2);
  });
});

describe('auditoría', () => {
  it('registra la entrada con usuario y marca de tiempo (RNF-11)', async () => {
    await app.auditoria.registrar(
      nuevaEntrada({
        correlationId: 'corr-1',
        servicio: 'servicio-prueba',
        accion: 'VENTA_REGISTRADA',
        recurso: 'venta',
        recursoId: 'v-001',
        usuario: 'cajero-01',
        detalle: { total: 120.0 },
      }),
    );

    expect(auditoria.entradas).toHaveLength(1);
    const e = auditoria.entradas[0]!;
    expect(e.accion).toBe('VENTA_REGISTRADA');
    expect(e.usuario).toBe('cajero-01');
    expect(Date.parse(e.timestamp)).not.toBeNaN();
  });
});
