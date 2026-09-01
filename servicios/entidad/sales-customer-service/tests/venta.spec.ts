import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';

import { registrarRutasVenta } from '../src/venta/rutas.js';
import { registrarRutasCaja } from '../src/caja/rutas.js';
import { RepositorioVentaMemoria } from '../src/venta/repositorio-memoria.js';
import { RepositorioCajaMemoria } from '../src/caja/repositorio-memoria.js';
import { RepositorioCatalogoMemoria } from '../src/catalogo/repositorio-memoria.js';
import { CATALOGO_SEMILLA } from '../src/datos-semilla.js';
import type { IdentificacionCliente } from '../src/venta/reglas/validacion-comprobante.js';
import type { ComprobanteEmitido } from '../src/venta/comprobantes.js';

let app: FastifyInstance;
let auditoria: AuditoriaConsola;
let ventas: RepositorioVentaMemoria;
let caja: RepositorioCajaMemoria;

/** Clientes de prueba, resueltos por el buscador inyectado. */
const CLIENTES: Record<string, IdentificacionCliente> = {
  'aaaaaaaa-1111-4111-8111-111111111111': {
    tipoDocumento: 'RUC',
    numeroDocumento: '20512345678',
  },
  'bbbbbbbb-2222-4222-8222-222222222222': {
    tipoDocumento: 'DNI',
    numeroDocumento: '45678912',
  },
};

const CON_RUC = 'aaaaaaaa-1111-4111-8111-111111111111';
const CON_DNI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AUTORIZACION = 'sup:supervisor01';

beforeEach(async () => {
  auditoria = new AuditoriaConsola();
  ventas = new RepositorioVentaMemoria();
  caja = new RepositorioCajaMemoria();

  app = await crearServicio({
    config: cargarConfig({
      nombre: 'Sales.Customer.Entity',
      puertoPorDefecto: 3001,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria,
  });

  registrarRutasCaja(app, caja);
  registrarRutasVenta(app, {
    ventas,
    caja,
    catalogo: new RepositorioCatalogoMemoria(CATALOGO_SEMILLA),
    buscarCliente: async (uuid) => CLIENTES[uuid] ?? null,
  });

  await app.ready();
});

// ── Helpers ───────────────────────────────────────────────────────

async function abrirCaja(fondo = 200): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/caja/turnos',
    payload: { cajaId: 'CAJA-01', fondoInicial: fondo, codigoAutorizacion: AUTORIZACION },
  });
  return r.json().datos.uuid;
}

async function crearTicket(turnoUuid: string, clienteUuid?: string) {
  return app.inject({
    method: 'POST',
    url: '/ventas/tickets',
    payload: clienteUuid ? { turnoCajaUuid: turnoUuid, clienteUuid } : { turnoCajaUuid: turnoUuid },
  });
}

const agregarLinea = (ticketUuid: string, sku = 'SH-500ML', cantidad = 1) =>
  app.inject({
    method: 'POST',
    url: `/ventas/tickets/${ticketUuid}/lineas`,
    payload: { sku, cantidad },
  });

const cerrar = (
  ticketUuid: string,
  tipoComprobante: string,
  pagos: Array<Record<string, unknown>>,
) =>
  app.inject({
    method: 'POST',
    url: `/ventas/tickets/${ticketUuid}/cierre`,
    payload: { tipoComprobante, pagos },
  });

// ══════════════════════════════════════════════════════════════════

describe('CrearTicket', () => {
  it('exige un turno de caja abierto (RF-CAJA-02)', async () => {
    const r = await crearTicket('3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17');

    expect(r.statusCode).toBe(409);
    expect(r.json().error.codigo).toBe('TURNO_NO_ABIERTO');
  });

  it('crea el ticket vacío y lo persiste al instante (RF-POS-09)', async () => {
    const turno = await abrirCaja();
    const r = await crearTicket(turno);

    expect(r.statusCode).toBe(201);
    expect(r.json().datos.estado).toBe('EN_CURSO');
    expect(r.json().datos.lineas).toHaveLength(0);
    // Ya está guardado antes de tener una sola línea: es lo que permite
    // recuperarlo tras un corte de energía.
    expect(ventas.tamano).toBe(1);
  });

  it('la venta sin cliente es válida (RF-POS-05)', async () => {
    const turno = await abrirCaja();
    const r = await crearTicket(turno);

    expect(r.statusCode).toBe(201);
    expect(r.json().datos.clienteUuid).toBeUndefined();
  });

  it('no se puede vender con el turno cerrado', async () => {
    const turno = await abrirCaja();
    await app.inject({
      method: 'POST',
      url: `/caja/turnos/${turno}/cierre`,
      payload: { modo: 'CIEGO', montoContado: 200, codigoAutorizacion: AUTORIZACION },
    });

    const r = await crearTicket(turno);
    expect(r.statusCode).toBe(409);
  });
});

