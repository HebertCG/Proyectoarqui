/**
 * Modelo del comprobante y su ciclo tributario.
 *
 * Implementa la máquina de estados de [ADR-002](../../../../docs/adr/002-anulacion-nota-credito.md)
 * desde el lado del servicio que habla con SUNAT.
 *
 * El comprobante llega ya **emitido localmente** por `Sales & Customer Service`:
 * el cliente se fue con su ticket hace rato. Este servicio solo se encarga del
 * trámite tributario posterior.
 */

export type TipoComprobante = 'BOLETA' | 'FACTURA' | 'NOTA_VENTA' | 'NOTA_CREDITO';

export type EstadoTributario =
  | 'PENDIENTE_ENVIO'
  | 'ENVIADO'
  | 'ACEPTADO'
  | 'OBSERVADO'
  | 'RECHAZADO'
  | 'ANULADO';

export interface LineaComprobante {
  sku: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  importe: number;
}

export interface ClienteComprobante {
  tipoDocumento: 'DNI' | 'RUC' | 'GENERICO';
  numeroDocumento?: string | undefined;
  razonSocial: string;
}

export interface DocumentoReferencia {
  tipoComprobante: TipoComprobante;
  serie: string;
  correlativo: number;
  /** Código del catálogo 09 de SUNAT. */
  motivoCodigo: string;
  motivoDescripcion: string;
}

export interface RespuestaSunat {
  codigo: string;
  descripcion: string;
  recibidoEn: Date;
}

export interface Comprobante {
  uuid: string;
  tipoComprobante: TipoComprobante;
  serie: string;
  correlativo: number;
  fechaEmision: string;
  cliente: ClienteComprobante;
  lineas: LineaComprobante[];
  totalGravado: number;
  totalIgv: number;
  total: number;
  estadoTributario: EstadoTributario;
  documentoReferencia?: DocumentoReferencia | undefined;
  respuestaSunat?: RespuestaSunat | undefined;
  /** Intentos de envío. Alimenta el backoff exponencial. */
  intentos: number;
  ultimoIntento?: Date | undefined;
}

/**
 * Transiciones legales del estado tributario.
 *
 * Declararlas explícitamente evita que un cambio de estado inválido pase
 * inadvertido: `PENDIENTE_ENVIO → ACEPTADO` sin pasar por `ENVIADO` sería un
 * bug silencioso que rompería la trazabilidad.
 */
const TRANSICIONES: Record<EstadoTributario, ReadonlySet<EstadoTributario>> = {
  PENDIENTE_ENVIO: new Set(['ENVIADO', 'ANULADO']),
  ENVIADO: new Set(['ACEPTADO', 'OBSERVADO', 'RECHAZADO', 'PENDIENTE_ENVIO']),
  // Un rechazo se corrige y se reenvía.
  RECHAZADO: new Set(['PENDIENTE_ENVIO']),
  OBSERVADO: new Set(['PENDIENTE_ENVIO', 'ACEPTADO']),
  // ACEPTADO es terminal: solo se compensa con nota de crédito, nunca se anula.
  ACEPTADO: new Set([]),
  ANULADO: new Set([]),
};

export function puedeTransicionar(
  desde: EstadoTributario,
  hacia: EstadoTributario,
): boolean {
  return TRANSICIONES[desde].has(hacia);
}

export class ErrorTransicionInvalida extends Error {
  constructor(desde: EstadoTributario, hacia: EstadoTributario) {
    super(
      `Transición inválida: ${desde} → ${hacia}. ` +
        (desde === 'ACEPTADO'
          ? 'Un comprobante aceptado por SUNAT no cambia de estado: se compensa con nota de crédito.'
          : `Desde ${desde} solo se admite: ${[...TRANSICIONES[desde]].join(', ') || '(ninguno)'}.`),
    );
    this.name = 'ErrorTransicionInvalida';
  }
}

/** Aplica una transición o lanza si es ilegal. */
export function transicionar(
  comprobante: Comprobante,
  hacia: EstadoTributario,
): Comprobante {
  if (!puedeTransicionar(comprobante.estadoTributario, hacia)) {
    throw new ErrorTransicionInvalida(comprobante.estadoTributario, hacia);
  }
  return { ...comprobante, estadoTributario: hacia };
}

/**
 * Nombre de archivo que exige SUNAT: `{RUC}-{tipo}-{serie}-{correlativo}.zip`
 * con el código del catálogo 01 (01=Factura, 03=Boleta, 07=Nota de crédito).
 */
const CODIGO_CATALOGO_01: Record<TipoComprobante, string> = {
  FACTURA: '01',
  BOLETA: '03',
  NOTA_CREDITO: '07',
  NOTA_VENTA: '00',
};

export function nombreArchivoSunat(rucEmisor: string, c: Comprobante): string {
  const tipo = CODIGO_CATALOGO_01[c.tipoComprobante];
  return `${rucEmisor}-${tipo}-${c.serie}-${c.correlativo}.zip`;
}

/**
 * Backoff exponencial para reintentos (RF-SYNC-06).
 * 1 min, 2, 4, 8… con techo de 1 hora para no dejar un comprobante colgado días.
 */
export function esperaMs(intentos: number): number {
  const UN_MINUTO = 60_000;
  const UNA_HORA = 3_600_000;
  return Math.min(UN_MINUTO * 2 ** Math.max(intentos - 1, 0), UNA_HORA);
}

/** Códigos de SUNAT: 0 = aceptado; 2000-3999 = rechazado; 4000+ = observado. */
export function interpretarCodigoSunat(codigo: string): EstadoTributario {
  const n = Number(codigo);
  if (Number.isNaN(n)) return 'RECHAZADO';
  if (n === 0) return 'ACEPTADO';
  if (n >= 4000) return 'OBSERVADO';
  return 'RECHAZADO';
}
