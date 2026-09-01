/**
 * ESQUELETO VERTICAL — la prueba que valida la arquitectura completa.
 *
 * Levanta **servicios HTTP reales** y hace atravesar una petición por todo el
 * circuito:
 *
 *     consumidor → ESB → Sales & Customer Service
 *                   ↓
 *              Auditoría (registra cada paso)
 *
 * No hay simulaciones del transporte: son procesos escuchando en puertos, igual
 * que en producción. Si la arquitectura no cierra, esta prueba lo dice.
 *
 * Es la Fase 2 del plan y el momento que más riesgo elimina del proyecto.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaHttp } from '@pos/service-kit';

import { Bus } from '../src/bus.js';
import { TablaRuteo } from '../src/ruteo.js';
import { TransporteHttp } from '../src/transporte-http.js';

// Puertos altos para no chocar con nada que esté corriendo.
const PUERTO_AUDITORIA = 3912;
const PUERTO_SALES = 3901;

let auditoriaApp: FastifyInstance;
let salesApp: FastifyInstance;
let bus: Bus;

/** Entradas que Auditoria.Utility recibió de verdad, por HTTP. */
const entradasRecibidas: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  // ── Auditoria.Utility ─────────────────────────────────────────
  auditoriaApp = await crearServicio({
    config: cargarConfig({
      nombre: 'Auditoria.Utility',
      puertoPorDefecto: PUERTO_AUDITORIA,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
  });
  auditoriaApp.post('/entradas', async (peticion, respuesta) => {
    entradasRecibidas.push(peticion.body as Record<string, unknown>);
    return respuesta.code(202).send({ exito: true });
  });
  await auditoriaApp.listen({ port: PUERTO_AUDITORIA, host: '127.0.0.1' });

  // ── Sales & Customer Service ──────────────────────────────────
  // Audita contra el servicio real, no contra un doble.
  salesApp = await crearServicio({
    config: cargarConfig({
      nombre: 'Sales.Customer.Entity',
      puertoPorDefecto: PUERTO_SALES,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria: new AuditoriaHttp(`http://127.0.0.1:${PUERTO_AUDITORIA}`),
  });
  salesApp.get('/catalogo/items/:sku', async (peticion) => {
    const { sku } = peticion.params as { sku: string };

    await salesApp.auditoria.registrar({
      correlationId: peticion.correlationId,
      servicio: 'Sales.Customer.Entity',
      accion: 'ITEM_CATALOGO_CONSULTADO',
      recurso: 'item-catalogo',
      recursoId: sku,
      usuario: 'sistema',
      timestamp: new Date().toISOString(),
    });

    return {
      exito: true,
      datos: { sku, nombre: 'Shampoo anticaspa 500ml', precioBase: 25.0 },
      error: null,
      meta: { correlationId: peticion.correlationId, servicio: 'Sales.Customer.Entity' },
    };
  });
  await salesApp.listen({ port: PUERTO_SALES, host: '127.0.0.1' });

  // ── ESB ───────────────────────────────────────────────────────
  bus = new Bus({
    tabla: new TablaRuteo([
      {
        id: 'catalogo-lectura',
        metodos: ['GET'],
        prefijo: '/catalogo',
        servicio: 'Sales.Customer.Entity',
        destino: `http://127.0.0.1:${PUERTO_SALES}`,
      },
    ]),
    transporte: new TransporteHttp(5000),
    auditoria: new AuditoriaHttp(`http://127.0.0.1:${PUERTO_AUDITORIA}`),
  });
});

afterAll(async () => {
  await Promise.all([salesApp.close(), auditoriaApp.close()]);
});

describe('circuito completo: consumidor → ESB → servicio → auditoría', () => {
  it('la petición atraviesa el bus y vuelve con los datos del servicio', async () => {
    const respuesta = await bus.procesar(
      {
        metodo: 'GET',
        ruta: '/catalogo/items/SH-500ML',
        correlationId: 'corr-esqueleto-001',
      },
      undefined,
    );

    expect(respuesta.estado).toBe(200);
    const cuerpo = respuesta.cuerpo as { exito: boolean; datos: { sku: string } };
    expect(cuerpo.exito).toBe(true);
    expect(cuerpo.datos.sku).toBe('SH-500ML');
  });

  it('el correlationId sobrevive el salto por el bus hasta el servicio', async () => {
    const respuesta = await bus.procesar(
      {
        metodo: 'GET',
        ruta: '/catalogo/items/SH-500ML',
        correlationId: 'corr-propagacion',
      },
      undefined,
    );

    // El servicio lo recibió y lo devolvió: la cadena no se rompió.
    const cuerpo = respuesta.cuerpo as { meta: { correlationId: string } };
    expect(cuerpo.meta.correlationId).toBe('corr-propagacion');
  });

  it('bus y servicio auditan bajo el MISMO correlationId', async () => {
    const correlationId = 'corr-traza-completa';
    entradasRecibidas.length = 0;

    await bus.procesar(
      { metodo: 'GET', ruta: '/catalogo/items/SH-500ML', correlationId },
      undefined,
    );

    // La auditoría es asíncrona por diseño: no bloquea la respuesta.
    await esperarA(() => entradasRecibidas.length >= 3);

    const deLaOperacion = entradasRecibidas.filter(
      (e) => e['correlationId'] === correlationId,
    );

    const acciones = deLaOperacion.map((e) => e['accion']);
    expect(acciones).toContain('MENSAJE_RUTEADO');
    expect(acciones).toContain('ITEM_CATALOGO_CONSULTADO');
    expect(acciones).toContain('MENSAJE_ENTREGADO');

    // Esto es lo que permite responder después "¿qué le pasó a esta operación?".
    const servicios = new Set(deLaOperacion.map((e) => e['servicio']));
    expect(servicios).toContain('ESB');
    expect(servicios).toContain('Sales.Customer.Entity');
  });

  it('el bus rechaza una ruta no declarada sin llegar al servicio', async () => {
    await expect(
      bus.procesar(
        { metodo: 'GET', ruta: '/ruta-inexistente', correlationId: 'corr-sin-ruta' },
        undefined,
      ),
    ).rejects.toThrow(/tabla de ruteo/i);
  });

  it('un destino caído se reporta como fallo de dependencia, no del emisor', async () => {
    const busRoto = new Bus({
      tabla: new TablaRuteo([
        {
          id: 'destino-caido',
          metodos: ['GET'],
          prefijo: '/catalogo',
          servicio: 'Servicio.Inexistente',
          destino: 'http://127.0.0.1:59998',
        },
      ]),
      transporte: new TransporteHttp(1000),
      auditoria: new AuditoriaHttp(`http://127.0.0.1:${PUERTO_AUDITORIA}`),
    });

    await expect(
      busRoto.procesar(
        { metodo: 'GET', ruta: '/catalogo/items/X', correlationId: 'corr-caido' },
        undefined,
      ),
    ).rejects.toThrow(/no respondió/i);
  });
});

/** Espera activa acotada. La auditoría es asíncrona y no debe bloquear la respuesta. */
async function esperarA(condicion: () => boolean, intentos = 50): Promise<void> {
  for (let i = 0; i < intentos; i += 1) {
    if (condicion()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}