describe('AgregarLineaTicket', () => {
  it('agrega el item y recalcula el total', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    const r = await agregarLinea(ticket.uuid, 'SH-500ML', 3);
    const t = r.json().datos;

    expect(r.statusCode).toBe(201);
    expect(t.lineas).toHaveLength(1);
    expect(t.lineas[0].importe).toBe(75);
    expect(t.total).toBe(75);
  });

  it('desagrega el IGV: el precio de catálogo ya lo incluye', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    const t = (await agregarLinea(ticket.uuid, 'SH-500ML', 1)).json().datos;

    // 25 con IGV → 21.19 + 3.81
    expect(t.total).toBe(25);
    expect(t.subtotal).toBe(21.19);
    expect(t.igv).toBe(3.81);
    expect(t.subtotal + t.igv).toBeCloseTo(t.total, 2);
  });

  it('acumula varias líneas', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    await agregarLinea(ticket.uuid, 'SH-500ML', 3);
    const t = (await agregarLinea(ticket.uuid, 'SRV-CORTE', 1)).json().datos;

    expect(t.lineas).toHaveLength(2);
    expect(t.total).toBe(120);
  });

  it('vende un SERVICIO igual que un producto, en el mismo ticket', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    const t = (await agregarLinea(ticket.uuid, 'SRV-CORTE', 1)).json().datos;

    expect(t.lineas[0].sku).toBe('SRV-CORTE');
    expect(t.total).toBe(45);
  });

  it('guarda el desglose de la cascada con la línea (ADR-003)', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    const r = await app.inject({
      method: 'POST',
      url: `/ventas/tickets/${ticket.uuid}/lineas`,
      payload: { sku: 'SH-500ML', cantidad: 1, cupon: 'CUP10' },
    });
    const linea = r.json().datos.lineas[0];

    expect(linea.descuentos).toHaveLength(1);
    expect(linea.descuentos[0].origen).toBe('CUPON');
    expect(linea.descuentos[0].referencia).toBe('CUP10');
    expect(linea.precioFinal).toBe(22.5);
  });

  it('rechaza un item inactivo: no se elimina del histórico pero no se vende', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    const r = await agregarLinea(ticket.uuid, 'AC-DESCONT', 1);

    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe('ITEM_CATALOGO_NO_ENCONTRADO');
  });

  it('no admite líneas en un ticket ya cerrado', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);
    await cerrar(ticket.uuid, 'NOTA_VENTA', [{ formaPago: 'EFECTIVO', monto: 25 }]);

    const r = await agregarLinea(ticket.uuid);

    expect(r.statusCode).toBe(422);
    expect(r.json().error.codigo).toBe('TICKET_NO_MODIFICABLE');
  });
});

describe('VerificarComprobante (RF-POS-17/18/19)', () => {
  const verificar = (ticketUuid: string, tipoComprobante: string) =>
    app.inject({
      method: 'POST',
      url: `/ventas/tickets/${ticketUuid}/comprobante/verificar`,
      payload: { tipoComprobante },
    });

  it('cliente con RUC habilita Factura', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, CON_RUC)).json().datos;

    expect((await verificar(ticket.uuid, 'FACTURA')).json().datos.compatible).toBe(true);
  });

  it('cliente con RUC rechaza Boleta y sugiere Factura', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, CON_RUC)).json().datos;

    const d = (await verificar(ticket.uuid, 'BOLETA')).json().datos;

    expect(d.compatible).toBe(false);
    expect(d.sugerido).toBe('FACTURA');
  });

  it('cliente con DNI habilita Boleta y rechaza Factura', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, CON_DNI)).json().datos;

    expect((await verificar(ticket.uuid, 'BOLETA')).json().datos.compatible).toBe(true);
    expect((await verificar(ticket.uuid, 'FACTURA')).json().datos.compatible).toBe(false);
  });

  it('ticket sin cliente queda restringido a Nota de venta', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    expect((await verificar(ticket.uuid, 'NOTA_VENTA')).json().datos.compatible).toBe(true);
    expect((await verificar(ticket.uuid, 'FACTURA')).json().datos.compatible).toBe(false);
  });

  it('un comprobante incompatible NO es error HTTP: es un veredicto', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, CON_RUC)).json().datos;

    expect((await verificar(ticket.uuid, 'BOLETA')).statusCode).toBe(200);
  });
});

