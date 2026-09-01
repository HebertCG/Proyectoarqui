import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';

import { registrarRutasCaja } from '../src/caja/rutas.js';
import { RepositorioCajaMemoria } from '../src/caja/repositorio-memoria.js';

let app: FastifyInstance;
let auditoria: AuditoriaConsola;
let repositorio: RepositorioCajaMemoria;

const AUTORIZACION = 'sup:supervisor01';

beforeEach(async () => {
  auditoria = new AuditoriaConsola();
  repositorio = new RepositorioCajaMemoria();
  app = await crearServicio({
    config: cargarConfig({
      nombre: 'Sales.Customer.Entity',
      puertoPorDefecto: 3001,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria,
  });
  registrarRutasCaja(app, repositorio);
  await app.ready();
});

const abrir = (fondoInicial = 200, cajaId = 'CAJA-01') =>
  app.inject({
    method: 'POST',
    url: '/caja/turnos',
    payload: { cajaId, fondoInicial, codigoAutorizacion: AUTORIZACION },
  });

const movimiento = (
  turnoUuid: string,
  tipo: 'INGRESO' | 'EGRESO',
  monto: number,
  formaPago = 'EFECTIVO',
  motivo = 'motivo de prueba',
) =>
  app.inject({
    method: 'POST',
    url: `/caja/turnos/${turnoUuid}/movimientos`,
    payload: { tipo, formaPago, monto, motivo },
  });

const cerrar = (turnoUuid: string, montoContado: number, modo = 'CIEGO') =>
  app.inject({
    method: 'POST',
    url: `/caja/turnos/${turnoUuid}/cierre`,
    payload: { modo, montoContado, codigoAutorizacion: AUTORIZACION },
  });

describe('AbrirTurno (RF-CAJA-01)', () => {
  it('abre con fondo inicial y lo deja como primer movimiento', async () => {
    const r = await abrir(200);
    const turno = r.json().datos;

    expect(r.statusCode).toBe(201);
    expect(turno.estado).toBe('ABIERTO');
    expect(turno.fondoInicial).toBe(200);
    expect(turno.movimientos).toHaveLength(1);
    expect(turno.movimientos[0].tipo).toBe('FONDO_INICIAL');
    expect(turno.montoActual).toBe(200);
  });

  it('impide abrir dos turnos en la misma caja', async () => {
    await abrir();
    const segundo = await abrir();

    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().error.codigo).toBe('TURNO_YA_ABIERTO');
  });

  it('permite turnos simultáneos en cajas distintas', async () => {
    await abrir(200, 'CAJA-01');
    const otra = await abrir(150, 'CAJA-02');

    expect(otra.statusCode).toBe(201);
  });

  it('exige autorización de supervisor (RNF-06)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/caja/turnos',
      payload: { cajaId: 'CAJA-01', fondoInicial: 200 },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe('VALIDACION_ESQUEMA');
  });

  it('audita registrando al supervisor que autorizó, no al cajero', async () => {
    await abrir();

    const entrada = auditoria.entradas.find((e) => e.accion === 'CAJA_ABIERTA');
    expect(entrada?.usuario).toBe('supervisor01');
    expect(entrada?.detalle?.['fondoInicial']).toBe(200);
  });

  it('rechaza un fondo inicial negativo', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/caja/turnos',
      payload: { cajaId: 'CAJA-01', fondoInicial: -50, codigoAutorizacion: AUTORIZACION },
    });

    expect(r.statusCode).toBe(400);
  });
});

describe('ConsultarTurnoActual (RF-CAJA-09)', () => {
  it('devuelve el turno abierto con el monto al momento', async () => {
    const turno = (await abrir(200)).json().datos;
    await movimiento(turno.uuid, 'INGRESO', 50);

    const r = await app.inject({
      method: 'GET',
      url: '/caja/turnos/actual?cajaId=CAJA-01',
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.montoActual).toBe(250);
  });

  it('404 cuando la caja no tiene turno abierto', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/caja/turnos/actual?cajaId=CAJA-99',
    });

    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe('TURNO_NO_ABIERTO');
  });
});

describe('RegistrarMovimientoCaja (RF-CAJA-03)', () => {
  it('un ingreso suma al monto', async () => {
    const turno = (await abrir(200)).json().datos;
    await movimiento(turno.uuid, 'INGRESO', 75.5);

    const r = await app.inject({ method: 'GET', url: '/caja/turnos/actual?cajaId=CAJA-01' });
    expect(r.json().datos.montoActual).toBe(275.5);
  });

  it('un egreso resta, aunque se envíe en positivo', async () => {
    const turno = (await abrir(200)).json().datos;
    const r = await movimiento(turno.uuid, 'EGRESO', 30);

    // Se guarda negativo para que el arqueo sume sin condicionales.
    expect(r.json().datos.monto).toBe(-30);

    const actual = await app.inject({
      method: 'GET',
      url: '/caja/turnos/actual?cajaId=CAJA-01',
    });
    expect(actual.json().datos.montoActual).toBe(170);
  });

  it('el motivo es obligatorio', async () => {
    const turno = (await abrir()).json().datos;

    const r = await app.inject({
      method: 'POST',
      url: `/caja/turnos/${turno.uuid}/movimientos`,
      payload: { tipo: 'EGRESO', formaPago: 'EFECTIVO', monto: 30 },
    });

    expect(r.statusCode).toBe(400);
  });

  it('rechaza monto cero', async () => {
    const turno = (await abrir()).json().datos;
    const r = await movimiento(turno.uuid, 'INGRESO', 0);

    expect(r.statusCode).toBe(400);
  });

  it('no se puede mover dinero en un turno cerrado (RNF-08)', async () => {
    const turno = (await abrir(200)).json().datos;
    await cerrar(turno.uuid, 200);

    const r = await movimiento(turno.uuid, 'INGRESO', 50);

    expect(r.statusCode).toBe(422);
    expect(r.json().error.codigo).toBe('TURNO_CERRADO');
    expect(r.json().error.mensaje).toMatch(/append-only/);
  });

  it('404 en un turno inexistente', async () => {
    const r = await movimiento('3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17', 'INGRESO', 10);
    expect(r.statusCode).toBe(404);
  });

  it('audita cada movimiento con su motivo (RNF-11)', async () => {
    const turno = (await abrir()).json().datos;
    await movimiento(turno.uuid, 'EGRESO', 30, 'EFECTIVO', 'Compra de insumos');

    const entrada = auditoria.entradas.find((e) => e.accion === 'CAJA_EGRESO');
    expect(entrada?.detalle?.['motivo']).toBe('Compra de insumos');
  });
});

