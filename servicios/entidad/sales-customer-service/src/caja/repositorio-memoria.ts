/**
 * Repositorio de caja en memoria.
 *
 * Respeta append-only igual que lo hara PostgreSQL: agregarMovimiento solo
 * inserta. Si no lo respetara, las pruebas pasarian y produccion fallaria.
 */
import type {
  Arqueo,
  MovimientoCaja,
  RepositorioCaja,
  TurnoCaja,
} from './repositorio.js';

export class RepositorioCajaMemoria implements RepositorioCaja {
  readonly #porUuid = new Map<string, TurnoCaja>();

  async turnoAbierto(cajaId: string): Promise<TurnoCaja | null> {
    for (const turno of this.#porUuid.values()) {
      if (turno.cajaId === cajaId && turno.estado === 'ABIERTO') return turno;
    }
    return null;
  }

  async porUuid(uuid: string): Promise<TurnoCaja | null> {
    return this.#porUuid.get(uuid) ?? null;
  }

  async abrir(turno: TurnoCaja): Promise<void> {
    this.#porUuid.set(turno.uuid, turno);
  }

  async agregarMovimiento(
    turnoUuid: string,
    movimiento: MovimientoCaja,
  ): Promise<void> {
    const turno = this.#porUuid.get(turnoUuid);
    if (!turno) return;
    // Append-only: se anade, nunca se reemplaza (RNF-08).
    turno.movimientos.push(movimiento);
  }

  async cerrar(turnoUuid: string, arqueo: Arqueo, cerradoPor: string): Promise<void> {
    const turno = this.#porUuid.get(turnoUuid);
    if (!turno) return;

    turno.estado = 'CERRADO';
    turno.arqueo = arqueo;
    turno.cerradoPor = cerradoPor;
    turno.cerradoEn = new Date();
  }

  async cierres(desde?: Date, hasta?: Date): Promise<Arqueo[]> {
    return [...this.#porUuid.values()]
      .filter((t) => t.estado === 'CERRADO' && t.arqueo !== undefined)
      .filter((t) => {
        if (!t.cerradoEn) return false;
        if (desde && t.cerradoEn < desde) return false;
        if (hasta && t.cerradoEn > hasta) return false;
        return true;
      })
      .sort((a, b) => (b.cerradoEn?.getTime() ?? 0) - (a.cerradoEn?.getTime() ?? 0))
      .map((t) => t.arqueo as Arqueo);
  }
}
