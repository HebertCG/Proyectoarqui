/**
 * `ProcesoVenta.Task` de extremo a extremo, con el ESB simulado.
 *
 * Lo que se prueba aquí no es HTTP: es que el orquestador traduzca
 * correctamente entre lo que responden los servicios y las ramas del modelo
 * BPMN — sobre todo la que decide si hay que compensar.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';

import { registrarRutas } from '../src/rutas.js';
import type { Esb, Peticion, RespuestaEsb } from '../src/cliente-esb.js';

const TICKET = '11111111-1111-4111-8111-111111111111';
const CLIENTE = 'aaaaaaaa-1111-4111-8111-111111111111';
const COMPROBANTE = '22222222-2222-4222-8222-222222222222';

const PETICION_BASE = {
  ticketUuid: TICKET,
  tipoComprobante: 'FACTURA' as const,
  pagos: [{ formaPago: 'EFECTIVO' as const, monto: 120, montoRecibido: 150 }],
  codigoAutorizacion: 'sup:1234',
};

/** Respuestas por defecto: el camino feliz completo. */
function respuestasPorDefecto(): Record<string, RespuestaEsb<unknown>> {
  return {
    [`POST /ventas/tickets/${TICKET}/comprobante/verificar`]: {
      estado: 200,
      datos: { compatible: true, permitidos: ['FACTURA'] },
      error: null,
    },
    [`POST /ventas/tickets/${TICKET}/cierre`]: {
      estado: 200,
      datos: {
        ticket: {
          uuid: TICKET,
          clienteUuid: CLIENTE,
          total: 120,
          lineas: [
            {
              sku: 'SH-500ML',
              descripcion: 'Shampoo anticaspa 500ml',
              cantidad: 3,
              precioFinal: 25,
              importe: 75,
            },
            {
              sku: 'SRV-CORTE',
              descripcion: 'Corte de cabello',
              cantidad: 1,
              precioFinal: 45,
              importe: 45,
            },
          ],
        },
        comprobante: {
          uuid: COMPROBANTE,
          tipoComprobante: 'FACTURA',
          serie: 'F001',
          correlativo: 1,
          fechaEmision: '2026-09-03',
          total: 120,
        },
        vuelto: 30,
      },
      error: null,
    },
    [`GET /clientes/${CLIENTE}`]: {
      estado: 200,
      datos: {
        tipoDocumento: 'RUC',
        numeroDocumento: '20512345678',
        razonSocial: 'Distribuidora Andina SAC',
      },
      error: null,
    },
    'POST /comprobantes': {
      estado: 202,
      datos: { duplicado: false },
      error: null,
    },
    [`POST /comprobantes/${COMPROBANTE}/envio`]: {
      estado: 200,
      datos: {
        comprobante: { estadoTributario: 'ACEPTADO' },
        respuestaSunat: { codigo: '0', descripcion: 'La Factura numero F001-1, ha sido aceptada' },
        reintentable: false,
      },
      error: null,
    },
    [`POST /ventas/tickets/${TICKET}/reversion`]: {
      estado: 200,
      datos: { reversion: { tipo: 'NOTA_CREDITO' } },
      error: null,
    },
  };
}

class EsbSimulado implements Esb {
  readonly llamadas: Peticion[] = [];
  readonly #respuestas: Record<string, RespuestaEsb<unknown>>;

  constructor(sobrescribe: Record<string, RespuestaEsb<unknown>> = {}) {
    this.#respuestas = { ...respuestasPorDefecto(), ...sobrescribe };
  }

  async llamar<T>(peticion: Peticion): Promise<RespuestaEsb<T>> {
    this.llamadas.push(peticion);

    const clave = `${peticion.metodo} ${peticion.ruta}`;
    const respuesta = this.#respuestas[clave];

    if (!respuesta) {
      throw new Error(`El ESB simulado no tiene respuesta para "${clave}".`);
    }
    return respuesta as RespuestaEsb<T>;
  }

  rutasLlamadas(): string[] {
    return this.llamadas.map((l) => `${l.metodo} ${l.ruta}`);
  }
}

