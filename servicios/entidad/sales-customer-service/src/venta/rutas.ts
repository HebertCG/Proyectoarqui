/**
 * Rutas del sub-dominio **Venta / POS**.
 *
 * Aquí converge el servicio compuesto: el ticket usa **Caja** (turno abierto),
 * **Catálogo** (items y precios), **Cliente** (lista de precios y documento) y
 * las dos reglas de negocio. Esa convergencia en un mismo flujo es justamente la
 * razón por la que los cuatro sub-dominios viven en un solo servicio
 * (CLAUDE.md §3).
 *
 * Contract-first: cada operación corresponde a un `operationId` de
 * `contratos/openapi/sales-customer-v1.yaml`.
 */
import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  exito,
  errorConflicto,
  errorNoEncontrado,
  errorReglaNegocio,
} from '@pos/service-kit';

import type { RepositorioCatalogo } from '../catalogo/repositorio.js';
import type { RepositorioCaja } from '../caja/repositorio.js';
import { normalizarMonto } from '../caja/calculos.js';
import { aplicarCascada } from './reglas/cascada-precios.js';
import {
  verificarCompatibilidad,
  type IdentificacionCliente,
  type TipoComprobante,
} from './reglas/validacion-comprobante.js';
import {
  CorrelativoPorSerie,
  estadoInicial,
  puedeRevertirse,
  reversionQueCorresponde,
  serieDe,
  MOTIVOS_NOTA_CREDITO,
} from './comprobantes.js';
import type { FormaPago, LineaTicket, Pago, RepositorioVenta, Ticket } from './repositorio.js';

/** IGV peruano vigente. */
const TASA_IGV = 0.18;

const redondear = (v: number): number => Math.round(v * 100) / 100;

const TIPOS_COMPROBANTE = [
  Type.Literal('BOLETA'),
  Type.Literal('FACTURA'),
  Type.Literal('NOTA_VENTA'),
];

const EsquemaCrear = Type.Object({
  turnoCajaUuid: Type.String({ format: 'uuid' }),
  clienteUuid: Type.Optional(Type.String({ format: 'uuid' })),
});

const EsquemaLinea = Type.Object({
  sku: Type.String({ pattern: '^[A-Z0-9][A-Z0-9\\-_]{1,31}$' }),
  cantidad: Type.Integer({ minimum: 1 }),
  cupon: Type.Optional(Type.String({ maxLength: 60 })),
});

const EsquemaCierre = Type.Object({
  tipoComprobante: Type.Union(TIPOS_COMPROBANTE),
  pagos: Type.Array(
    Type.Object({
      formaPago: Type.String({ minLength: 1 }),
      monto: Type.Number({ exclusiveMinimum: 0 }),
      montoRecibido: Type.Optional(Type.Number({ minimum: 0 })),
      referencia: Type.Optional(Type.String({ maxLength: 120 })),
    }),
    { minItems: 1 },
  ),
});

const EsquemaReversion = Type.Object({
  motivo: Type.String({ minLength: 1, maxLength: 1000 }),
  codigoAutorizacion: Type.String({ minLength: 1 }),
  lineasDevueltas: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
});

const EsquemaUuid = Type.Object({ uuid: Type.String({ format: 'uuid' }) });

/**
 * Resuelve la identificación del cliente.
 *
 * Sin cliente asociado la venta es válida (RF-POS-05), pero solo admite nota de
 * venta: no hay a quién emitirle un comprobante fiscal.
 */
export type BuscadorCliente = (uuid: string) => Promise<IdentificacionCliente | null>;

export interface DependenciasVenta {
  ventas: RepositorioVenta;
  catalogo: RepositorioCatalogo;
  caja: RepositorioCaja;
  /** Opcional: sin él, todo ticket se trata como cliente genérico. */
  buscarCliente?: BuscadorCliente | undefined;
  correlativos?: CorrelativoPorSerie | undefined;
}

