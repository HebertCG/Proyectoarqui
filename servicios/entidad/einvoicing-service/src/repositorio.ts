/**
 * Contrato de persistencia de `E-Invoicing Service`.
 *
 * Base propia `svc_einvoicing` (P5). Ningun otro servicio lee sus tablas: para
 * saber el estado de un comprobante se pregunta por contrato.
 */
import type { Comprobante, EstadoTributario } from './comprobante.js';

export interface RepositorioComprobantes {
  porUuid(uuid: string): Promise<Comprobante | null>;

  /** Serie + correlativo identifican univocamente un comprobante. */
  porSerie(serie: string, correlativo: number): Promise<Comprobante | null>;

  /**
   * Registra un comprobante. Idempotente por uuid: el terminal reintenta el
   * envio con backoff y no debe duplicar (RF-SYNC-07).
   *
   * @returns `true` si se inserto, `false` si ya existia.
   */
  registrar(comprobante: Comprobante): Promise<boolean>;

  guardar(comprobante: Comprobante): Promise<void>;

  /** Comprobantes a la espera de trámite, para el worker de envio. */
  pendientes(limite: number): Promise<Comprobante[]>;

  buscar(filtro: {
    estado?: EstadoTributario | undefined;
    serie?: string | undefined;
    desde?: string | undefined;
    hasta?: string | undefined;
    pagina: number;
    limite: number;
  }): Promise<{ comprobantes: Comprobante[]; total: number }>;
}
