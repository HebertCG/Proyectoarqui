/**
 * Las actividades del modelo `proceso-venta.bpmn`.
 *
 * Cada clave corresponde **exactamente** al id de una `serviceTask` del
 * diagrama. Si alguien añade una tarea al modelo y no la registra aquí, el
 * proceso falla al llegar a ella — que es lo correcto: un proceso a medio
 * cablear no debe cobrarle a nadie.
 *
 * Toda salida sale por el ESB (CLAUDE.md §9.1 regla 8).
 */
import type { Actividad, ContextoActividad } from '@pos/orquestacion';
import { errorReglaNegocio, exigirExito, type Esb } from '@pos/service-kit';
import {
  construirDocumentoFiscal,
  CLIENTE_MOSTRADOR,
  type ClienteFiscal,
  type ComprobanteEmitido,
  type Ticket,
} from './mapeo.js';

export type TipoComprobante = ComprobanteEmitido['tipoComprobante'];

export interface Pago {
  formaPago: string;
  monto: number;
  montoRecibido?: number | undefined;
  referencia?: string | undefined;
}

/** Lo que hay que saber para arrancar el proceso. */
export interface EntradaProceso {
  ticketUuid: string;
  tipoComprobante: TipoComprobante;
  pagos: Pago[];
  /** Autoriza la reversión si hay que compensar. Exigido por ADR-001. */
  codigoAutorizacion: string;
}

/** Lee del estado del proceso exigiendo que el paso previo lo haya dejado. */
function exigirVariable<T>(ctx: ContextoActividad, nombre: string): T {
  const valor = ctx.variables[nombre];
  if (valor === undefined || valor === null) {
    throw new Error(
      `El proceso llegó a este paso sin "${nombre}". Revisa el orden del modelo BPMN.`,
    );
  }
  return valor as T;
}

