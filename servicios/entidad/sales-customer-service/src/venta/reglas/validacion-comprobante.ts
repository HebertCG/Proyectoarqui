/**
 * Regla documento ↔ comprobante.
 *
 * | Documento del cliente | Comprobante habilitado |
 * |---|---|
 * | DNI (8 dígitos)       | Boleta de venta        |
 * | RUC (11 dígitos)      | Factura                |
 * | Genérico / sin cliente| Nota de venta          |
 *
 * **Vive DENTRO de este servicio**, no en un servicio extraído. Ningún otro
 * servicio del inventario la necesita, así que extraerla violaría Autonomía (P5)
 * sin beneficio de reutilización real (CLAUDE.md §4.4).
 *
 * Se aplica **antes** de cerrar el ticket (RF-POS-18): emitir de todos modos
 * produciría un comprobante que SUNAT rechazaría, y la responsabilidad legal de
 * la emisión correcta recae en el negocio.
 *
 * Cubre RF-POS-17, RF-POS-18, RF-POS-19, RF-CRM-02.
 */

export type TipoDocumento = 'DNI' | 'RUC' | 'GENERICO';

export type TipoComprobante = 'BOLETA' | 'FACTURA' | 'NOTA_VENTA' | 'NOTA_CREDITO';

export interface IdentificacionCliente {
  tipoDocumento: TipoDocumento;
  /** Ausente cuando `tipoDocumento` es GENERICO. */
  numeroDocumento?: string | undefined;
}

export interface ResultadoValidacion {
  /** Si el formato del documento es correcto. */
  valido: boolean;
  /** Vacío cuando el documento es inválido. */
  comprobantesPermitidos: TipoComprobante[];
  /** Presente solo cuando `valido` es false. */
  motivo?: string;
}

export interface ResultadoCompatibilidad {
  compatible: boolean;
  motivo?: string;
  /** El comprobante que sí corresponde. */
  sugerido?: TipoComprobante;
  permitidos: TipoComprobante[];
}

/** DNI: exactamente 8 dígitos (RF-CRM-02). */
const PATRON_DNI = /^\d{8}$/;

/**
 * RUC: 11 dígitos con prefijo válido de SUNAT.
 * 10 = persona natural con negocio · 15, 17 = casos especiales · 20 = persona jurídica.
 */
const PATRON_RUC = /^(10|15|17|20)\d{9}$/;

/**
 * Valida el formato del documento y devuelve qué comprobantes habilita.
 *
 * Un documento inválido **no es una excepción**: es un resultado con `valido:
 * false`. El cajero está tecleando y equivocarse es normal.
 */
export function validarDocumento(cliente: IdentificacionCliente): ResultadoValidacion {
  const { tipoDocumento, numeroDocumento } = cliente;

  if (tipoDocumento === 'GENERICO') {
    // Sin documento tributario no se puede emitir comprobante fiscal.
    return { valido: true, comprobantesPermitidos: ['NOTA_VENTA'] };
  }

  if (!numeroDocumento) {
    return {
      valido: false,
      comprobantesPermitidos: [],
      motivo: `Un cliente identificado con ${tipoDocumento} requiere número de documento.`,
    };
  }

  if (tipoDocumento === 'DNI') {
    return PATRON_DNI.test(numeroDocumento)
      ? { valido: true, comprobantesPermitidos: ['BOLETA'] }
      : {
          valido: false,
          comprobantesPermitidos: [],
          motivo: 'El DNI debe tener exactamente 8 dígitos.',
        };
  }

  return PATRON_RUC.test(numeroDocumento)
    ? { valido: true, comprobantesPermitidos: ['FACTURA'] }
    : {
        valido: false,
        comprobantesPermitidos: [],
        motivo:
          'El RUC debe tener 11 dígitos y empezar en 10, 15, 17 o 20.',
      };
}

/**
 * Verifica si un comprobante concreto puede emitirse para ese cliente.
 *
 * Lo consume `CerrarVenta` antes de emitir (RF-POS-18). Si devuelve
 * `compatible: false`, el cierre debe bloquearse.
 */
export function verificarCompatibilidad(
  cliente: IdentificacionCliente,
  tipoComprobante: TipoComprobante,
): ResultadoCompatibilidad {
  const validacion = validarDocumento(cliente);

  if (!validacion.valido) {
    return {
      compatible: false,
      motivo: validacion.motivo ?? 'El documento del cliente no es válido.',
      permitidos: [],
    };
  }

  const permitidos = validacion.comprobantesPermitidos;

  if (permitidos.includes(tipoComprobante)) {
    return { compatible: true, permitidos };
  }

  const sugerido = permitidos[0];
  const resultado: ResultadoCompatibilidad = {
    compatible: false,
    motivo: explicarIncompatibilidad(cliente.tipoDocumento, tipoComprobante, sugerido),
    permitidos,
  };

  return sugerido === undefined ? resultado : { ...resultado, sugerido };
}

/**
 * Sin cliente asociado la venta es válida (RF-POS-05), pero solo admite nota de
 * venta: no hay a quién emitirle un comprobante fiscal.
 */
export const CLIENTE_GENERICO: IdentificacionCliente = { tipoDocumento: 'GENERICO' };

function explicarIncompatibilidad(
  tipoDocumento: TipoDocumento,
  solicitado: TipoComprobante,
  sugerido: TipoComprobante | undefined,
): string {
  const nombre: Record<TipoComprobante, string> = {
    BOLETA: 'Boleta',
    FACTURA: 'Factura',
    NOTA_VENTA: 'Nota de venta',
    NOTA_CREDITO: 'Nota de crédito',
  };

  if (tipoDocumento === 'GENERICO') {
    return (
      `Un cliente sin documento tributario no puede recibir ${nombre[solicitado]}. ` +
      'Registra su DNI o RUC, o emite Nota de venta.'
    );
  }

  return (
    `Un cliente identificado con ${tipoDocumento} requiere ` +
    `${sugerido ? nombre[sugerido] : 'otro comprobante'}, no ${nombre[solicitado]}.`
  );
}
