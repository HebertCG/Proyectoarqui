import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig } from '@pos/service-kit';

import { registrarRutas } from '../src/rutas.js';
import { RepositorioMemoria } from '../src/repositorio-memoria.js';

let app: FastifyInstance;
let repositorio: RepositorioMemoria;

const entradaBase = {
  correlationId: 'corr-venta-001',
  servicio: 'Sales.Customer.Entity',
  accion: 'VENTA_REGISTRADA',
  recurso: 'ticket',
  recursoId: 'tk-001',
  usuario: 'cajero01',
};

beforeEach(async () => {
  repositorio = new RepositorioMemoria();
  app = await crearServicio({
    config: cargarConfig({
      nombre: 'Auditoria.Utility',
      puertoPorDefecto: 3012,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
  });
  registrarRutas(app, repositorio);
  await app.ready();
});

const registrar = (cuerpo: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/entradas', payload: cuerpo });

describe('RegistrarEntrada', () => {
  it('acepta con 202: la auditoría no bloquea la operación de negocio', async () => {
    const r = await registrar(entradaBase);

    expect(r.statusCode).toBe(202);
    expect(r.json().exito).toBe(true);
    expect(r.json().datos.aceptada).toBe(true);
    expect(repositorio.tamano).toBe(1);
  });

  it('pone el timestamp cuando el emisor lo omite', async () => {
    await registrar(entradaBase);
    const traza = await repositorio.traza('corr-venta-001');

    expect(traza[0]?.timestamp).toBeInstanceOf(Date);
    expect(Number.isNaN(traza[0]?.timestamp.getTime())).toBe(false);
  });

  it('respeta el timestamp del emisor cuando venía offline', async () => {
    const ocurrido = '2026-08-29T10:15:00.000Z';
    await registrar({ ...entradaBase, timestamp: ocurrido });

    const traza = await repositorio.traza('corr-venta-001');
    expect(traza[0]?.timestamp.toISOString()).toBe(ocurrido);
  });

  it('rechaza una entrada sin usuario (RNF-11 exige saber quién)', async () => {
    const { usuario, ...sinUsuario } = entradaBase;
    void usuario;

    const r = await registrar(sinUsuario);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe('VALIDACION_ESQUEMA');
  });

  it('guarda el detalle del cambio', async () => {
    await registrar({ ...entradaBase, detalle: { total: 120.5, comprobante: 'F001-128' } });

    const traza = await repositorio.traza('corr-venta-001');
    expect(traza[0]?.detalle).toEqual({ total: 120.5, comprobante: 'F001-128' });
  });
});

describe('append-only (RNF-08)', () => {
  it('no expone PUT sobre una entrada', async () => {
    await registrar(entradaBase);
    const r = await app.inject({ method: 'PUT', url: '/entradas', payload: entradaBase });
    expect(r.statusCode).toBe(404);
  });

  it('no expone DELETE sobre una entrada', async () => {
    await registrar(entradaBase);
    const r = await app.inject({ method: 'DELETE', url: '/entradas' });
    expect(r.statusCode).toBe(404);
  });
});

describe('RegistrarLote — drenaje del terminal tras estar offline', () => {
  it('acepta varias entradas de una vez', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/entradas/lote',
      payload: {
        entradas: [
          entradaBase,
          { ...entradaBase, accion: 'CAJA_CERRADA', recurso: 'turno' },
          { ...entradaBase, accion: 'COMPROBANTE_EMITIDO', recurso: 'comprobante' },
        ],
      },
    });

    expect(r.statusCode).toBe(202);
    expect(r.json().datos.aceptadas).toBe(3);
    expect(r.json().datos.duplicadas).toBe(0);
  });

  it('rechaza un lote vacío', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/entradas/lote',
      payload: { entradas: [] },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('BuscarEntradas', () => {
  beforeEach(async () => {
    await registrar({ ...entradaBase, timestamp: '2026-08-29T09:00:00.000Z' });
    await registrar({
      ...entradaBase,
      correlationId: 'corr-caja-002',
      accion: 'CAJA_CERRADA',
      recurso: 'turno',
      usuario: 'supervisor01',
      timestamp: '2026-08-29T18:00:00.000Z',
    });
    await registrar({
      ...entradaBase,
      correlationId: 'corr-venta-003',
      servicio: 'EInvoicing.Entity',
      accion: 'COMPROBANTE_ACEPTADO',
      timestamp: '2026-08-29T12:00:00.000Z',
    });
  });

  it('filtra por servicio', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/entradas/buscar?servicio=EInvoicing.Entity',
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].accion).toBe('COMPROBANTE_ACEPTADO');
  });

  it('filtra por usuario: quién autorizó, no quién operó', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/entradas/buscar?usuario=supervisor01',
    });

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].accion).toBe('CAJA_CERRADA');
  });

  it('filtra por rango de fechas', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/entradas/buscar?desde=2026-08-29T11:00:00.000Z&hasta=2026-08-29T13:00:00.000Z',
    });

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].servicio).toBe('EInvoicing.Entity');
  });

  it('devuelve las más recientes primero y pagina', async () => {
    const r = await app.inject({ method: 'GET', url: '/entradas/buscar?limite=2' });

    expect(r.json().datos).toHaveLength(2);
    expect(r.json().datos[0].accion).toBe('CAJA_CERRADA');
    expect(r.json().meta.total).toBe(3);
  });
});

