/**
 * Envelope de respuesta común a todos los servicios.
 *
 * Un único formato en todo el inventario es lo que permite que el ESB y
 * cualquier consumidor traten las respuestas de forma uniforme, sin conocer
 * el servicio concreto que respondió (CLAUDE.md §2.1 P3 — abstracción).
 */

export interface MetaRespuesta {
  /** Identificador que sigue la operación a través de todos los servicios. */
  correlationId: string;
  /** Servicio que produjo la respuesta. */
  servicio: string;
  /** ISO-8601 en UTC. */
  timestamp: string;
}

export interface MetaPaginacion {
  total: number;
  pagina: number;
  limite: number;
}

export interface ErrorEnvelope {
  /** Código estable y legible: `CLIENTE_NO_ENCONTRADO`, no un número mágico. */
  codigo: string;
  mensaje: string;
  /** Contexto adicional. Nunca datos sensibles (CLAUDE.md §9.3). */
  detalles?: unknown;
}

export interface Envelope<T> {
  exito: boolean;
  datos: T | null;
  error: ErrorEnvelope | null;
  meta: MetaRespuesta & Partial<MetaPaginacion>;
}

export function exito<T>(
  datos: T,
  meta: MetaRespuesta,
  paginacion?: MetaPaginacion,
): Envelope<T> {
  return {
    exito: true,
    datos,
    error: null,
    meta: paginacion ? { ...meta, ...paginacion } : meta,
  };
}

export function fallo(error: ErrorEnvelope, meta: MetaRespuesta): Envelope<never> {
  return { exito: false, datos: null, error, meta };
}
