/**
 * Sub-dominio **Cliente / CRM** — contrato de persistencia.
 *
 * Es un sub-dominio *interno* del servicio compuesto, no un servicio aparte
 * (CLAUDE.md §3 y §4.5). Comparte base con Caja, Venta y Catálogo porque el
 * cajero busca al cliente en el mismo instante en que arma el ticket: separarlo
 * convertiría cada venta en una llamada de red en el peor momento posible.
 *
 * Corresponde a los esquemas `Cliente` y `NuevoCliente` de
 * `contratos/openapi/sales-customer-v1.yaml`.
 */

export type TipoDocumento = 'DNI' | 'RUC' | 'GENERICO';

export type Segmento = 'REGULAR' | 'VIP' | 'FRECUENTE' | 'MAYORISTA';

export interface Contacto {
  telefono?: string | undefined;
  correo?: string | undefined;
  direccion?: string | undefined;
}

export interface Fidelizacion {
  puntosAcumulados: number;
  puntosRedimidos: number;
  ultimaActividad?: string | undefined;
}

export interface Trazabilidad {
  creadoPor: string;
  creadoEn: string;
  modificadoPor?: string | undefined;
  modificadoEn?: string | undefined;
}

export interface Cliente {
  uuid: string;
  tipoDocumento: TipoDocumento;
  /** Ausente cuando `tipoDocumento` es GENERICO. */
  numeroDocumento?: string | undefined;
  /** Identificador propio para clientes sin documento tributario. */
  codigoInterno?: string | undefined;
  razonSocial: string;
  nombreComercial?: string | undefined;
  contacto?: Contacto | undefined;
  segmento: Segmento;
  /** Alimenta la cascada de precios (ADR-003). */
  listaPrecios?: string | undefined;
  fidelizacion?: Fidelizacion | undefined;
  activo: boolean;
  trazabilidad: Trazabilidad;
}

/** Campos que `ActualizarCliente` admite modificar. */
export interface CambiosCliente {
  razonSocial?: string | undefined;
  nombreComercial?: string | undefined;
  contacto?: Contacto | undefined;
  segmento?: Segmento | undefined;
  listaPrecios?: string | undefined;
  activo?: boolean | undefined;
}

export interface FiltroCliente {
  /** Texto libre: nombre, documento, teléfono o correo. */
  q: string;
  pagina: number;
  limite: number;
}

export interface ResultadoClientes {
  clientes: Cliente[];
  total: number;
}

export interface RepositorioCliente {
  /**
   * Búsqueda en tiempo real durante la venta (RF-CRM-03).
   * **Menos de 300ms sobre 100.000 registros** (RNF-03, RNF-15).
   */
  buscar(filtro: FiltroCliente): Promise<ResultadoClientes>;

  porUuid(uuid: string): Promise<Cliente | null>;

  /** Devuelve `null` si nadie tiene ese documento. Sirve para evitar duplicados. */
  porDocumento(
    tipoDocumento: TipoDocumento,
    numeroDocumento: string,
  ): Promise<Cliente | null>;

  guardar(cliente: Cliente): Promise<void>;
}
