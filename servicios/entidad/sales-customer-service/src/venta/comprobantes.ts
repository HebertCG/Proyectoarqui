/**
 * Emisión de comprobantes y máquina de estados tributarios.
 *
 * Implementa [ADR-002](../../../../docs/adr/002-anulacion-nota-credito.md):
 * **el estado tributario decide qué reversión es legal**, no el operador.
 *
 *     PENDIENTE_ENVIO  → anulación local directa (SUNAT nunca lo recibió)
 *     ENVIADO          → esperar respuesta antes de revertir
 *     ACEPTADO         → NOTA DE CRÉDITO (tipo 07). No se puede anular.
 *     OBSERVADO        → corregir y reenviar
 *     RECHAZADO        → corregir y reemitir
 *
 * ### Series por caja
 *
 * Cada punto de emisión tiene serie propia y su correlativo corre **local e
 * independiente**, sin consultar a la nube ni a otras cajas. No es un atajo del
 * proyecto: es el modelo que la normativa de SUNAT espera. Elimina la colisión
 * de numeración entre cajas por construcción.
 */

export type TipoComprobante = 'BOLETA' | 'FACTURA' | 'NOTA_VENTA' | 'NOTA_CREDITO';

export type EstadoTributario =
  | 'PENDIENTE_ENVIO'
  | 'ENVIADO'
  | 'ACEPTADO'
  | 'OBSERVADO'
  | 'RECHAZADO'
  | 'ANULADO'
  | 'NO_APLICA';

export type TipoReversion = 'ANULACION' | 'NOTA_CREDITO';

export interface ComprobanteEmitido {
  uuid: string;
  tipoComprobante: TipoComprobante;
  serie: string;
  correlativo: number;
  fechaEmision: string;
  estadoTributario: EstadoTributario;
  total: number;
}

/** Prefijo de serie por tipo de comprobante. */
const PREFIJO_SERIE: Record<TipoComprobante, string> = {
  BOLETA: 'B',
  FACTURA: 'F',
  NOTA_VENTA: 'N',
  NOTA_CREDITO: 'N',
};

/**
 * Serie de un tipo de comprobante para una caja concreta.
 *
 * `CAJA-01` + FACTURA → `F001`. El número de caja sale de su identificador, de
 * modo que dos cajas nunca comparten serie.
 */
export function serieDe(cajaId: string, tipo: TipoComprobante): string {
  const numero = cajaId.match(/(\d+)\s*$/)?.[1] ?? '1';
  const sufijo = numero.padStart(3, '0').slice(-3);
  return `${PREFIJO_SERIE[tipo]}${sufijo}`;
}

/**
 * La NOTA_VENTA no es comprobante fiscal: SUNAT no la recibe, así que no tiene
 * ciclo tributario que seguir.
 */
export function estadoInicial(tipo: TipoComprobante): EstadoTributario {
  return tipo === 'NOTA_VENTA' ? 'NO_APLICA' : 'PENDIENTE_ENVIO';
}

/**
 * Decide qué reversión corresponde según el estado tributario.
 *
 * **El llamante no elige.** Envía la intención de revertir y esta función
 * determina si toca anulación o nota de crédito. Es lo que impide emitir algo
 * que SUNAT rechazaría.
 */
export function reversionQueCorresponde(estado: EstadoTributario): TipoReversion {
  // Solo un comprobante que SUNAT acepto exige nota de credito: ya existe
  // legalmente y no se puede borrar, solo compensar.
  return estado === 'ACEPTADO' ? 'NOTA_CREDITO' : 'ANULACION';
}

/** Estados desde los que no se puede revertir todavía. */
const NO_REVERSIBLES: ReadonlySet<EstadoTributario> = new Set<EstadoTributario>([
  'ENVIADO',
  'ANULADO',
]);

export interface Reversibilidad {
  permitida: boolean;
  motivo?: string;
}

export function puedeRevertirse(estado: EstadoTributario): Reversibilidad {
  if (estado === 'ENVIADO') {
    return {
      permitida: false,
      motivo:
        'El comprobante está enviado y aún no hay respuesta de SUNAT. Espera el ' +
        'resultado antes de revertir: la reversión depende de si fue aceptado.',
    };
  }

  if (estado === 'ANULADO') {
    return { permitida: false, motivo: 'El comprobante ya fue anulado.' };
  }

  return { permitida: true };
}

export const esReversible = (estado: EstadoTributario): boolean =>
  !NO_REVERSIBLES.has(estado);

/**
 * Contador de correlativos por serie.
 *
 * En el terminal esto vive en SQLite; aquí es memoria. Lo importante es que sea
 * **local**: no consulta a nadie para emitir, que es lo que permite facturar sin
 * internet.
 */
export class CorrelativoPorSerie {
  readonly #ultimo = new Map<string, number>();

  siguiente(serie: string): number {
    const proximo = (this.#ultimo.get(serie) ?? 0) + 1;
    this.#ultimo.set(serie, proximo);
    return proximo;
  }

  ultimo(serie: string): number {
    return this.#ultimo.get(serie) ?? 0;
  }
}

/** Motivos del catálogo 09 de SUNAT para notas de crédito. */
export const MOTIVOS_NOTA_CREDITO = {
  ANULACION_OPERACION: '01',
  ANULACION_ERROR_RUC: '02',
  DEVOLUCION_TOTAL: '06',
  DEVOLUCION_POR_ITEM: '07',
} as const;
