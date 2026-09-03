/**
 * Traducción entre lo que devuelve `Sales & Customer Service` y lo que espera
 * `E-Invoicing Service`.
 *
 * Que haga falta traducir **no es un defecto**: es la prueba de que los dos
 * servicios están desacoplados (P2). Sales habla de tickets y líneas de venta;
 * E-Invoicing habla de documentos tributarios. Cada uno con su modelo.
 *
 * Es una función pura a propósito: es la pieza con más reglas de cálculo del
 * servicio, y así se prueba sin levantar nada.
 */

/** IGV peruano vigente. El precio de catálogo ya lo incluye: se desagrega. */
const TASA_IGV = 0.18;

export type TipoDocumento = 'DNI' | 'RUC' | 'GENERICO';

export interface LineaTicket {
  sku: string;
  descripcion: string;
  cantidad: number;
  precioFinal: number;
  importe: number;
}

export interface Ticket {
  uuid: string;
  lineas: LineaTicket[];
  total: number;
}

export interface ComprobanteEmitido {
  uuid: string;
  tipoComprobante: 'BOLETA' | 'FACTURA' | 'NOTA_VENTA' | 'NOTA_CREDITO';
  serie: string;
  correlativo: number;
  fechaEmision: string;
  total: number;
}

export interface ClienteFiscal {
  tipoDocumento: TipoDocumento;
  numeroDocumento?: string | undefined;
  razonSocial: string;
}

export interface DocumentoFiscal {
  uuid: string;
  tipoComprobante: ComprobanteEmitido['tipoComprobante'];
  serie: string;
  correlativo: number;
  fechaEmision: string;
  cliente: ClienteFiscal;
  lineas: Array<{
    sku: string;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    importe: number;
  }>;
  totalGravado: number;
  totalIgv: number;
  total: number;
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Cliente por defecto cuando el ticket no identifica a nadie. */
export const CLIENTE_MOSTRADOR: ClienteFiscal = {
  tipoDocumento: 'GENERICO',
  razonSocial: 'Cliente de mostrador',
};

export function construirDocumentoFiscal(
  ticket: Ticket,
  comprobante: ComprobanteEmitido,
  cliente: ClienteFiscal,
): DocumentoFiscal {
  // El total es el del comprobante, no una suma recalculada: quien cobró fue
  // Sales & Customer, y ese importe ya es el que el cliente pagó. Recalcularlo
  // aquí abriría la puerta a que el documento tributario y el ticket difieran.
  const totalGravado = redondear(comprobante.total / (1 + TASA_IGV));

  return {
    uuid: comprobante.uuid,
    tipoComprobante: comprobante.tipoComprobante,
    serie: comprobante.serie,
    correlativo: comprobante.correlativo,
    fechaEmision: comprobante.fechaEmision,
    cliente,
    lineas: ticket.lineas.map((linea) => ({
      sku: linea.sku,
      descripcion: linea.descripcion,
      cantidad: linea.cantidad,
      precioUnitario: linea.precioFinal,
      importe: linea.importe,
    })),
    totalGravado,
    totalIgv: redondear(comprobante.total - totalGravado),
    total: comprobante.total,
  };
}
