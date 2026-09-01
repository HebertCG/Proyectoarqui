/**
 * Pruebas del transporte contra un servidor HTTP real levantado en el test.
 *
 * No se simula `fetch`: si se simulara, no se estaría probando lo único que
 * importa aquí —que las cabeceras salen bien y que un destino caído se traduce
 * al error correcto—, sino la simulación.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { CABECERA_CORRELACION, esErrorServicio } from '@pos/service-kit';

import { TransporteHttp } from '../src/transporte-http.js';
import type { MensajeEntrante, Ruta } from '../src/ruteo.js';

const PUERTO = 3199;
const DESTINO = `http://localhost:${PUERTO}`;

/** Última petición recibida, para poder afirmar sobre ella. */
let recibida: { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string };
let servidor: Server;

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res) => {
    let cuerpo = '';
    req.on('data', (trozo) => (cuerpo += trozo));
    req.on('end', () => {
      recibida = {
        url: req.url ?? '',
        metodo: req.method ?? '',
        cabeceras: req.headers as Record<string, string>,
        cuerpo,
      };

      if (req.url?.includes('/texto')) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('respuesta en texto');
        return;
      }
      if (req.url?.includes('/error')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ exito: false, error: { codigo: 'NO_ENCONTRADO' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ exito: true, datos: { sku: 'SH-500ML' } }));
    });
  });
  await new Promise<void>((r) => servidor.listen(PUERTO, r));
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

const ruta = (destino = DESTINO): Ruta => ({
  id: 'catalogo',
  metodos: ['GET', 'POST'],
  prefijo: '/catalogo',
  servicio: 'Sales.Customer.Entity',
  destino,
});

const mensaje = (parcial: Partial<MensajeEntrante> = {}): MensajeEntrante => ({
  metodo: 'GET',
  ruta: '/catalogo/items/SH-500ML',
  correlationId: 'corr-001',
  ...parcial,
});

const transporte = new TransporteHttp(2000);

describe('entrega al destino', () => {
  it('compone la URL con el destino de la ruta y el path del mensaje', async () => {
    await transporte.entregar(ruta(), mensaje(), undefined, {});

    expect(recibida.url).toBe('/catalogo/items/SH-500ML');
    expect(recibida.metodo).toBe('GET');
  });

  it('devuelve estado, cuerpo y cabeceras del destino', async () => {
    const r = await transporte.entregar(ruta(), mensaje(), undefined, {});

    expect(r.estado).toBe(200);
    expect(r.cuerpo).toEqual({ exito: true, datos: { sku: 'SH-500ML' } });
    expect(r.cabeceras['content-type']).toContain('application/json');
  });

  it('transporta un 404 sin reinterpretarlo', async () => {
    const r = await transporte.entregar(
      ruta(),
      mensaje({ ruta: '/catalogo/error' }),
      undefined,
      {},
    );

    expect(r.estado).toBe(404);
    expect((r.cuerpo as { error: { codigo: string } }).error.codigo).toBe('NO_ENCONTRADO');
  });

  it('lee respuestas que no son JSON', async () => {
    const r = await transporte.entregar(
      ruta(),
      mensaje({ ruta: '/catalogo/texto' }),
      undefined,
      {},
    );

    expect(r.cuerpo).toBe('respuesta en texto');
  });

  it('serializa el cuerpo en las peticiones que lo llevan', async () => {
    const cuerpo = { sku: 'SH-500ML', cantidad: 3 };

    await transporte.entregar(ruta(), mensaje({ metodo: 'POST' }), cuerpo, {});

    expect(JSON.parse(recibida.cuerpo)).toEqual(cuerpo);
  });
});

describe('propagación del correlationId', () => {
  it('lo añade a la petición saliente: sin esto la traza se corta en el bus', async () => {
    await transporte.entregar(ruta(), mensaje({ correlationId: 'corr-venta-e2e' }), undefined, {});

    expect(recibida.cabeceras[CABECERA_CORRELACION]).toBe('corr-venta-e2e');
  });

  it('el del mensaje gana sobre el que venga en las cabeceras entrantes', async () => {
    await transporte.entregar(
      ruta(),
      mensaje({ correlationId: 'el-correcto' }),
      undefined,
      { [CABECERA_CORRELACION]: 'el-viejo' },
    );

    expect(recibida.cabeceras[CABECERA_CORRELACION]).toBe('el-correcto');
  });
});

describe('manejo de cabeceras', () => {
  it('reenvía las cabeceras de negocio', async () => {
    await transporte.entregar(ruta(), mensaje(), undefined, {
      authorization: 'Bearer token-123',
      'idempotency-key': '3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17',
    });

    expect(recibida.cabeceras['authorization']).toBe('Bearer token-123');
    expect(recibida.cabeceras['idempotency-key']).toBe(
      '3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17',
    );
  });

  it('no reenvía las cabeceras de transporte del salto anterior', async () => {
    await transporte.entregar(ruta(), mensaje(), undefined, {
      host: 'otro-host:9999',
      connection: 'keep-alive',
      'content-length': '999',
    });

    // El host debe ser el del destino real, no el que traía el mensaje.
    expect(recibida.cabeceras['host']).toBe(`localhost:${PUERTO}`);
    expect(recibida.cabeceras['content-length']).not.toBe('999');
  });

  it('pone content-type JSON cuando no viene', async () => {
    await transporte.entregar(ruta(), mensaje({ metodo: 'POST' }), { a: 1 }, {});

    expect(recibida.cabeceras['content-type']).toContain('application/json');
  });
});

describe('destino inalcanzable', () => {
  it('lo traduce a error de dependencia, no a error del emisor', async () => {
    const inalcanzable = ruta('http://localhost:59999');

    try {
      await transporte.entregar(inalcanzable, mensaje(), undefined, {});
      expect.unreachable('debió lanzar');
    } catch (e) {
      expect(esErrorServicio(e)).toBe(true);
      if (esErrorServicio(e)) {
        expect(e.codigo).toBe('DESTINO_INALCANZABLE');
        // 502: la culpa es del servicio caído, no de quien llamó.
        expect(e.estadoHttp).toBe(502);
        expect(e.message).toContain('Sales.Customer.Entity');
      }
    }
  });

  it('el detalle nombra el servicio caído, para poder diagnosticar', async () => {
    try {
      await transporte.entregar(ruta('http://localhost:59999'), mensaje(), undefined, {});
      expect.unreachable('debió lanzar');
    } catch (e) {
      if (!esErrorServicio(e)) throw e;
      const detalle = e.detalles as { destino: string; url: string };
      expect(detalle.destino).toBe('Sales.Customer.Entity');
      expect(detalle.url).toContain('59999');
    }
  });
});
