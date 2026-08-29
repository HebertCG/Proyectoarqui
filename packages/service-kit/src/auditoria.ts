/**
 * Cliente de auditoría.
 *
 * Cumple RNF-11: todo movimiento de caja, venta, anulación, cambio de precio y
 * reserva registra usuario, fecha/hora y detalle. El registro es append-only
 * (RNF-08): nada se borra ni se sobrescribe.
 *
 * La auditoría NUNCA debe tumbar la operación de negocio: si el servicio de
 * auditoría no responde, se encola localmente y se registra el fallo, pero la
 * venta sigue adelante.
 */

export interface EntradaAuditoria {
  correlationId: string;
  servicio: string;
  /** Qué se hizo: `VENTA_REGISTRADA`, `CAJA_ABIERTA`, `PRECIO_MODIFICADO`. */
  accion: string;
  /** Sobre qué recurso. */
  recurso: string;
  recursoId?: string;
  /** Quién lo hizo. `sistema` para procesos automáticos. */
  usuario: string;
  /** ISO-8601 UTC. */
  timestamp: string;
  /** Detalle del cambio. Nunca datos sensibles en claro. */
  detalle?: Record<string, unknown>;
}

export interface ClienteAuditoria {
  registrar(entrada: EntradaAuditoria): Promise<void>;
  /** Entradas que no se pudieron enviar y esperan reintento. */
  pendientes(): number;
}

/** Registra por consola. Para desarrollo y pruebas. */
export class AuditoriaConsola implements ClienteAuditoria {
  readonly entradas: EntradaAuditoria[] = [];

  async registrar(entrada: EntradaAuditoria): Promise<void> {
    this.entradas.push(entrada);
  }

  pendientes(): number {
    return 0;
  }
}

/** Envía a `Auditoria.Utility` por HTTP; encola si el servicio no responde. */
export class AuditoriaHttp implements ClienteAuditoria {
  readonly #url: string;
  readonly #cola: EntradaAuditoria[] = [];
  readonly #timeoutMs: number;

  constructor(url: string, timeoutMs = 2000) {
    this.#url = url;
    this.#timeoutMs = timeoutMs;
  }

  async registrar(entrada: EntradaAuditoria): Promise<void> {
    try {
      const señal = AbortSignal.timeout(this.#timeoutMs);
      const res = await fetch(`${this.#url}/entradas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entrada),
        signal: señal,
      });
      if (!res.ok) this.#cola.push(entrada);
    } catch {
      // La auditoría no tumba la operación de negocio: se encola y se reintenta.
      this.#cola.push(entrada);
    }
  }

  pendientes(): number {
    return this.#cola.length;
  }

  /** Reintenta las entradas encoladas. Lo llama el worker de reintentos. */
  async drenar(): Promise<number> {
    const lote = this.#cola.splice(0, this.#cola.length);
    let fallidas = 0;
    for (const entrada of lote) {
      const antes = this.#cola.length;
      await this.registrar(entrada);
      if (this.#cola.length > antes) fallidas += 1;
    }
    return fallidas;
  }
}

export function nuevaEntrada(
  base: Omit<EntradaAuditoria, 'timestamp'>,
): EntradaAuditoria {
  return { ...base, timestamp: new Date().toISOString() };
}
