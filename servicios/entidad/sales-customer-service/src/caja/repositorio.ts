/**
 * Sub-dominio **Caja** — contrato de persistencia.
 *
 * Cubre RF-CAJA-01…10.
 *
 * **Append-only** (RNF-08): los movimientos se insertan, nunca se editan ni se
 * borran. La interfaz no expone modificar ni eliminar un movimiento, así que
 * violarlo es imposible desde el código.
 */

export type EstadoTurno = 'ABIERTO' | 'CERRADO';

export type TipoMovimiento =
  | 'FONDO_INICIAL'
  | 'VENTA'
  | 'DEVOLUCION'
  | 'INGRESO'
  | 'EGRESO';

export type FormaPago =
  | 'EFECTIVO'
  | 'TARJETA_DEBITO'
  | 'TARJETA_CREDITO'
  | 'YAPE'
  | 'PLIN'
  | 'TRANSFERENCIA'
  | 'PUNTOS';

export type ModoArqueo = 'CIEGO' | 'ASISTIDO';

export interface MovimientoCaja {
  uuid: string;
  tipo: TipoMovimiento;
  formaPago: FormaPago;
  /** Con signo: los egresos son negativos. */
  monto: number;
  motivo?: string | undefined;
  ticketUuid?: string | undefined;
  registradoPor: string;
  registradoEn: Date;
}

export interface DesglosePago {
  formaPago: FormaPago;
  total: number;
  operaciones: number;
}

export interface Arqueo {
  turnoUuid: string;
  modo: ModoArqueo;
  montoEsperado: number;
  montoContado: number;
  /** Con signo: negativo si faltó dinero. */
  diferencia: number;
  observacion?: string | undefined;
  desglose: DesglosePago[];
}

export interface TurnoCaja {
  uuid: string;
  /** Punto de emisión. Determina la serie de comprobantes. */
  cajaId: string;
  estado: EstadoTurno;
  fondoInicial: number;
  abiertoPor: string;
  abiertoEn: Date;
  cerradoPor?: string | undefined;
  cerradoEn?: Date | undefined;
  movimientos: MovimientoCaja[];
  /** Presente solo cuando el turno está CERRADO. */
  arqueo?: Arqueo | undefined;
}

export interface RepositorioCaja {
  /** Turno abierto de una caja, o `null` si no hay ninguno. */
  turnoAbierto(cajaId: string): Promise<TurnoCaja | null>;

  porUuid(uuid: string): Promise<TurnoCaja | null>;

  abrir(turno: TurnoCaja): Promise<void>;

  /** Añade un movimiento. Append-only: no reemplaza ninguno existente. */
  agregarMovimiento(turnoUuid: string, movimiento: MovimientoCaja): Promise<void>;

  cerrar(turnoUuid: string, arqueo: Arqueo, cerradoPor: string): Promise<void>;

  /** Historial de cierres, solo lectura (RF-CAJA-10). */
  cierres(desde?: Date, hasta?: Date): Promise<Arqueo[]>;
}