describe('CerrarVenta', () => {
  it('cobra, emite comprobante local y registra el movimiento en caja', async () => {
    const turno = await abrirCaja(200);
    const ticket = (await crearTicket(turno, CON_RUC)).json().datos;
    await agregarLinea(ticket.uuid, 'SH-500ML', 3);

    const r = await cerrar(ticket.uuid, 'FACTURA', [
      { formaPago: 'EFECTIVO', monto: 75, montoRecibido: 100 },
    ]);
    const d = r.json().datos;

    expect(r.statusCode).toBe(200);
    expect(d.ticket.estado).toBe('CERRADO');
    expect(d.comprobante.serie).toBe('F001');
    expect(d.comprobante.correlativo).toBe(1);
    expect(d.comprobante.estadoTributario).toBe('PENDIENTE_ENVIO');
    expect(d.vuelto).toBe(25);

    // El efectivo entró a la caja.
    const actual = await app.inject({
      method: 'GET',
      url: '/caja/turnos/actual?cajaId=CAJA-01',
    });
    expect(actual.json().datos.montoActual).toBe(275);
  });

  it('BLOQUEA el cierre si el comprobante es incompatible (RF-POS-18)', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, CON_RUC)).json().datos;
    await agregarLinea(ticket.uuid);

    const r = await cerrar(ticket.uuid, 'BOLETA', [{ formaPago: 'EFECTIVO', monto: 25 }]);

    expect(r.statusCode).toBe(422);
    expect(r.json().error.codigo).toBe('COMPROBANTE_INCOMPATIBLE');
    expect(r.json().error.detalles.sugerido).toBe('FACTURA');
  });

  it('la NOTA_VENTA no entra al ciclo tributario', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);

    const d = (await cerrar(ticket.uuid, 'NOTA_VENTA', [
      { formaPago: 'EFECTIVO', monto: 25 },
    ])).json().datos;

    expect(d.comprobante.estadoTributario).toBe('NO_APLICA');
  });

  it('acepta varias formas de pago combinadas (RF-POS-06)', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, CON_DNI)).json().datos;
    await agregarLinea(ticket.uuid, 'SH-500ML', 4);

    const r = await cerrar(ticket.uuid, 'BOLETA', [
      { formaPago: 'EFECTIVO', monto: 50 },
      { formaPago: 'YAPE', monto: 50 },
    ]);

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.ticket.pagos).toHaveLength(2);
  });

  it('el vuelto solo aplica al efectivo (RF-POS-07)', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);

    const d = (await cerrar(ticket.uuid, 'NOTA_VENTA', [
      { formaPago: 'TARJETA_CREDITO', monto: 25, montoRecibido: 50 },
    ])).json().datos;

    expect(d.ticket.pagos[0].vuelto).toBeUndefined();
    expect(d.vuelto).toBe(0);
  });

  it('rechaza un pago insuficiente', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid, 'SH-500ML', 3);

    const r = await cerrar(ticket.uuid, 'NOTA_VENTA', [
      { formaPago: 'EFECTIVO', monto: 50 },
    ]);

    expect(r.statusCode).toBe(422);
    expect(r.json().error.codigo).toBe('PAGO_INSUFICIENTE');
  });

  it('rechaza cerrar un ticket vacío', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    const r = await cerrar(ticket.uuid, 'NOTA_VENTA', [
      { formaPago: 'EFECTIVO', monto: 10 },
    ]);

    expect(r.statusCode).toBe(422);
    expect(r.json().error.codigo).toBe('TICKET_VACIO');
  });

  it('los correlativos de una serie avanzan de uno en uno', async () => {
    const turno = await abrirCaja();

    for (const esperado of [1, 2, 3]) {
      const ticket = (await crearTicket(turno, CON_RUC)).json().datos;
      await agregarLinea(ticket.uuid);
      const d = (await cerrar(ticket.uuid, 'FACTURA', [
        { formaPago: 'EFECTIVO', monto: 25 },
      ])).json().datos;

      expect(d.comprobante.correlativo).toBe(esperado);
    }
  });

  it('cada tipo de comprobante lleva su propia serie', async () => {
    const turno = await abrirCaja();

    const t1 = (await crearTicket(turno, CON_RUC)).json().datos;
    await agregarLinea(t1.uuid);
    const factura = (await cerrar(t1.uuid, 'FACTURA', [
      { formaPago: 'EFECTIVO', monto: 25 },
    ])).json().datos.comprobante;

    const t2 = (await crearTicket(turno, CON_DNI)).json().datos;
    await agregarLinea(t2.uuid);
    const boleta = (await cerrar(t2.uuid, 'BOLETA', [
      { formaPago: 'EFECTIVO', monto: 25 },
    ])).json().datos.comprobante;

    expect(factura.serie).toBe('F001');
    expect(boleta.serie).toBe('B001');
    // Series independientes: ambas empiezan en 1.
    expect(factura.correlativo).toBe(1);
    expect(boleta.correlativo).toBe(1);
  });

  it('audita la venta con su comprobante (RNF-11)', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, CON_RUC)).json().datos;
    await agregarLinea(ticket.uuid);
    await cerrar(ticket.uuid, 'FACTURA', [{ formaPago: 'EFECTIVO', monto: 25 }]);

    const entrada = auditoria.entradas.find((e) => e.accion === 'VENTA_REGISTRADA');
    expect(entrada?.detalle?.['comprobante']).toBe('F001-1');
  });
});

