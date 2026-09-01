/**
 * Cascada de precios — implementa [ADR-003](../../../../../docs/adr/003-precedencia-precios.md).
 *
 *     lista del cliente → promoción → cupón → descuento manual
 *
 * Cada etapa opera sobre el resultado de la anterior. Si una marca
 * `acumulable: false`, **la cascada se detiene ahí** y las posteriores no se aplican.
 *
 * Se guarda el desglose completo, no solo el total, para poder auditarlo y
 * explicárselo al cliente cuando pregunte por qué pagó eso.
 *
 * **Vive dentro de este servicio** (CLAUDE.md §4.4): es una regla del dominio de
 * venta y ningún otro servicio del inventario la necesita.
 *
 * Determinista: mismas entradas, mismo resultado siempre.
 */

export type OrigenDescuento = 'LISTA_PRECIOS' | 'PROMOCION' | 'CUPON' | 'MANUAL';

export interface PasoDescuento {
  orden: number;
  origen: OrigenDescuento;
  referencia?: string | undefined;
  montoAntes: number;
  descuento: number;
  montoDespues: number;
  acumulable: boolean;
  /** Solo en MANUAL: supervisor que autorizó (ADR-001, RNF-06). */
  autorizadoPor?: string | undefined;
}

export interface Promocion {
  referencia: string;
  /** Porcentaje sobre el monto vigente, 0–100. */
  porcentaje?: number | undefined;
  /** Monto fijo a descontar. */
  montoFijo?: number | undefined;
  acumulable: boolean;
}

export interface Cupon {
  codigo: string;
  porcentaje?: number | undefined;
  montoFijo?: number | undefined;
  acumulable: boolean;
}

export interface DescuentoManual {
  monto: number;
  autorizadoPor: string;
}

export interface EntradaCascada {
  /** Precio de catálogo antes de cualquier ajuste. */
  precioBase: number;
  cantidad: number;
  /** Precio de la lista del cliente (VIP, mayorista…), si tiene una asignada. */
  precioLista?: number | undefined;
  nombreLista?: string | undefined;
  promocion?: Promocion | undefined;
  cupon?: Cupon | undefined;
  descuentoManual?: DescuentoManual | undefined;
}

export interface ResultadoCascada {
  precioLista: number;
  precioFinal: number;
  importe: number;
  descuentoTotal: number;
  pasos: PasoDescuento[];
}

/** Redondeo a 2 decimales. El dinero no admite errores de coma flotante. */
const redondear = (v: number): number => Math.round(v * 100) / 100;

/** Un descuento nunca puede dejar el precio en negativo. */
const acotar = (monto: number, descuento: number): number =>
  Math.min(Math.max(descuento, 0), monto);

/**
 * Aplica la cascada y devuelve el desglose completo.
 *
 * @throws Nunca. Entradas absurdas se acotan, no revientan: el cajero está
 *         cobrando y no puede quedarse bloqueado.
 */
export function aplicarCascada(entrada: EntradaCascada): ResultadoCascada {
  const pasos: PasoDescuento[] = [];
  let monto = redondear(entrada.precioBase);
  let orden = 1;
  let cortada = false;

  // ── 1. Lista de precios del cliente (RF-POS-16) ──────────────────
  // No es un descuento: fija el precio base sobre el que operan las demás etapas.
  if (entrada.precioLista !== undefined && entrada.precioLista !== monto) {
    const nuevo = redondear(entrada.precioLista);
    pasos.push({
      orden: orden++,
      origen: 'LISTA_PRECIOS',
      referencia: entrada.nombreLista,
      montoAntes: monto,
      descuento: redondear(monto - nuevo),
      montoDespues: nuevo,
      acumulable: true,
    });
    monto = nuevo;
  }

  const precioLista = monto;

  // ── 2. Promoción automática (RF-POS-14) ──────────────────────────
  if (entrada.promocion && !cortada) {
    const descuento = calcularDescuento(monto, entrada.promocion);
    if (descuento > 0) {
      const nuevo = redondear(monto - descuento);
      pasos.push({
        orden: orden++,
        origen: 'PROMOCION',
        referencia: entrada.promocion.referencia,
        montoAntes: monto,
        descuento,
        montoDespues: nuevo,
        acumulable: entrada.promocion.acumulable,
      });
      monto = nuevo;
      // Una promoción no acumulable corta la cascada: nada posterior se aplica.
      cortada = !entrada.promocion.acumulable;
    }
  }

  // ── 3. Cupón (RF-POS-15) ─────────────────────────────────────────
  if (entrada.cupon && !cortada) {
    const descuento = calcularDescuento(monto, entrada.cupon);
    if (descuento > 0) {
      const nuevo = redondear(monto - descuento);
      pasos.push({
        orden: orden++,
        origen: 'CUPON',
        referencia: entrada.cupon.codigo,
        montoAntes: monto,
        descuento,
        montoDespues: nuevo,
        acumulable: entrada.cupon.acumulable,
      });
      monto = nuevo;
      cortada = !entrada.cupon.acumulable;
    }
  }

  // ── 4. Descuento manual (RF-POS-03) ──────────────────────────────
  // Va último y exige PIN de supervisor (ADR-001, RNF-06).
  if (entrada.descuentoManual && !cortada) {
    const descuento = redondear(acotar(monto, entrada.descuentoManual.monto));
    if (descuento > 0) {
      const nuevo = redondear(monto - descuento);
      pasos.push({
        orden: orden++,
        origen: 'MANUAL',
        montoAntes: monto,
        descuento,
        montoDespues: nuevo,
        acumulable: true,
        autorizadoPor: entrada.descuentoManual.autorizadoPor,
      });
      monto = nuevo;
    }
  }

  const precioFinal = redondear(monto);

  return {
    precioLista,
    precioFinal,
    importe: redondear(precioFinal * entrada.cantidad),
    descuentoTotal: redondear(precioLista - precioFinal),
    pasos,
  };
}

/** Porcentaje y monto fijo son excluyentes; si vienen ambos, gana el porcentaje. */
function calcularDescuento(
  monto: number,
  regla: { porcentaje?: number | undefined; montoFijo?: number | undefined },
): number {
  if (regla.porcentaje !== undefined) {
    const pct = Math.min(Math.max(regla.porcentaje, 0), 100);
    return redondear(acotar(monto, (monto * pct) / 100));
  }

  if (regla.montoFijo !== undefined) {
    return redondear(acotar(monto, regla.montoFijo));
  }

  return 0;
}