describe('CerrarTurno — arqueo (RF-CAJA-04/05/06)', () => {
  it('calcula el esperado: fondo + ventas efectivo + ingresos − egresos', async () => {
    const turno = (await abrir(200)).json().datos;
    await movimiento(turno.uuid, 'INGRESO', 100);
    await movimiento(turno.uuid, 'EGRESO', 30);

    const r = await cerrar(turno.uuid, 270);

    expect(r.json().datos.montoEsperado).toBe(270);
    expect(r.json().datos.diferencia).toBe(0);
  });

  it('reporta faltante como diferencia negativa', async () => {
    const turno = (await abrir(200)).json().datos;
    const r = await cerrar(turno.uuid, 185);

    expect(r.json().datos.diferencia).toBe(-15);
  });

  it('reporta sobrante como diferencia positiva', async () => {
    const turno = (await abrir(200)).json().datos;
    const r = await cerrar(turno.uuid, 210);

    expect(r.json().datos.diferencia).toBe(10);
  });

  it('el efectivo del cajón ignora lo cobrado con tarjeta', async () => {
    const turno = (await abrir(200)).json().datos;
    await movimiento(turno.uuid, 'INGRESO', 500, 'TARJETA_CREDITO');

    const r = await cerrar(turno.uuid, 200);

    // Los 500 de tarjeta no están en el cajón.
    expect(r.json().datos.montoEsperado).toBe(200);
    expect(r.json().datos.diferencia).toBe(0);
  });

  it('el desglose incluye todas las formas de pago, no solo efectivo', async () => {
    const turno = (await abrir(200)).json().datos;
    await movimiento(turno.uuid, 'INGRESO', 100, 'EFECTIVO');
    await movimiento(turno.uuid, 'INGRESO', 300, 'YAPE');
    await movimiento(turno.uuid, 'INGRESO', 500, 'TARJETA_CREDITO');

    const desglose = (await cerrar(turno.uuid, 300)).json().datos.desglose;
    const porForma = Object.fromEntries(
      desglose.map((d: { formaPago: string; total: number }) => [d.formaPago, d.total]),
    );

    expect(porForma['TARJETA_CREDITO']).toBe(500);
    expect(porForma['YAPE']).toBe(300);
    expect(porForma['EFECTIVO']).toBe(100);
  });

  it('el desglose excluye el fondo inicial: no es una venta', async () => {
    const turno = (await abrir(200)).json().datos;
    await movimiento(turno.uuid, 'INGRESO', 50, 'EFECTIVO');

    const desglose = (await cerrar(turno.uuid, 250)).json().datos.desglose;
    const efectivo = desglose.find((d: { formaPago: string }) => d.formaPago === 'EFECTIVO');

    expect(efectivo.total).toBe(50);
    expect(efectivo.operaciones).toBe(1);
  });

  it('soporta arqueo ciego y asistido', async () => {
    const t1 = (await abrir(200, 'CAJA-01')).json().datos;
    const t2 = (await abrir(200, 'CAJA-02')).json().datos;

    expect((await cerrar(t1.uuid, 200, 'CIEGO')).json().datos.modo).toBe('CIEGO');
    expect((await cerrar(t2.uuid, 200, 'ASISTIDO')).json().datos.modo).toBe('ASISTIDO');
  });

  it('no se puede cerrar dos veces', async () => {
    const turno = (await abrir(200)).json().datos;
    await cerrar(turno.uuid, 200);

    const segundo = await cerrar(turno.uuid, 200);
    expect(segundo.statusCode).toBe(422);
  });

  it('tras cerrar, la caja admite un turno nuevo', async () => {
    const turno = (await abrir(200)).json().datos;
    await cerrar(turno.uuid, 200);

    expect((await abrir(300)).statusCode).toBe(201);
  });

  it('audita el cierre con la diferencia', async () => {
    const turno = (await abrir(200)).json().datos;
    await cerrar(turno.uuid, 185);

    const entrada = auditoria.entradas.find((e) => e.accion === 'CAJA_CERRADA');
    expect(entrada?.usuario).toBe('supervisor01');
    expect(entrada?.detalle?.['diferencia']).toBe(-15);
  });
});

describe('ConsultarCierres (RF-CAJA-10)', () => {
  it('devuelve el historial de cierres', async () => {
    const t1 = (await abrir(200, 'CAJA-01')).json().datos;
    await cerrar(t1.uuid, 200);
    const t2 = (await abrir(300, 'CAJA-02')).json().datos;
    await cerrar(t2.uuid, 290);

    const r = await app.inject({ method: 'GET', url: '/caja/cierres' });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toHaveLength(2);
    expect(r.json().meta.total).toBe(2);
  });

  it('un turno abierto no aparece en cierres', async () => {
    await abrir();
    const r = await app.inject({ method: 'GET', url: '/caja/cierres' });

    expect(r.json().datos).toHaveLength(0);
  });
});