describe('RevertirVenta — el ESTADO decide (ADR-002)', () => {
  async function ventaCerrada(tipo = 'NOTA_VENTA', cliente?: string) {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno, cliente)).json().datos;
    await agregarLinea(ticket.uuid, 'SH-500ML', 3);
    const d = (await cerrar(ticket.uuid, tipo, [
      { formaPago: 'EFECTIVO', monto: 75 },
    ])).json().datos;
    return d.ticket.uuid as string;
  }

  const revertir = (uuid: string, lineasDevueltas?: string[]) =>
    app.inject({
      method: 'POST',
      url: `/ventas/tickets/${uuid}/reversion`,
      payload: {
        motivo: 'Error de digitación',
        codigoAutorizacion: AUTORIZACION,
        ...(lineasDevueltas ? { lineasDevueltas } : {}),
      },
    });

  it('PENDIENTE_ENVIO se anula: SUNAT nunca lo recibió', async () => {
    const uuid = await ventaCerrada('FACTURA', CON_RUC);

    const d = (await revertir(uuid)).json().datos;

    expect(d.tipoReversion).toBe('ANULACION');
    expect(d.notaCredito).toBeUndefined();
    expect(d.ticket.estado).toBe('ANULADO');
  });

  it('ACEPTADO exige NOTA DE CRÉDITO: no se puede anular', async () => {
    const uuid = await ventaCerrada('FACTURA', CON_RUC);

    // SUNAT lo aceptó: el comprobante ya existe legalmente.
    const t = await ventas.porUuid(uuid);
    t!.comprobante!.estadoTributario = 'ACEPTADO';
    await ventas.guardar(t!);

    const d = (await revertir(uuid)).json().datos;

    expect(d.tipoReversion).toBe('NOTA_CREDITO');
    expect(d.notaCredito.tipoComprobante).toBe('NOTA_CREDITO');
    expect(d.notaCredito.serie).toBe('N001');
    // Catálogo 09 de SUNAT: 06 = devolución total.
    expect(d.notaCredito.motivoCodigo).toBe('06');
  });

  it('ENVIADO no admite reversión: hay que esperar a SUNAT', async () => {
    const uuid = await ventaCerrada('FACTURA', CON_RUC);

    const t = await ventas.porUuid(uuid);
    t!.comprobante!.estadoTributario = 'ENVIADO';
    await ventas.guardar(t!);

    const r = await revertir(uuid);

    expect(r.statusCode).toBe(409);
    expect(r.json().error.codigo).toBe('REVERSION_NO_PERMITIDA');
    expect(r.json().error.mensaje).toMatch(/respuesta de SUNAT/);
  });

  it('la devolución parcial usa el motivo por ítem del catálogo 09', async () => {
    const uuid = await ventaCerrada('FACTURA', CON_RUC);

    const t = await ventas.porUuid(uuid);
    t!.comprobante!.estadoTributario = 'ACEPTADO';
    await ventas.guardar(t!);

    const d = (await revertir(uuid, [t!.lineas[0]!.uuid])).json().datos;

    expect(d.ticket.estado).toBe('DEVUELTO_PARCIAL');
    expect(d.notaCredito.motivoCodigo).toBe('07');
  });

  it('el llamante NO elige el tipo de reversión', async () => {
    const uuid = await ventaCerrada('FACTURA', CON_RUC);

    // El cuerpo solo lleva motivo y autorización: no hay campo para elegir.
    const r = await app.inject({
      method: 'POST',
      url: `/ventas/tickets/${uuid}/reversion`,
      payload: { motivo: 'x', codigoAutorizacion: AUTORIZACION },
    });

    expect(r.json().datos.tipoReversion).toBe('ANULACION');
  });

  it('no se puede revertir un ticket que no está cerrado', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;

    const r = await revertir(ticket.uuid);

    expect(r.statusCode).toBe(422);
    expect(r.json().error.codigo).toBe('TICKET_NO_CERRADO');
  });

  it('nada se borra: la reversión queda como registro (RNF-08)', async () => {
    const uuid = await ventaCerrada();
    await revertir(uuid);

    const t = await ventas.porUuid(uuid);

    expect(t).not.toBeNull();
    expect(t!.lineas).toHaveLength(1);
    expect(t!.reversion?.motivo).toBe('Error de digitación');
    expect(t!.reversion?.autorizadoPor).toBe('supervisor01');
  });

  it('audita distinguiendo anulación de nota de crédito', async () => {
    const uuid = await ventaCerrada('FACTURA', CON_RUC);
    const t = await ventas.porUuid(uuid);
    t!.comprobante!.estadoTributario = 'ACEPTADO';
    await ventas.guardar(t!);

    await revertir(uuid);

    const entrada = auditoria.entradas.find((e) => e.accion === 'NOTA_CREDITO_EMITIDA');
    expect(entrada?.usuario).toBe('supervisor01');
    expect(entrada?.detalle?.['estadoTributarioPrevio']).toBe('ACEPTADO');
  });
});

