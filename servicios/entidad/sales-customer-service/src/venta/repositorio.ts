/**
 * Sub-dominio **Venta / POS** — contrato de persistencia.
 *
 * Cubre RF-POS-01..19.
 *
 * RF-POS-09 y RNF-10: el ticket se persiste de forma INCREMENTAL, no solo al
 * cerrar. Cada modificacion se guarda, de modo que un corte de energia no pierde
 * el trabajo en curso. Por eso `guardar` se llama en cada cambio, no al final.
 */
import type { PasoDescuento } from './reglas/cascada-precios.js';
import type { ComprobanteEmitido, TipoComprobante } from './comprobantes.js';

export type EstadoTicket =
  | 'EN_CURSO'
  | 'SUSPENDIDO'
  | 'CERRADO'
  | 'ANULADO'
  | 'DEVUELTO_PARCIAL'
  | 'DEVUELTO_TOTAL';

export type FormaPago =
  | 'EFECTIVO'
  | 'TARJETA_DEBITO'
  | 'TARJETA_CREDITO'
  | 'YAPE'
  | 'PLIN'
  | 'TRANSFERENCIA'
  | 'PUNTOS';

export interface LineaTicket {
  uuid: string;
  sku: string;
  descripcion: string;
  cantidad: number;
  precioLista: number;
  descuentos: PasoDescuento[];
  precioFinal: number;
  importe: number;
  /** Presente si la linea es un SERVICIO agendado. */
  reservaUuid?: string | undefined;
}

export interface Pago {
  formaPago: FormaPago;
  monto: number;
  /** Solo en efectivo (RF-POS-07). */
  montoRecibido?: number | undefined;
  vuelto?: number | undefined;
  /** Referencia de Payment Gateway en cobros digitales. */
  referencia?: string | undefined;
}

export interface Reversion {
  uuid: string;
  motivo: string;
  autorizadoPor: string;
  registradoEn: Date;
  /** Vacio = devolucion total. */
  lineasDevueltas: string[];
  /** Presente si el comprobante ya estaba ACEPTADO (ADR-002). */
  notaCreditoUuid?: string | undefined;
}

export interface Ticket {
  uuid: string;
  estado: EstadoTicket;
  /** RF-CAJA-02: sin turno abierto no hay venta. */
  turnoCajaUuid: string;
  cajaId: string;
  /** RF-POS-05: la venta sin cliente es valida. */
  clienteUuid?: string | undefined;
  tipoComprobante: TipoComprobante;
  comprobante?: ComprobanteEmitido | undefined;
  lineas: LineaTicket[];
  pagos: Pago[];
  subtotal: number;
  descuentoTotal: number;
  igv: number;
  total: number;
  reversion?: Reversion | undefined;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface RepositorioVenta {
  porUuid(uuid: string): Promise<Ticket | null>;

  /**
   * Guarda el estado completo del ticket. Se llama en CADA modificacion, no solo
   * al cerrar: es lo que permite recuperarlo tras un cierre inesperado (RNF-10).
   */
  guardar(ticket: Ticket): Promise<void>;

  /** Tickets sin terminar de una caja, para ofrecer recuperacion al reabrir. */
  enCurso(cajaId: string): Promise<Ticket[]>;
}