export function registrarRutasVenta(
  app: FastifyInstance,
  deps: DependenciasVenta,
): void {
  const { ventas, catalogo, caja } = deps;
  const correlativos = deps.correlativos ?? new CorrelativoPorSerie();

  // ── CrearTicket ─────────────────────────────────────────────────
  app.post(
    '/ventas/tickets',
    { schema: { body: EsquemaCrear } },
    async (peticion, respuesta) => {
      const { turnoCajaUuid, clienteUuid } = peticion.body as {
        turnoCajaUuid: string;
        clienteUuid?: string;
      };

      const turno = await caja.porUuid(turnoCajaUuid);

      // RF-CAJA-02: sin caja abierta no se registra ninguna venta.
      if (!turno || turno.estado !== 'ABIERTO') {
        throw errorConflicto(
          'TURNO_NO_ABIERTO',
          'No se puede registrar una venta sin un turno de caja abierto.',
        );
      }

      const ahora = new Date();
      const ticket: Ticket = {
        uuid: randomUUID(),
        estado: 'EN_CURSO',
        turnoCajaUuid,
        cajaId: turno.cajaId,
        clienteUuid,
        // Se decide al cerrar, según el documento del cliente.
        tipoComprobante: 'NOTA_VENTA',
        lineas: [],
        pagos: [],
        subtotal: 0,
        descuentoTotal: 0,
        igv: 0,
        total: 0,
        creadoEn: ahora,
        actualizadoEn: ahora,
      };

      // Persistencia inmediata: el ticket existe antes de tener una sola línea,
      // que es lo que permite recuperarlo tras un corte (RF-POS-09, RNF-10).
      await ventas.guardar(ticket);

      return respuesta.code(201).send(exito(ticket, app.meta(peticion)));
    },
  );

  // ── ConsultarTicket ─────────────────────────────────────────────
  app.get(
    '/ventas/tickets/:uuid',
    { schema: { params: EsquemaUuid } },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      return exito(await exigirTicket(ventas, uuid), app.meta(peticion));
    },
  );

  // ── AgregarLineaTicket ──────────────────────────────────────────
  app.post(
    '/ventas/tickets/:uuid/lineas',
    { schema: { params: EsquemaUuid, body: EsquemaLinea } },
    async (peticion, respuesta) => {
      const { uuid } = peticion.params as { uuid: string };
      const { sku, cantidad, cupon } = peticion.body as {
        sku: string;
        cantidad: number;
        cupon?: string;
      };

      const ticket = await exigirTicketEnCurso(ventas, uuid);
      const item = await catalogo.porSku(sku);

      if (!item || !item.activo) {
        throw errorNoEncontrado(
          'ITEM_CATALOGO_NO_ENCONTRADO',
          `No hay un item activo con SKU ${sku}.`,
        );
      }

      // Cascada de precios (ADR-003). El desglose se guarda con la línea.
      const calculo = aplicarCascada({
        precioBase: item.precioBase,
        cantidad,
        ...(cupon ? { cupon: { codigo: cupon, porcentaje: 10, acumulable: true } } : {}),
      });

      const linea: LineaTicket = {
        uuid: randomUUID(),
        sku: item.sku,
        descripcion: item.nombre,
        cantidad,
        precioLista: calculo.precioLista,
        descuentos: calculo.pasos,
        precioFinal: calculo.precioFinal,
        importe: calculo.importe,
      };

      ticket.lineas.push(linea);
      recalcular(ticket);
      await ventas.guardar(ticket);

      return respuesta.code(201).send(exito(ticket, app.meta(peticion)));
    },
  );

  // ── VerificarComprobante ────────────────────────────────────────
  app.post(
    '/ventas/tickets/:uuid/comprobante/verificar',
    {
      schema: {
        params: EsquemaUuid,
        body: Type.Object({ tipoComprobante: Type.Union(TIPOS_COMPROBANTE) }),
      },
    },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      const { tipoComprobante } = peticion.body as { tipoComprobante: TipoComprobante };

      const ticket = await exigirTicket(ventas, uuid);
      const cliente = await resolverCliente(deps, ticket);

      return exito(verificarCompatibilidad(cliente, tipoComprobante), app.meta(peticion));
    },
  );

  // ── CerrarVenta ─────────────────────────────────────────────────
  app.post(
    '/ventas/tickets/:uuid/cierre',
    { schema: { params: EsquemaUuid, body: EsquemaCierre } },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      const cuerpo = peticion.body as {
        tipoComprobante: TipoComprobante;
        pagos: Array<{
          formaPago: FormaPago;
          monto: number;
          montoRecibido?: number;
          referencia?: string;
        }>;
      };

      const ticket = await exigirTicketEnCurso(ventas, uuid);

      if (ticket.lineas.length === 0) {
        throw errorReglaNegocio(
          'TICKET_VACIO',
          'No se puede cerrar un ticket sin líneas.',
        );
      }

      // RF-POS-18: bloquea el cierre si el comprobante es incompatible. Emitir
      // de todos modos produciría algo que SUNAT rechazaría.
      const cliente = await resolverCliente(deps, ticket);
      const compatibilidad = verificarCompatibilidad(cliente, cuerpo.tipoComprobante);

      if (!compatibilidad.compatible) {
        throw errorReglaNegocio(
          'COMPROBANTE_INCOMPATIBLE',
          compatibilidad.motivo ?? 'El comprobante no corresponde al documento del cliente.',
          {
            tipoDocumento: cliente.tipoDocumento,
            solicitado: cuerpo.tipoComprobante,
            sugerido: compatibilidad.sugerido,
            permitidos: compatibilidad.permitidos,
          },
        );
      }

      const totalPagado = redondear(
        cuerpo.pagos.reduce((suma, p) => suma + p.monto, 0),
      );

      if (totalPagado < ticket.total) {
        throw errorReglaNegocio(
          'PAGO_INSUFICIENTE',
          `El total del ticket es ${ticket.total} y se recibieron ${totalPagado}.`,
          { total: ticket.total, pagado: totalPagado },
        );
      }

      // RF-POS-07: el vuelto solo aplica al efectivo.
      const pagos: Pago[] = cuerpo.pagos.map((p) => {
        const base: Pago = { formaPago: p.formaPago, monto: p.monto };
        if (p.referencia !== undefined) base.referencia = p.referencia;
        if (p.formaPago !== 'EFECTIVO' || p.montoRecibido === undefined) return base;

        return {
          ...base,
          montoRecibido: p.montoRecibido,
          vuelto: redondear(Math.max(p.montoRecibido - p.monto, 0)),
        };
      });

      // Emisión LOCAL: correlativo propio de la serie de esta caja, sin
      // consultar a nadie. Es lo que permite facturar sin internet.
      const serie = serieDe(ticket.cajaId, cuerpo.tipoComprobante);
      const comprobante = {
        uuid: randomUUID(),
        tipoComprobante: cuerpo.tipoComprobante,
        serie,
        correlativo: correlativos.siguiente(serie),
        fechaEmision: new Date().toISOString().slice(0, 10),
        estadoTributario: estadoInicial(cuerpo.tipoComprobante),
        total: ticket.total,
      };

      ticket.estado = 'CERRADO';
      ticket.tipoComprobante = cuerpo.tipoComprobante;
      ticket.pagos = pagos;
      ticket.comprobante = comprobante;
      ticket.actualizadoEn = new Date();
      await ventas.guardar(ticket);

      // El efectivo cobrado entra a la caja.
      await registrarEnCaja(caja, ticket, pagos);

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: 'VENTA_REGISTRADA',
        recurso: 'ticket',
        recursoId: ticket.uuid,
        usuario: 'cajero',
        timestamp: new Date().toISOString(),
        detalle: {
          total: ticket.total,
          comprobante: `${comprobante.serie}-${comprobante.correlativo}`,
          lineas: ticket.lineas.length,
        },
      });

      const vuelto = redondear(pagos.reduce((s, p) => s + (p.vuelto ?? 0), 0));
      return exito({ ticket, comprobante, vuelto }, app.meta(peticion));
    },
  );

  // ── RevertirVenta ───────────────────────────────────────────────
  app.post(
    '/ventas/tickets/:uuid/reversion',
    { schema: { params: EsquemaUuid, body: EsquemaReversion } },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      const cuerpo = peticion.body as {
        motivo: string;
        codigoAutorizacion: string;
        lineasDevueltas?: string[];
      };

      const ticket = await exigirTicket(ventas, uuid);

      if (ticket.estado !== 'CERRADO') {
        throw errorReglaNegocio(
          'TICKET_NO_CERRADO',
          'Solo se puede revertir una venta cerrada.',
        );
      }

      const estado = ticket.comprobante?.estadoTributario ?? 'NO_APLICA';
      const reversibilidad = puedeRevertirse(estado);

      if (!reversibilidad.permitida) {
        throw errorConflicto(
          'REVERSION_NO_PERMITIDA',
          reversibilidad.motivo ?? 'El comprobante no admite reversión.',
          { estadoTributario: estado },
        );
      }

      // ADR-002: el ESTADO decide, no el llamante.
      const tipoReversion = reversionQueCorresponde(estado);
      const devueltas = cuerpo.lineasDevueltas ?? [];
      const esTotal = devueltas.length === 0;
      const autorizadoPor = cuerpo.codigoAutorizacion.startsWith('sup:')
        ? cuerpo.codigoAutorizacion.slice(4)
        : 'supervisor';

      let notaCredito;
      if (tipoReversion === 'NOTA_CREDITO') {
        const serie = serieDe(ticket.cajaId, 'NOTA_CREDITO');
        notaCredito = {
          uuid: randomUUID(),
          tipoComprobante: 'NOTA_CREDITO' as const,
          serie,
          correlativo: correlativos.siguiente(serie),
          fechaEmision: new Date().toISOString().slice(0, 10),
          estadoTributario: 'PENDIENTE_ENVIO' as const,
          total: esTotal ? ticket.total : totalDe(ticket, devueltas),
          motivoCodigo: esTotal
            ? MOTIVOS_NOTA_CREDITO.DEVOLUCION_TOTAL
            : MOTIVOS_NOTA_CREDITO.DEVOLUCION_POR_ITEM,
        };
      }

      // Nada se borra: la reversión es un registro nuevo (RNF-08).
      ticket.estado = esTotal ? 'DEVUELTO_TOTAL' : 'DEVUELTO_PARCIAL';
      ticket.reversion = {
        uuid: randomUUID(),
        motivo: cuerpo.motivo,
        autorizadoPor,
        registradoEn: new Date(),
        lineasDevueltas: devueltas,
        notaCreditoUuid: notaCredito?.uuid,
      };
      if (tipoReversion === 'ANULACION' && esTotal) ticket.estado = 'ANULADO';
      ticket.actualizadoEn = new Date();

      await ventas.guardar(ticket);

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: tipoReversion === 'NOTA_CREDITO' ? 'NOTA_CREDITO_EMITIDA' : 'VENTA_ANULADA',
        recurso: 'ticket',
        recursoId: ticket.uuid,
        usuario: autorizadoPor,
        timestamp: new Date().toISOString(),
        detalle: {
          motivo: cuerpo.motivo,
          tipoReversion,
          estadoTributarioPrevio: estado,
          total: esTotal ? ticket.total : totalDe(ticket, devueltas),
        },
      });

      return exito({ ticket, tipoReversion, notaCredito }, app.meta(peticion));
    },
  );
}

