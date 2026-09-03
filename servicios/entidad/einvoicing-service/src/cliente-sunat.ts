/**
 * Cliente SOAP hacia SUNAT.
 *
 * Este es el punto del inventario donde SOAP tiene justificación técnica real
 * (CLAUDE.md §5.1): SUNAT expone `billService` como SOAP con WS-Security
 * UsernameToken, recibe el UBL comprimido en ZIP y base64, y responde con un CDR
 * —Constancia de Recepción— también en XML.
 *
 * Se define como interfaz para poder sustituirlo: en desarrollo por un simulador,
 * en pruebas por un doble, y en producción por el cliente real. Nada del resto
 * del servicio sabe cuál está corriendo.
 */
import type { EstadoTributario } from './comprobante.js';

export interface CredencialesSol {
  /** RUC del emisor. */
  ruc: string;
  /** Usuario SOL, que viaja como `{RUC}{usuario}`. */
  usuario: string;
  clave: string;
}

export interface RespuestaEnvio {
  /** Código del CDR. 0 = aceptado. */
  codigo: string;
  descripcion: string;
  estado: EstadoTributario;
  /** CDR crudo, para archivarlo. */
  cdrBase64?: string | undefined;
}

export interface ClienteSunat {
  /**
   * Envía el comprobante.
   *
   * @param nombreArchivo `{RUC}-{tipo}-{serie}-{correlativo}.zip`
   * @param contenidoZip  UBL firmado, comprimido y en base64
   */
  enviarComprobante(
    nombreArchivo: string,
    contenidoZip: string,
  ): Promise<RespuestaEnvio>;

  /** Consulta el estado de un envío asíncrono por ticket. */
  consultarEstado(ticket: string): Promise<RespuestaEnvio>;
}

export class ErrorSunat extends Error {
  readonly codigo: string;
  /** Un error de red se reintenta; uno de negocio, no. */
  readonly reintentable: boolean;

  constructor(codigo: string, mensaje: string, reintentable: boolean) {
    super(mensaje);
    this.name = 'ErrorSunat';
    this.codigo = codigo;
    this.reintentable = reintentable;
  }
}

/**
 * Cliente SOAP real. Habla con el `billService` de SUNAT.
 *
 * La carga de `node-soap` es diferida a propósito: el servicio debe poder
 * arrancar en desarrollo sin resolver el WSDL remoto.
 */
export class ClienteSunatSoap implements ClienteSunat {
  readonly #endpoint: string;
  readonly #credenciales: CredencialesSol;
  readonly #timeoutMs: number;
  #cliente: unknown = null;

  constructor(endpoint: string, credenciales: CredencialesSol, timeoutMs = 30_000) {
    this.#endpoint = endpoint;
    this.#credenciales = credenciales;
    this.#timeoutMs = timeoutMs;
  }

  async #obtenerCliente(): Promise<Record<string, (...args: unknown[]) => unknown>> {
    if (this.#cliente) {
      return this.#cliente as Record<string, (...args: unknown[]) => unknown>;
    }

    const soap = await import('soap');

    // Resolver el WSDL tambien puede fallar por red. Sin traducir aqui, el
    // error escapa crudo y el worker de reintentos no sabe si reintentar.
    let cliente;
    try {
      cliente = await soap.createClientAsync(`${this.#endpoint}?wsdl`, {
        wsdl_options: { timeout: this.#timeoutMs },
      });
    } catch (causa) {
      throw traducirError(causa);
    }

    // El endpoint CONFIGURADO gana sobre el declarado en el WSDL. SUNAT publica
    // el mismo WSDL para beta y produccion con una direccion fija dentro, asi
    // que sin esto el cambio de entorno no tendria efecto.
    cliente.setEndpoint(this.#endpoint);

    // WS-Security UsernameToken: el usuario es {RUC}{usuarioSOL}.
    cliente.setSecurity(
      new soap.WSSecurity(
        `${this.#credenciales.ruc}${this.#credenciales.usuario}`,
        this.#credenciales.clave,
        { passwordType: 'PasswordText' },
      ),
    );

    this.#cliente = cliente;
    return cliente as unknown as Record<string, (...args: unknown[]) => unknown>;
  }

  async enviarComprobante(
    nombreArchivo: string,
    contenidoZip: string,
  ): Promise<RespuestaEnvio> {
    const cliente = await this.#obtenerCliente();

    try {
      const enviar = cliente['sendBillAsync'] as (
        args: unknown,
      ) => Promise<[{ applicationResponse: string }]>;

      const [resultado] = await enviar({
        fileName: nombreArchivo,
        contentFile: contenidoZip,
      });

      return interpretarCdr(resultado.applicationResponse);
    } catch (causa) {
      throw traducirError(causa);
    }
  }

  async consultarEstado(ticket: string): Promise<RespuestaEnvio> {
    const cliente = await this.#obtenerCliente();

    try {
      const consultar = cliente['getStatusAsync'] as (
        args: unknown,
      ) => Promise<[{ statusCode: string; content: string }]>;

      const [resultado] = await consultar({ ticket });

      return {
        codigo: resultado.statusCode,
        descripcion: resultado.content,
        estado: resultado.statusCode === '0' ? 'ACEPTADO' : 'RECHAZADO',
      };
    } catch (causa) {
      throw traducirError(causa);
    }
  }
}

/**
 * Simulador de SUNAT para desarrollo y demo.
 *
 * **No es trampa**: es *service virtualization*. Responde con la misma forma que
 * el servicio real y su naturaleza simulada queda declarada. Lo que sí sería
 * trampa es presentarlo como el servicio real.
 */
export class ClienteSunatSimulado implements ClienteSunat {
  readonly enviados: Array<{ nombreArchivo: string; contenidoZip: string }> = [];
  /** Fuerza una respuesta concreta, para probar los caminos de error. */
  respuestaForzada: RespuestaEnvio | null = null;
  errorForzado: ErrorSunat | null = null;

