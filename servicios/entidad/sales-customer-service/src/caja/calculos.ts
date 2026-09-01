/**
 * Cálculos de caja. Lógica pura, sin persistencia.
 *
 * El balance esperado al cierre es:
 *
 *     fondo inicial + ventas en efectivo + ingresos − egresos
 *
 * Solo cuenta el **efectivo**: lo que se cobró con tarjeta o Yape no está en el
 * cajón, así que no entra en el arqueo físico (RF-CAJA-04).
 */
import type {
  DesglosePago,
  FormaPago,
  MovimientoCaja,
  TurnoCaja,
} from './repositorio.js';

const redondear = (v: number): number => Math.round(v * 100) / 100;

/**
 * Efectivo que debería haber en el cajón.
 *
 * El fondo inicial ya viene como movimiento `FONDO_INICIAL`, así que no se suma
 * aparte: hacerlo lo contaría dos veces.
 */
export function calcularMontoEsperado(turno: TurnoCaja): number {
  const enEfectivo = turno.movimientos.filter((m) => m.formaPago === 'EFECTIVO');
  return redondear(enEfectivo.reduce((total, m) => total + m.monto, 0));
}

/**
 * Monto actual en caja, para el visualizador dinámico (RF-CAJA-09).
 * Es lo mismo que el esperado, pero se nombra distinto porque se consulta
 * durante el turno, no al cerrarlo.
 */
export const calcularMontoActual = calcularMontoEsperado;

/**
 * Desglose por forma de pago al cierre (RF-CAJA-06).
 *
 * Incluye **todas** las formas, no solo efectivo: el negocio necesita saber
 * cuánto entró por tarjeta aunque no esté en el cajón.
 */
export function calcularDesglose(turno: TurnoCaja): DesglosePago[] {
  const porForma = new Map<FormaPago, { total: number; operaciones: number }>();

  for (const movimiento of turno.movimientos) {
    // El fondo inicial no es una operación de venta.
    if (movimiento.tipo === 'FONDO_INICIAL') continue;

    const actual = porForma.get(movimiento.formaPago) ?? { total: 0, operaciones: 0 };
    porForma.set(movimiento.formaPago, {
      total: actual.total + movimiento.monto,
      operaciones: actual.operaciones + 1,
    });
  }

  return [...porForma.entries()]
    .map(([formaPago, { total, operaciones }]) => ({
      formaPago,
      total: redondear(total),
      operaciones,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Diferencia entre lo contado y lo esperado.
 * Negativa = faltó dinero. Positiva = sobró.
 */
export function calcularDiferencia(esperado: number, contado: number): number {
  return redondear(contado - esperado);
}

/**
 * Un egreso se guarda con signo negativo para que la suma del arqueo funcione
 * sin condicionales. Quien llama envía siempre un monto positivo.
 */
export function normalizarMonto(tipo: MovimientoCaja['tipo'], monto: number): number {
  const positivo = Math.abs(monto);
  return tipo === 'EGRESO' || tipo === 'DEVOLUCION' ? -positivo : positivo;
}