describe('ConsultarTraza — evidencia de trazabilidad del PROY', () => {
  it('reconstruye el recorrido completo de una operación', async () => {
    const correlationId = 'corr-venta-e2e';
    const pasos = [
      { servicio: 'Sales.Customer.Entity', accion: 'VENTA_REGISTRADA', t: '2026-08-29T10:00:00.000Z' },
      { servicio: 'ESB', accion: 'MENSAJE_RUTEADO', t: '2026-08-29T10:00:01.000Z' },
      { servicio: 'EInvoicing.Entity', accion: 'COMPROBANTE_ENVIADO', t: '2026-08-29T10:00:05.000Z' },
      { servicio: 'EInvoicing.Entity', accion: 'COMPROBANTE_ACEPTADO', t: '2026-08-29T10:00:09.000Z' },
    ];

    for (const paso of pasos) {
      await registrar({
        ...entradaBase,
        correlationId,
        servicio: paso.servicio,
        accion: paso.accion,
        timestamp: paso.t,
      });
    }

    const r = await app.inject({ method: 'GET', url: `/trazas/${correlationId}` });
    const datos = r.json().datos;

    expect(r.statusCode).toBe(200);
    expect(datos.pasos).toHaveLength(4);
    // En orden cronológico, no de inserción.
    expect(datos.pasos.map((p: { accion: string }) => p.accion)).toEqual([
      'VENTA_REGISTRADA',
      'MENSAJE_RUTEADO',
      'COMPROBANTE_ENVIADO',
      'COMPROBANTE_ACEPTADO',
    ]);
    expect(datos.serviciosInvolucrados).toEqual([
      'Sales.Customer.Entity',
      'ESB',
      'EInvoicing.Entity',
    ]);
    expect(datos.iniciadaEn).toBe('2026-08-29T10:00:00.000Z');
    expect(datos.finalizadaEn).toBe('2026-08-29T10:00:09.000Z');
  });

  it('devuelve 404 con envelope si la operación no existe', async () => {
    const r = await app.inject({ method: 'GET', url: '/trazas/no-existe' });

    expect(r.statusCode).toBe(404);
    expect(r.json().exito).toBe(false);
    expect(r.json().error.codigo).toBe('TRAZA_NO_ENCONTRADA');
  });
});

describe('idempotencia del repositorio (RF-SYNC-07)', () => {
  it('no duplica una entrada con el mismo uuid', async () => {
    const entrada = {
      uuid: '3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17',
      correlationId: 'corr-1',
      servicio: 'Sales.Customer.Entity',
      accion: 'VENTA_REGISTRADA',
      recurso: 'ticket',
      usuario: 'cajero01',
      timestamp: new Date(),
    };

    expect(await repositorio.registrar(entrada)).toBe(true);
    expect(await repositorio.registrar(entrada)).toBe(false);
    expect(await repositorio.registrar(entrada)).toBe(false);
    expect(repositorio.tamano).toBe(1);
  });

  it('el lote distingue insertadas de duplicadas', async () => {
    const hacer = (uuid: string) => ({
      uuid,
      correlationId: 'corr-1',
      servicio: 'S',
      accion: 'A',
      recurso: 'r',
      usuario: 'u',
      timestamp: new Date(),
    });

    await repositorio.registrar(hacer('3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17'));

    const resultado = await repositorio.registrarLote([
      hacer('3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17'),
      hacer('8a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d'),
    ]);

    expect(resultado).toEqual({ insertadas: 1, duplicadas: 1 });
  });
});