// ── Auxiliares ────────────────────────────────────────────────────

function recalcular(ticket: Ticket): void {
  const importe = ticket.lineas.reduce((s, l) => s + l.importe, 0);
  const descuento = ticket.lineas.reduce(
    (s, l) => s + (l.precioLista - l.precioFinal) * l.cantidad,
    0,
  );

  ticket.total = redondear(importe);
  ticket.descuentoTotal = redondear(descuento);
  // El precio de catálogo ya incluye IGV: se desagrega, no se suma encima.
  ticket.subtotal = redondear(ticket.total / (1 + TASA_IGV));
  ticket.igv = redondear(ticket.total - ticket.subtotal);
  ticket.actualizadoEn = new Date();
}

function totalDe(ticket: Ticket, lineasUuid: string[]): number {
  return redondear(
    ticket.lineas
      .filter((l) => lineasUuid.includes(l.uuid))
      .reduce((s, l) => s + l.importe, 0),
  );
}

async function resolverCliente(
  deps: DependenciasVenta,
  ticket: Ticket,
): Promise<IdentificacionCliente> {
  if (!ticket.clienteUuid || !deps.buscarCliente) {
    return { tipoDocumento: 'GENERICO' };
  }
  return (await deps.buscarCliente(ticket.clienteUuid)) ?? { tipoDocumento: 'GENERICO' };
}