export function construirActividades(esb: Esb): Record<string, Actividad> {
  return {
    /**
     * RF-POS-18. Solo lee: si el comprobante no corresponde al documento del
     * cliente, el proceso corta ANTES de cobrar.
     */
    VerificarComprobante: async (ctx) => {
      const ticketUuid = exigirVariable<string>(ctx, 'ticketUuid');
      const tipoComprobante = exigirVariable<TipoComprobante>(ctx, 'tipoComprobante');

      const respuesta = await esb.llamar<{
        compatible: boolean;
        motivo?: string;
        sugerido?: TipoComprobante;
        permitidos: TipoComprobante[];
      }>({
        metodo: 'POST',
        ruta: `/ventas/tickets/${ticketUuid}/comprobante/verificar`,
        correlationId: ctx.correlationId,
        cuerpo: { tipoComprobante },
      });

      const resultado = exigirExito(respuesta, 'Al verificar el comprobante');

      return {
        compatible: resultado.compatible,
        motivoIncompatibilidad: resultado.motivo ?? null,
        comprobanteSugerido: resultado.sugerido ?? null,
      };
    },

    /**
     * Punto de no retorno: cobra, cierra el ticket y emite el correlativo
     * local. Es el único paso de este proceso que hay que saber deshacer.
     */
    CerrarVenta: async (ctx) => {
      const ticketUuid = exigirVariable<string>(ctx, 'ticketUuid');
      const tipoComprobante = exigirVariable<TipoComprobante>(ctx, 'tipoComprobante');
      const pagos = exigirVariable<Pago[]>(ctx, 'pagos');

      const respuesta = await esb.llamar<{
        ticket: Ticket & { clienteUuid?: string };
        comprobante: ComprobanteEmitido;
        vuelto: number;
      }>({
        metodo: 'POST',
        ruta: `/ventas/tickets/${ticketUuid}/cierre`,
        correlationId: ctx.correlationId,
        cuerpo: { tipoComprobante, pagos },
        // El uuid del ticket: es UUIDv4 —lo que el servicio exige— y es estable
        // entre reintentos, que es justo lo que hace falta. El correlationId no
        // sirve: lo pone el llamante y puede ser cualquier cadena.
        claveIdempotencia: ticketUuid,
      });

      const { ticket, comprobante, vuelto } = exigirExito(respuesta, 'Al cerrar la venta');

      return {
        ticket,
        comprobante,
        comprobanteUuid: comprobante.uuid,
        documento: `${comprobante.serie}-${comprobante.correlativo}`,
        clienteUuid: ticket.clienteUuid ?? null,
        vuelto,
      };
    },

    /**
     * Entrega el documento tributario a `E-Invoicing Service`. Resuelve antes
     * la ficha del cliente: el ticket guarda un uuid, pero SUNAT necesita
     * documento y razón social.
     */
    RegistrarComprobante: async (ctx) => {
      const ticket = exigirVariable<Ticket>(ctx, 'ticket');
      const comprobante = exigirVariable<ComprobanteEmitido>(ctx, 'comprobante');
      const clienteUuid = ctx.variables['clienteUuid'] as string | null;

      const cliente = await resolverCliente(esb, ctx, clienteUuid);
      const documento = construirDocumentoFiscal(ticket, comprobante, cliente);

      const respuesta = await esb.llamar<{ duplicado: boolean }>({
        metodo: 'POST',
        ruta: '/comprobantes',
        correlationId: ctx.correlationId,
        cuerpo: documento,
        claveIdempotencia: comprobante.uuid,
      });

      const resultado = exigirExito(respuesta, 'Al registrar el comprobante');

      return { registrado: true, duplicado: resultado.duplicado === true };
    },

    /**
     * La llamada externa. Aquí el ESB media REST/JSON → SOAP/XML hacia SUNAT.
     *
     * **No lanza cuando SUNAT rechaza**: un rechazo es un resultado del
     * negocio, no un fallo técnico, y el modelo BPMN tiene una rama para él.
     */
    EnviarASunat: async (ctx) => {
      const comprobanteUuid = exigirVariable<string>(ctx, 'comprobanteUuid');

      const respuesta = await esb.llamar<{
        comprobante: { estadoTributario: string };
        respuestaSunat?: { codigo: string; descripcion: string };
        reintentable?: boolean;
        error?: string;
      }>({
        metodo: 'POST',
        ruta: `/comprobantes/${comprobanteUuid}/envio`,
        correlationId: ctx.correlationId,
      });

      // Un 5xx del bus o de E-Invoicing sí es técnico, y es reintentable:
      // el comprobante sigue en cola. No se compensa por eso.
      if (respuesta.estado >= 500 || respuesta.datos === null) {
        return {
          aceptado: false,
          reintentable: true,
          estadoTributario: 'PENDIENTE_ENVIO',
          motivoSunat: respuesta.error?.mensaje ?? `Estado HTTP ${respuesta.estado}.`,
        };
      }

      const resultado = respuesta.datos;
      const estado = resultado.comprobante.estadoTributario;

      return {
        aceptado: estado === 'ACEPTADO',
        reintentable: resultado.reintentable === true,
        estadoTributario: estado,
        codigoSunat: resultado.respuestaSunat?.codigo ?? null,
        motivoSunat: resultado.respuestaSunat?.descripcion ?? resultado.error ?? null,
      };
    },

    /**
     * Compensación de `CerrarVenta` (sesión 29).
     *
     * No decide si emite anulación o nota de crédito: eso lo resuelve
     * `Sales & Customer Service` según el estado tributario (ADR-002). El
     * orquestador solo declara la intención de revertir.
     */
    RevertirVenta: async (ctx) => {
      const ticketUuid = exigirVariable<string>(ctx, 'ticketUuid');
      const codigoAutorizacion = exigirVariable<string>(ctx, 'codigoAutorizacion');
      const motivoSunat = (ctx.variables['motivoSunat'] as string | null) ?? 'sin detalle';

      const respuesta = await esb.llamar<{ reversion?: { tipo: string } }>({
        metodo: 'POST',
        ruta: `/ventas/tickets/${ticketUuid}/reversion`,
        correlationId: ctx.correlationId,
        cuerpo: {
          motivo: `SUNAT rechazó el comprobante de forma definitiva: ${motivoSunat}`,
          codigoAutorizacion,
        },
        // Misma clave que el cierre, y no colisionan: el almacén las acota por
        // operación (`claveDeOperacion` en service-kit).
        claveIdempotencia: ticketUuid,
      });

      const resultado = exigirExito(respuesta, 'Al revertir la venta');

      return { revertido: true, tipoReversion: resultado.reversion?.tipo ?? null };
    },
  };
}

/**
 * Un ticket sin cliente es una venta de mostrador legítima, no un error: se
 * emite nota de venta a nombre genérico.
 */
async function resolverCliente(
  esb: Esb,
  ctx: ContextoActividad,
  clienteUuid: string | null,
): Promise<ClienteFiscal> {
  if (!clienteUuid) return CLIENTE_MOSTRADOR;

  const respuesta = await esb.llamar<{
    tipoDocumento: ClienteFiscal['tipoDocumento'];
    numeroDocumento?: string;
    razonSocial: string;
  }>({
    metodo: 'GET',
    ruta: `/clientes/${clienteUuid}`,
    correlationId: ctx.correlationId,
  });

  // El ticket referencia un cliente que ya no existe: no se puede inventar una
  // razón social para un documento tributario.
  if (respuesta.estado === 404) {
    throw errorReglaNegocio(
      'CLIENTE_DEL_TICKET_NO_EXISTE',
      `El ticket referencia al cliente ${clienteUuid}, que no está registrado.`,
    );
  }

  const cliente = exigirExito(respuesta, 'Al resolver el cliente del ticket');

  return {
    tipoDocumento: cliente.tipoDocumento,
    numeroDocumento: cliente.numeroDocumento,
    razonSocial: cliente.razonSocial,
  };
}
