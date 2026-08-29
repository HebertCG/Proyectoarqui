/**
 * Jerarquía de errores de servicio.
 *
 * Todo error de negocio se declara aquí y sabe convertirse en:
 *   - envelope REST (para los servicios REST/JSON)
 *   - SOAP Fault (para EInvoicing, CLAUDE.md §5.1)
 *
 * Esa doble representación es lo que permite al ESB mediar entre protocolos
 * sin perder la semántica del error.
 */

export type CodigoError =
  | 'VALIDACION'
  | 'NO_AUTORIZADO'
  | 'PROHIBIDO'
  | 'NO_ENCONTRADO'
  | 'CONFLICTO'
  | 'REGLA_NEGOCIO'
  | 'DEPENDENCIA'
  | 'INTERNO';

const ESTADO_HTTP: Record<CodigoError, number> = {
  VALIDACION: 400,
  NO_AUTORIZADO: 401,
  PROHIBIDO: 403,
  NO_ENCONTRADO: 404,
  CONFLICTO: 409,
  REGLA_NEGOCIO: 422,
  DEPENDENCIA: 502,
  INTERNO: 500,
};

/** `Sender` = culpa del emisor; `Receiver` = culpa del servicio (SOAP 1.2). */
const ACTOR_SOAP: Record<CodigoError, 'soap:Sender' | 'soap:Receiver'> = {
  VALIDACION: 'soap:Sender',
  NO_AUTORIZADO: 'soap:Sender',
  PROHIBIDO: 'soap:Sender',
  NO_ENCONTRADO: 'soap:Sender',
  CONFLICTO: 'soap:Sender',
  REGLA_NEGOCIO: 'soap:Sender',
  DEPENDENCIA: 'soap:Receiver',
  INTERNO: 'soap:Receiver',
};

export interface SoapFault {
  Fault: {
    Code: { Value: string; Subcode: { value: string } };
    Reason: { Text: string };
    statusCode: number;
  };
}

export class ErrorServicio extends Error {
  readonly tipo: CodigoError;
  /** Código específico del dominio: `RUC_INVALIDO`, `CAJA_NO_ABIERTA`. */
  readonly codigo: string;
  readonly detalles?: unknown;

  constructor(
    tipo: CodigoError,
    codigo: string,
    mensaje: string,
    detalles?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorServicio';
    this.tipo = tipo;
    this.codigo = codigo;
    this.detalles = detalles;
  }

  get estadoHttp(): number {
    return ESTADO_HTTP[this.tipo];
  }

  toSoapFault(): SoapFault {
    return {
      Fault: {
        Code: { Value: ACTOR_SOAP[this.tipo], Subcode: { value: this.codigo } },
        Reason: { Text: this.message },
        statusCode: this.estadoHttp,
      },
    };
  }
}

// ── Constructores de conveniencia ────────────────────────────────────────

export const errorValidacion = (codigo: string, mensaje: string, detalles?: unknown) =>
  new ErrorServicio('VALIDACION', codigo, mensaje, detalles);

export const errorNoAutorizado = (codigo: string, mensaje: string) =>
  new ErrorServicio('NO_AUTORIZADO', codigo, mensaje);

export const errorProhibido = (codigo: string, mensaje: string) =>
  new ErrorServicio('PROHIBIDO', codigo, mensaje);

export const errorNoEncontrado = (codigo: string, mensaje: string) =>
  new ErrorServicio('NO_ENCONTRADO', codigo, mensaje);

export const errorConflicto = (codigo: string, mensaje: string, detalles?: unknown) =>
  new ErrorServicio('CONFLICTO', codigo, mensaje, detalles);

export const errorReglaNegocio = (codigo: string, mensaje: string, detalles?: unknown) =>
  new ErrorServicio('REGLA_NEGOCIO', codigo, mensaje, detalles);

export const errorDependencia = (codigo: string, mensaje: string, detalles?: unknown) =>
  new ErrorServicio('DEPENDENCIA', codigo, mensaje, detalles);

export const esErrorServicio = (e: unknown): e is ErrorServicio =>
  e instanceof ErrorServicio;