async function registrarEnCaja(
  caja: RepositorioCaja,
  ticket: Ticket,
  pagos: Pago[],
): Promise<void> {
  for (const pago of pagos) {
    await caja.agregarMovimiento(ticket.turnoCajaUuid, {
      uuid: randomUUID(),
      tipo: 'VENTA',
      formaPago: pago.formaPago,
      monto: normalizarMonto('VENTA', pago.monto),
      ticketUuid: ticket.uuid,
      registradoPor: 'cajero',
      registradoEn: new Date(),
    });
  }
}

async function exigirTicket(ventas: RepositorioVenta, uuid: string): Promise<Ticket> {
  const ticket = await ventas.porUuid(uuid);
  if (!ticket) {
    throw errorNoEncontrado('TICKET_NO_ENCONTRADO', `No existe el ticket ${uuid}.`);
  }
  return ticket;
}

async function exigirTicketEnCurso(
  ventas: RepositorioVenta,
  uuid: string,
): Promise<Ticket> {
  const ticket = await exigirTicket(ventas, uuid);

  if (ticket.estado !== 'EN_CURSO' && ticket.estado !== 'SUSPENDIDO') {
    throw errorReglaNegocio(
      'TICKET_NO_MODIFICABLE',
      `El ticket está en estado ${ticket.estado} y ya no admite cambios.`,
    );
  }

  return ticket;
}