  async enviarComprobante(
    nombreArchivo: string,
    contenidoZip: string,
  ): Promise<RespuestaEnvio> {
    this.enviados.push({ nombreArchivo, contenidoZip });

    if (this.errorForzado) throw this.errorForzado;
    if (this.respuestaForzada) return this.respuestaForzada;

    return {
      codigo: '0',
      descripcion: `La ${nombreArchivo} ha sido aceptada`,
      estado: 'ACEPTADO',
      cdrBase64: Buffer.from(
        `<ApplicationResponse><ResponseCode>0</ResponseCode></ApplicationResponse>`,
      ).toString('base64'),
    };
  }

  async consultarEstado(ticket: string): Promise<RespuestaEnvio> {
    return {
      codigo: '0',
      descripcion: `Ticket ${ticket} procesado`,
      estado: 'ACEPTADO',
    };
  }
}

/** Extrae el veredicto del CDR que devuelve SUNAT. */
export function interpretarCdr(cdrBase64: string): RespuestaEnvio {
  const cdr = Buffer.from(cdrBase64, 'base64').toString('utf-8');
  const codigo = cdr.match(/<(?:cbc:)?ResponseCode>(\d+)<\//)?.[1] ?? '';
  const descripcion =
    cdr.match(/<(?:cbc:)?Description>([^<]*)<\//)?.[1] ?? 'Sin descripción';

  const n = Number(codigo);
  // 0 = aceptado · 2000-3999 = rechazado · 4000+ = observado (aceptado con reparos)
  const estado: EstadoTributario =
    n === 0 ? 'ACEPTADO' : n >= 4000 ? 'OBSERVADO' : 'RECHAZADO';

  return { codigo, descripcion, estado, cdrBase64 };
}

/**
 * Distingue el fallo de infraestructura del rechazo de negocio.
 *
 * Es la diferencia entre reintentar —y que acabe aceptándose— o dar por
 * definitivo un comprobante que sí podía emitirse. Lo segundo es lo caro: el
 * orquestador compensa y revierte una venta ya cobrada.
 */
function traducirError(causa: unknown): ErrorSunat {
  const mensaje = causa instanceof Error ? causa.message : String(causa);

  // Solo es definitivo si SUNAT **respondio y rechazo**: un SOAP Fault. Todo lo
  // demas —no se pudo resolver el WSDL, 404, TLS, timeout, DNS— es de
  // infraestructura y se reintenta.
  //
  // La direccion del fallo importa: clasificar de menos se traduce en un
  // comprobante que espera en cola; clasificar de mas hace que el orquestador
  // compense y revierta una venta que estaba bien. Ante la duda, se reintenta.
  const fault = esSoapFault(causa);

  if (!fault) {
    return new ErrorSunat(
      'RED',
      `No se pudo contactar con SUNAT: ${mensaje}`,
      true,
    );
  }

  return new ErrorSunat(
    'SOAP_FAULT',
    `SUNAT rechazo la peticion: ${fault}`,
    false,
  );
}

/**
 * Devuelve el motivo del Fault, o `null` si el error no es un SOAP Fault.
 *
 * `node-soap` cuelga el sobre parseado en `err.root.Envelope.Body.Fault` cuando
 * el servidor respondio con un Fault. Se comprueba la estructura y no el texto
 * del mensaje: un mensaje que casualmente contenga la palabra "fault" no es un
 * rechazo de SUNAT.
 */
function esSoapFault(causa: unknown): string | null {
  if (typeof causa !== 'object' || causa === null) return null;

  const raiz = (causa as { root?: { Envelope?: { Body?: { Fault?: unknown } } } }).root;
  const fault = raiz?.Envelope?.Body?.Fault;
  if (!fault) return null;

  const detalle = fault as {
    faultstring?: unknown;
    Reason?: { Text?: unknown };
    detail?: unknown;
  };

  const texto =
    (typeof detalle.faultstring === 'string' && detalle.faultstring) ||
    (typeof detalle.Reason?.Text === 'string' && detalle.Reason.Text) ||
    null;

  // Hay Fault pero sin texto legible: sigue siendo un rechazo de SUNAT.
  return texto ?? 'la autoridad devolvio un SOAP Fault sin detalle';
}