async function montar(esb: Esb): Promise<FastifyInstance> {
  const app = await crearServicio({
    config: cargarConfig({
      nombre: 'ProcesoVenta.Task',
      puertoPorDefecto: 3020,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria: new AuditoriaConsola(),
  });

  registrarRutas(app, { esb });
  await app.ready();
  return app;
}

async function ejecutar(
  esb: EsbSimulado,
  cuerpo: Record<string, unknown> = {},
): Promise<{ estado: number; json: Record<string, never> }> {
  const app = await montar(esb);
  const r = await app.inject({
    method: 'POST',
    url: '/procesos/venta',
    payload: { ...PETICION_BASE, ...cuerpo },
  });
  return { estado: r.statusCode, json: r.json() };
}

describe('EjecutarProcesoVenta — venta facturada', () => {
  let esb: EsbSimulado;

  beforeEach(() => {
    esb = new EsbSimulado();
  });

  it('responde 200 y VENTA_FACTURADA', async () => {
    const { estado, json } = await ejecutar(esb);

    expect(estado).toBe(200);
    expect(json).toMatchObject({
      exito: true,
      datos: { codigo: 'VENTA_FACTURADA', desenlace: 'FinAceptado' },
    });
  });

  it('devuelve el documento emitido y el vuelto', async () => {
    const { json } = await ejecutar(esb);

    expect(json).toMatchObject({
      datos: { documento: 'F001-1', vuelto: 30, estadoTributario: 'ACEPTADO' },
    });
  });

  it('recorre los cinco pasos por el bus, en orden', async () => {
    await ejecutar(esb);

    expect(esb.rutasLlamadas()).toEqual([
      `POST /ventas/tickets/${TICKET}/comprobante/verificar`,
      `POST /ventas/tickets/${TICKET}/cierre`,
      `GET /clientes/${CLIENTE}`,
      'POST /comprobantes',
      `POST /comprobantes/${COMPROBANTE}/envio`,
    ]);
  });

  it('nunca llama a un servicio directamente: todo va al ESB', async () => {
    await ejecutar(esb);

    // Rutas relativas: si alguna llevara host, seria una llamada punto a punto.
    for (const llamada of esb.llamadas) {
      expect(llamada.ruta.startsWith('/')).toBe(true);
      expect(llamada.ruta).not.toMatch(/^https?:/);
    }
  });

  it('propaga el mismo correlationId a todas las llamadas', async () => {
    await ejecutar(esb);

    const ids = new Set(esb.llamadas.map((l) => l.correlationId));
    expect(ids.size).toBe(1);
  });

  it('protege el cobro con una clave que es UUIDv4 y estable entre reintentos', async () => {
    await ejecutar(esb);

    const cierre = esb.llamadas.find((l) => l.ruta.endsWith('/cierre'));
    // El correlationId no vale: lo pone el llamante y puede ser cualquier cosa.
    expect(cierre?.claveIdempotencia).toBe(TICKET);
    expect(cierre?.claveIdempotencia).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('usa el uuid del comprobante como clave al registrarlo, no el correlationId', async () => {
    await ejecutar(esb);

    const registro = esb.llamadas.find((l) => l.ruta === '/comprobantes');
    expect(registro?.claveIdempotencia).toBe(COMPROBANTE);
  });

  it('construye el documento fiscal con el cliente resuelto y el IGV desagregado', async () => {
    await ejecutar(esb);

    const registro = esb.llamadas.find((l) => l.ruta === '/comprobantes');
    expect(registro?.cuerpo).toMatchObject({
      serie: 'F001',
      correlativo: 1,
      cliente: { tipoDocumento: 'RUC', numeroDocumento: '20512345678' },
      total: 120,
      totalGravado: 101.69,
      totalIgv: 18.31,
    });
  });

  it('la traza deja los cuatro pasos en OK y sin compensacion', async () => {
    const { json } = await ejecutar(esb);
    const traza = (json as never as { datos: { traza: { pasos: Array<{ resultado: string }>; compensado: boolean } } })
      .datos.traza;

    expect(traza.pasos.map((p) => p.resultado)).toEqual(['OK', 'OK', 'OK', 'OK']);
    expect(traza.compensado).toBe(false);
  });
});

describe('EjecutarProcesoVenta — comprobante incompatible', () => {
  const incompatible = {
    [`POST /ventas/tickets/${TICKET}/comprobante/verificar`]: {
      estado: 200,
      datos: {
        compatible: false,
        motivo: 'Un cliente con RUC requiere FACTURA, no BOLETA.',
        sugerido: 'FACTURA',
        permitidos: ['FACTURA'],
      },
      error: null,
    },
  };

  it('responde 422 sin haber cobrado', async () => {
    const esb = new EsbSimulado(incompatible);
    const { estado, json } = await ejecutar(esb, { tipoComprobante: 'BOLETA' });

    expect(estado).toBe(422);
    expect(json).toMatchObject({
      exito: false,
      error: { codigo: 'COMPROBANTE_INCOMPATIBLE' },
    });
  });

  it('no llega a cerrar la venta (RF-POS-18)', async () => {
    const esb = new EsbSimulado(incompatible);
    await ejecutar(esb, { tipoComprobante: 'BOLETA' });

    expect(esb.rutasLlamadas()).toEqual([
      `POST /ventas/tickets/${TICKET}/comprobante/verificar`,
    ]);
  });

  it('explica el motivo que dio el servicio, no uno genérico', async () => {
    const esb = new EsbSimulado(incompatible);
    const { json } = await ejecutar(esb, { tipoComprobante: 'BOLETA' });

    expect((json as never as { error: { mensaje: string } }).error.mensaje).toContain(
      'requiere FACTURA',
    );
  });
});

describe('EjecutarProcesoVenta — sin conexión con SUNAT', () => {
  const sinConexion = {
    [`POST /comprobantes/${COMPROBANTE}/envio`]: {
      estado: 200,
      datos: {
        comprobante: { estadoTributario: 'PENDIENTE_ENVIO' },
        reintentable: true,
        error: 'timeout hacia SUNAT',
      },
      error: null,
    },
  };

  it('responde 202: la venta es válida, el envío queda en cola (RNF-01)', async () => {
    const esb = new EsbSimulado(sinConexion);
    const { estado, json } = await ejecutar(esb);

    expect(estado).toBe(202);
    expect(json).toMatchObject({
      exito: true,
      datos: { codigo: 'COMPROBANTE_PENDIENTE_DE_ENVIO', compensado: false },
    });
  });

  it('NO revierte la venta: un corte de red no deshace un cobro', async () => {
    const esb = new EsbSimulado(sinConexion);
    await ejecutar(esb);

    expect(esb.rutasLlamadas()).not.toContain(
      `POST /ventas/tickets/${TICKET}/reversion`,
    );
  });

  it('trata un 5xx del bus como reintentable, no como rechazo', async () => {
    const esb = new EsbSimulado({
      [`POST /comprobantes/${COMPROBANTE}/envio`]: {
        estado: 503,
        datos: null,
        error: { codigo: 'DESTINO_INALCANZABLE', mensaje: 'E-Invoicing no responde.' },
      },
    });

    const { estado } = await ejecutar(esb);

    expect(estado).toBe(202);
    expect(esb.rutasLlamadas()).not.toContain(
      `POST /ventas/tickets/${TICKET}/reversion`,
    );
  });
});

describe('EjecutarProcesoVenta — SUNAT rechaza de forma definitiva', () => {
  const rechazo = {
    [`POST /comprobantes/${COMPROBANTE}/envio`]: {
      estado: 200,
      datos: {
        comprobante: { estadoTributario: 'RECHAZADO' },
        respuestaSunat: { codigo: '2335', descripcion: 'El dato ingresado no cumple con el estandar' },
        reintentable: false,
      },
      error: null,
    },
  };

  it('responde 409 VENTA_REVERTIDA', async () => {
    const esb = new EsbSimulado(rechazo);
    const { estado, json } = await ejecutar(esb);

    expect(estado).toBe(409);
    expect(json).toMatchObject({
      exito: false,
      error: { codigo: 'VENTA_REVERTIDA' },
    });
  });

  it('ejecuta la compensación contra Sales & Customer', async () => {
    const esb = new EsbSimulado(rechazo);
    await ejecutar(esb);

    expect(esb.rutasLlamadas()).toContain(`POST /ventas/tickets/${TICKET}/reversion`);
  });

  it('la reversión lleva el motivo de SUNAT y el código de autorización', async () => {
    const esb = new EsbSimulado(rechazo);
    await ejecutar(esb);

    const reversion = esb.llamadas.find((l) => l.ruta.endsWith('/reversion'));
    expect(reversion?.cuerpo).toMatchObject({ codigoAutorizacion: 'sup:1234' });
    expect((reversion?.cuerpo as { motivo: string }).motivo).toContain('estandar');
  });

  it('no decide el tipo de reversión: eso lo resuelve el estado tributario (ADR-002)', async () => {
    const esb = new EsbSimulado(rechazo);
    await ejecutar(esb);

    const reversion = esb.llamadas.find((l) => l.ruta.endsWith('/reversion'));
    expect(reversion?.cuerpo).not.toHaveProperty('tipoReversion');
  });

  it('marca el cierre como COMPENSADO en la traza', async () => {
    const esb = new EsbSimulado(rechazo);
    const { json } = await ejecutar(esb);

    const traza = (json as never as {
      error: { detalles: { traza: { pasos: Array<{ actividad: string; resultado: string }> } } };
    }).error.detalles.traza;

    expect(traza.pasos.find((p) => p.actividad === 'CerrarVenta')?.resultado).toBe(
      'COMPENSADO',
    );
  });
});

describe('EjecutarProcesoVenta — el proceso se interrumpe', () => {
  it('devuelve 502 y la traza hasta donde llegó cuando un servicio falla', async () => {
    const esb = new EsbSimulado({
      'POST /comprobantes': {
        estado: 500,
        datos: null,
        error: { codigo: 'ERROR_INTERNO', mensaje: 'E-Invoicing reventó.' },
      },
    });

    const { estado, json } = await ejecutar(esb);

    expect(estado).toBe(502);
    expect(json).toMatchObject({
      exito: false,
      error: { codigo: 'PROCESO_INTERRUMPIDO' },
    });
  });

  it('el ticket referencia un cliente inexistente: no inventa razón social', async () => {
    const esb = new EsbSimulado({
      [`GET /clientes/${CLIENTE}`]: {
        estado: 404,
        datos: null,
        error: { codigo: 'CLIENTE_NO_ENCONTRADO', mensaje: 'No existe.' },
      },
    });

    const { estado, json } = await ejecutar(esb);

    expect(estado).toBe(502);
    expect(JSON.stringify(json)).toContain('CLIENTE_DEL_TICKET_NO_EXISTE');
  });
});

describe('EjecutarProcesoVenta — ticket sin cliente', () => {
  it('emite a nombre genérico en vez de fallar', async () => {
    const porDefecto = respuestasPorDefecto();
    const cierre = porDefecto[`POST /ventas/tickets/${TICKET}/cierre`] as {
      datos: { ticket: Record<string, unknown> };
    };

    const esb = new EsbSimulado({
      [`POST /ventas/tickets/${TICKET}/cierre`]: {
        estado: 200,
        datos: {
          ...(cierre.datos as object),
          ticket: { ...cierre.datos.ticket, clienteUuid: undefined },
        },
        error: null,
      },
    });

    const { estado } = await ejecutar(esb, { tipoComprobante: 'NOTA_VENTA' });

    expect(estado).toBe(200);
    expect(esb.rutasLlamadas()).not.toContain(`GET /clientes/${CLIENTE}`);

    const registro = esb.llamadas.find((l) => l.ruta === '/comprobantes');
    expect(registro?.cuerpo).toMatchObject({
      cliente: { tipoDocumento: 'GENERICO', razonSocial: 'Cliente de mostrador' },
    });
  });
});

describe('Validación de la petición', () => {
  it('acepta todas las formas de pago del dominio, sin inventar las suyas', async () => {
    for (const formaPago of [
      'EFECTIVO',
      'TARJETA_DEBITO',
      'TARJETA_CREDITO',
      'YAPE',
      'PLIN',
      'TRANSFERENCIA',
      'PUNTOS',
    ]) {
      const app = await montar(new EsbSimulado());
      const r = await app.inject({
        method: 'POST',
        url: '/procesos/venta',
        payload: { ...PETICION_BASE, pagos: [{ formaPago, monto: 120 }] },
      });

      expect(r.statusCode, `forma de pago ${formaPago}`).not.toBe(400);
    }
  });

  it('exige un código de autorización: sin él no se podría compensar', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({
      method: 'POST',
      url: '/procesos/venta',
      payload: { ...PETICION_BASE, codigoAutorizacion: undefined },
    });

    expect(r.statusCode).toBe(400);
  });

  it('exige al menos un pago', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({
      method: 'POST',
      url: '/procesos/venta',
      payload: { ...PETICION_BASE, pagos: [] },
    });

    expect(r.statusCode).toBe(400);
  });

  it('rechaza una nota de crédito: no es una venta', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({
      method: 'POST',
      url: '/procesos/venta',
      payload: { ...PETICION_BASE, tipoComprobante: 'NOTA_CREDITO' },
    });

    expect(r.statusCode).toBe(400);
  });
});

describe('ConsultarDefinicionProceso', () => {
  it('publica el modelo BPMN que va a ejecutar (P7 — descubribilidad)', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({ method: 'GET', url: '/procesos/venta/definicion' });

    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/xml');
    expect(r.body).toContain('<bpmn:process id="ProcesoVenta"');
  });
});