describe('ConsultarTicket', () => {
  it('devuelve el ticket con sus líneas', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);

    const r = await app.inject({ method: 'GET', url: `/ventas/tickets/${ticket.uuid}` });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.lineas).toHaveLength(1);
  });

  it('404 con envelope si no existe', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/ventas/tickets/3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17',
    });

    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe('TICKET_NO_ENCONTRADO');
  });
});

describe('persistencia incremental (RF-POS-09, RNF-10)', () => {
  it('el repositorio guarda copias: mutar la referencia no altera lo persistido', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);

    const leido = await ventas.porUuid(ticket.uuid);
    leido!.lineas.push({} as never);

    const releido = await ventas.porUuid(ticket.uuid);
    expect(releido!.lineas).toHaveLength(1);
  });

  it('un ticket en curso se puede recuperar por caja', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);

    const pendientes = await ventas.enCurso('CAJA-01');

    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]?.uuid).toBe(ticket.uuid);
  });

  it('un ticket cerrado ya no figura como recuperable', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);
    await cerrar(ticket.uuid, 'NOTA_VENTA', [{ formaPago: 'EFECTIVO', monto: 25 }]);

    expect(await ventas.enCurso('CAJA-01')).toHaveLength(0);
  });
});

describe('comprobante emitido', () => {
  it('lleva fecha de emisión del día', async () => {
    const turno = await abrirCaja();
    const ticket = (await crearTicket(turno)).json().datos;
    await agregarLinea(ticket.uuid);

    const c: ComprobanteEmitido = (await cerrar(ticket.uuid, 'NOTA_VENTA', [
      { formaPago: 'EFECTIVO', monto: 25 },
    ])).json().datos.comprobante;

    expect(c.fechaEmision).toBe(new Date().toISOString().slice(0, 10));
  });
});
