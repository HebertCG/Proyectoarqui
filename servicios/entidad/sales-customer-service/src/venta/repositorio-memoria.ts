/**
 * Repositorio de venta en memoria.
 *
 * Guarda una COPIA del ticket en cada `guardar`. Sin la copia, quien tiene la
 * referencia podria mutar lo persistido sin pasar por el repositorio, y las
 * pruebas darian una falsa sensacion de correccion.
 */
import type { RepositorioVenta, Ticket } from './repositorio.js';

/** Copia profunda suficiente para la estructura del ticket. */
function copiar(ticket: Ticket): Ticket {
  return {
    ...ticket,
    lineas: ticket.lineas.map((l) => ({
      ...l,
      descuentos: l.descuentos.map((d) => ({ ...d })),
    })),
    pagos: ticket.pagos.map((p) => ({ ...p })),
    comprobante: ticket.comprobante ? { ...ticket.comprobante } : undefined,
    reversion: ticket.reversion
      ? { ...ticket.reversion, lineasDevueltas: [...ticket.reversion.lineasDevueltas] }
      : undefined,
  };
}

export class RepositorioVentaMemoria implements RepositorioVenta {
  readonly #porUuid = new Map<string, Ticket>();

  async porUuid(uuid: string): Promise<Ticket | null> {
    const ticket = this.#porUuid.get(uuid);
    return ticket ? copiar(ticket) : null;
  }

  async guardar(ticket: Ticket): Promise<void> {
    this.#porUuid.set(ticket.uuid, copiar(ticket));
  }

  async enCurso(cajaId: string): Promise<Ticket[]> {
    return [...this.#porUuid.values()]
      .filter(
        (t) => t.cajaId === cajaId && (t.estado === 'EN_CURSO' || t.estado === 'SUSPENDIDO'),
      )
      .map(copiar);
  }

  /** Solo para pruebas. */
  get tamano(): number {
    return this.#porUuid.size;
  }
}
