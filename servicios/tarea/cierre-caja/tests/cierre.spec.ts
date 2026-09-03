/**
 * `CierreCaja.Task` con el ESB simulado.
 *
 * El punto delicado del proceso es el drenaje de comprobantes: tiene que ser
 * best-effort. Si un problema de red pudiera bloquear el cierre del día, el
 * negocio no podría cerrar la caja estando sin conexión — justo lo contrario
 * del diseño local-first.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  crearServicio,
  cargarConfig,
  AuditoriaConsola,
  type Esb,
  type Peticion,
  type RespuestaEsb,
} from '@pos/service-kit';

import { registrarRutas } from '../src/rutas.js';

const TURNO = '2f6829de-3374-477a-be88-54c5a11bbe8d';
const PENDIENTE = '33333333-3333-4333-8333-333333333333';

const PETICION_BASE = {
  cajaId: 'CAJA-01',
  modo: 'CIEGO' as const,
  montoContado: 320,
  codigoAutorizacion: 'sup:1234',
};

function respuestasPorDefecto(): Record<string, RespuestaEsb<unknown>> {
  return {
    'GET /caja/turnos/actual?cajaId=CAJA-01': {
      estado: 200,
      datos: { uuid: TURNO, estado: 'ABIERTO' },
      error: null,
    },
    'GET /comprobantes/pendientes?limite=50': {
      estado: 200,
      datos: [],
      error: null,
    },
    [`POST /caja/turnos/${TURNO}/cierre`]: {
      estado: 200,
      datos: {
        turnoUuid: TURNO,
        modo: 'CIEGO',
        montoEsperado: 320,
        montoContado: 320,
        diferencia: 0,
        desglose: [],
      },
      error: null,
    },
    [`POST /comprobantes/${PENDIENTE}/envio`]: {
      estado: 200,
      datos: { comprobante: { estadoTributario: 'ACEPTADO' } },
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
    if (!respuesta) throw new Error(`El ESB simulado no tiene respuesta para "${clave}".`);
    return respuesta as RespuestaEsb<T>;
  }

  rutasLlamadas(): string[] {
    return this.llamadas.map((l) => `${l.metodo} ${l.ruta}`);
  }
}

async function montar(esb: Esb): Promise<FastifyInstance> {
  const app = await crearServicio({
    config: cargarConfig({
      nombre: 'CierreCaja.Task',
      puertoPorDefecto: 3023,
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
): Promise<{ estado: number; datos: Record<string, never> }> {
  const app = await montar(esb);
  const r = await app.inject({
    method: 'POST',
    url: '/procesos/cierre-caja',
    payload: { ...PETICION_BASE, ...cuerpo },
  });
  return { estado: r.statusCode, datos: r.json().datos };
}

describe('CierreCaja — la caja cuadra', () => {
  it('responde 200 y CAJA_CUADRADA', async () => {
    const { estado, datos } = await ejecutar(new EsbSimulado());

    expect(estado).toBe(200);
    expect(datos).toMatchObject({
      codigo: 'CAJA_CUADRADA',
      desenlace: 'FinCuadrado',
      cuadrado: true,
      diferencia: 0,
    });
  });

  it('recorre los tres pasos del modelo, en orden', async () => {
    const esb = new EsbSimulado();
    await ejecutar(esb);

    expect(esb.rutasLlamadas()).toEqual([
      'GET /caja/turnos/actual?cajaId=CAJA-01',
      'GET /comprobantes/pendientes?limite=50',
      `POST /caja/turnos/${TURNO}/cierre`,
    ]);
  });

  it('cierra con el uuid del turno como clave de idempotencia', async () => {
    const esb = new EsbSimulado();
    await ejecutar(esb);

    const cierre = esb.llamadas.find((l) => l.ruta.endsWith('/cierre'));
    expect(cierre?.claveIdempotencia).toBe(TURNO);
  });

  it('todas las salidas van por el ESB', async () => {
    const esb = new EsbSimulado();
    await ejecutar(esb);

    for (const llamada of esb.llamadas) {
      expect(llamada.ruta.startsWith('/')).toBe(true);
    }
  });
});

describe('CierreCaja — la caja no cuadra', () => {
  const descuadre = {
    [`POST /caja/turnos/${TURNO}/cierre`]: {
      estado: 200,
      datos: {
        turnoUuid: TURNO,
        modo: 'CIEGO',
        montoEsperado: 320,
        montoContado: 305,
        diferencia: -15,
        desglose: [],
      },
      error: null,
    },
  };

  it('devuelve 200: el turno SÍ quedó cerrado', async () => {
    const { estado, datos } = await ejecutar(new EsbSimulado(descuadre));

    // Un error haría creer al terminal que el cierre no ocurrió, y el cajero
    // lo reintentaría sobre un turno ya cerrado.
    expect(estado).toBe(200);
    expect(datos).toMatchObject({
      codigo: 'CAJA_CERRADA_CON_DESCUADRE',
      desenlace: 'FinDescuadre',
      cuadrado: false,
      diferencia: -15,
    });
  });

  it('un sobrante también es descuadre, no solo un faltante', async () => {
    const { datos } = await ejecutar(
      new EsbSimulado({
        [`POST /caja/turnos/${TURNO}/cierre`]: {
          estado: 200,
          datos: { ...descuadre[`POST /caja/turnos/${TURNO}/cierre`]!.datos as object, diferencia: 15 },
          error: null,
        },
      }),
    );

    expect(datos).toMatchObject({ cuadrado: false, diferencia: 15 });
  });

  it('no hay tolerancia: un sol de diferencia ya es descuadre', async () => {
    const { datos } = await ejecutar(
      new EsbSimulado({
        [`POST /caja/turnos/${TURNO}/cierre`]: {
          estado: 200,
          datos: { ...descuadre[`POST /caja/turnos/${TURNO}/cierre`]!.datos as object, diferencia: -1 },
          error: null,
        },
      }),
    );

    expect(datos).toMatchObject({ cuadrado: false });
  });
});

describe('CierreCaja — drenaje de comprobantes pendientes', () => {
  const conPendiente = {
    'GET /comprobantes/pendientes?limite=50': {
      estado: 200,
      datos: [{ uuid: PENDIENTE }],
      error: null,
    },
  };

  it('reintenta los pendientes antes de cerrar', async () => {
    const esb = new EsbSimulado(conPendiente);
    const { datos } = await ejecutar(esb);

    expect(esb.rutasLlamadas()).toContain(`POST /comprobantes/${PENDIENTE}/envio`);
    expect(datos).toMatchObject({ reenviadosAlCerrar: 1, comprobantesPendientes: 0 });
  });

  it('informa cuántos quedaron sin enviar cuando SUNAT no los acepta', async () => {
    const { datos } = await ejecutar(
      new EsbSimulado({
        ...conPendiente,
        [`POST /comprobantes/${PENDIENTE}/envio`]: {
          estado: 200,
          datos: { comprobante: { estadoTributario: 'PENDIENTE_ENVIO' } },
          error: null,
        },
      }),
    );

    expect(datos).toMatchObject({ reenviadosAlCerrar: 0, comprobantesPendientes: 1 });
  });

  it('cierra igual si no se puede ni consultar la cola (RNF-01)', async () => {
    const { estado, datos } = await ejecutar(
      new EsbSimulado({
        'GET /comprobantes/pendientes?limite=50': {
          estado: 502,
          datos: null,
          error: { codigo: 'DESTINO_INALCANZABLE', mensaje: 'E-Invoicing no responde.' },
        },
      }),
    );

    expect(estado).toBe(200);
    expect(datos).toMatchObject({ codigo: 'CAJA_CUADRADA' });
    // `null`, no cero: no se pudo saber cuántos había. Decir "cero" sería mentir.
    expect(datos.comprobantesPendientes).toBeNull();
  });

  it('un envío que falla no impide cerrar el turno', async () => {
    const { estado } = await ejecutar(
      new EsbSimulado({
        ...conPendiente,
        [`POST /comprobantes/${PENDIENTE}/envio`]: {
          estado: 503,
          datos: null,
          error: { codigo: 'CAIDO', mensaje: 'sin conexión' },
        },
      }),
    );

    expect(estado).toBe(200);
  });
});

describe('CierreCaja — el proceso se interrumpe', () => {
  it('devuelve 502 cuando no hay turno abierto que cerrar', async () => {
    const app = await montar(
      new EsbSimulado({
        'GET /caja/turnos/actual?cajaId=CAJA-01': {
          estado: 404,
          datos: null,
          error: { codigo: 'TURNO_NO_ENCONTRADO', mensaje: 'No hay turno abierto.' },
        },
      }),
    );

    const r = await app.inject({
      method: 'POST',
      url: '/procesos/cierre-caja',
      payload: PETICION_BASE,
    });

    expect(r.statusCode).toBe(502);
    expect(r.json().error.codigo).toBe('PROCESO_INTERRUMPIDO');
    expect(JSON.stringify(r.json())).toContain('TURNO_NO_ENCONTRADO');
  });
});

describe('Validación de la petición', () => {
  it('exige código de autorización de supervisor (ADR-001)', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({
      method: 'POST',
      url: '/procesos/cierre-caja',
      payload: { ...PETICION_BASE, codigoAutorizacion: undefined },
    });

    expect(r.statusCode).toBe(400);
  });

  it('rechaza un modo de arqueo que no existe', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({
      method: 'POST',
      url: '/procesos/cierre-caja',
      payload: { ...PETICION_BASE, modo: 'RAPIDO' },
    });

    expect(r.statusCode).toBe(400);
  });

  it('rechaza un monto contado negativo', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({
      method: 'POST',
      url: '/procesos/cierre-caja',
      payload: { ...PETICION_BASE, montoContado: -10 },
    });

    expect(r.statusCode).toBe(400);
  });
});

describe('ConsultarDefinicionProceso', () => {
  it('publica su modelo BPMN', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({ method: 'GET', url: '/procesos/cierre-caja/definicion' });

    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<bpmn:process id="CierreCaja"');
  });

  it('el modelo NO declara compensación: cerrar un turno no se deshace', async () => {
    const app = await montar(new EsbSimulado());
    const r = await app.inject({ method: 'GET', url: '/procesos/cierre-caja/definicion' });

    expect(r.body).not.toContain('compensateEventDefinition');
  });
});
