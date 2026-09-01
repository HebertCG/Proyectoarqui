import { describe, it, expect } from 'vitest';

import {
  validarDocumento,
  verificarCompatibilidad,
  CLIENTE_GENERICO,
} from '../src/venta/reglas/validacion-comprobante.js';
import { aplicarCascada } from '../src/venta/reglas/cascada-precios.js';

// ══════════════════════════════════════════════════════════════════
//  Regla documento ↔ comprobante (RF-POS-17/18/19)
// ══════════════════════════════════════════════════════════════════

describe('validarDocumento', () => {
  it('DNI válido habilita solo Boleta', () => {
    const r = validarDocumento({ tipoDocumento: 'DNI', numeroDocumento: '45678912' });

    expect(r.valido).toBe(true);
    expect(r.comprobantesPermitidos).toEqual(['BOLETA']);
  });

  it('RUC válido habilita solo Factura', () => {
    const r = validarDocumento({ tipoDocumento: 'RUC', numeroDocumento: '20512345678' });

    expect(r.valido).toBe(true);
    expect(r.comprobantesPermitidos).toEqual(['FACTURA']);
  });

  it('cliente genérico queda restringido a Nota de venta', () => {
    const r = validarDocumento(CLIENTE_GENERICO);

    expect(r.valido).toBe(true);
    expect(r.comprobantesPermitidos).toEqual(['NOTA_VENTA']);
  });

  it('rechaza un DNI que no tiene 8 dígitos', () => {
    for (const numero of ['1234567', '123456789', '', 'abcdefgh']) {
      const r = validarDocumento({ tipoDocumento: 'DNI', numeroDocumento: numero });
      expect(r.valido).toBe(false);
      expect(r.comprobantesPermitidos).toEqual([]);
    }
  });

  it('acepta los cuatro prefijos de RUC que reconoce SUNAT', () => {
    for (const prefijo of ['10', '15', '17', '20']) {
      const r = validarDocumento({
        tipoDocumento: 'RUC',
        numeroDocumento: `${prefijo}123456789`,
      });
      expect(r.valido).toBe(true);
    }
  });

  it('rechaza un RUC con prefijo que SUNAT no reconoce', () => {
    for (const prefijo of ['11', '99', '00', '30']) {
      const r = validarDocumento({
        tipoDocumento: 'RUC',
        numeroDocumento: `${prefijo}123456789`,
      });
      expect(r.valido).toBe(false);
      expect(r.motivo).toMatch(/10, 15, 17 o 20/);
    }
  });

  it('rechaza un RUC que no tiene 11 dígitos', () => {
    expect(validarDocumento({ tipoDocumento: 'RUC', numeroDocumento: '2051234567' }).valido)
      .toBe(false);
    expect(validarDocumento({ tipoDocumento: 'RUC', numeroDocumento: '205123456789' }).valido)
      .toBe(false);
  });

  it('exige número cuando el tipo no es genérico', () => {
    const r = validarDocumento({ tipoDocumento: 'DNI' });

    expect(r.valido).toBe(false);
    expect(r.motivo).toMatch(/requiere número de documento/);
  });

  it('un documento inválido no lanza: el cajero se equivoca al teclear', () => {
    expect(() =>
      validarDocumento({ tipoDocumento: 'RUC', numeroDocumento: 'basura' }),
    ).not.toThrow();
  });
});

describe('verificarCompatibilidad — bloquea el cierre (RF-POS-18)', () => {
  const conRuc = { tipoDocumento: 'RUC' as const, numeroDocumento: '20512345678' };
  const conDni = { tipoDocumento: 'DNI' as const, numeroDocumento: '45678912' };

  it('RUC + Factura es compatible', () => {
    expect(verificarCompatibilidad(conRuc, 'FACTURA').compatible).toBe(true);
  });

  it('RUC + Boleta NO es compatible, y sugiere Factura', () => {
    const r = verificarCompatibilidad(conRuc, 'BOLETA');

    expect(r.compatible).toBe(false);
    expect(r.sugerido).toBe('FACTURA');
    expect(r.motivo).toMatch(/RUC requiere Factura/);
  });

  it('DNI + Factura NO es compatible, y sugiere Boleta', () => {
    const r = verificarCompatibilidad(conDni, 'FACTURA');

    expect(r.compatible).toBe(false);
    expect(r.sugerido).toBe('BOLETA');
  });

  it('genérico + Factura NO es compatible, y explica qué hacer', () => {
    const r = verificarCompatibilidad(CLIENTE_GENERICO, 'FACTURA');

    expect(r.compatible).toBe(false);
    expect(r.motivo).toMatch(/Registra su DNI o RUC/);
  });

  it('genérico + Nota de venta es compatible: la venta sin cliente es válida', () => {
    expect(verificarCompatibilidad(CLIENTE_GENERICO, 'NOTA_VENTA').compatible).toBe(true);
  });

  it('un documento con formato inválido es incompatible con todo', () => {
    const r = verificarCompatibilidad(
      { tipoDocumento: 'RUC', numeroDocumento: '99123456789' },
      'FACTURA',
    );

    expect(r.compatible).toBe(false);
    expect(r.permitidos).toEqual([]);
    expect(r.sugerido).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
//  Cascada de precios (ADR-003)
// ══════════════════════════════════════════════════════════════════

describe('aplicarCascada — orden de las etapas', () => {
  it('sin descuentos, el precio no cambia', () => {
    const r = aplicarCascada({ precioBase: 25.0, cantidad: 2 });

    expect(r.precioFinal).toBe(25.0);
    expect(r.importe).toBe(50.0);
    expect(r.descuentoTotal).toBe(0);
    expect(r.pasos).toHaveLength(0);
  });

  it('la lista del cliente fija el precio base de las demás etapas', () => {
    const r = aplicarCascada({
      precioBase: 25.0,
      cantidad: 1,
      precioLista: 21.5,
      nombreLista: 'VIP',
    });

    expect(r.pasos[0]?.origen).toBe('LISTA_PRECIOS');
    expect(r.pasos[0]?.referencia).toBe('VIP');
    expect(r.precioLista).toBe(21.5);
    expect(r.precioFinal).toBe(21.5);
  });

  it('aplica las cuatro etapas en orden y guarda el desglose completo', () => {
    const r = aplicarCascada({
      precioBase: 100.0,
      cantidad: 1,
      precioLista: 90.0,
      nombreLista: 'VIP',
      promocion: { referencia: 'PROMO-10', porcentaje: 10, acumulable: true },
      cupon: { codigo: 'CUP5', montoFijo: 5, acumulable: true },
      descuentoManual: { monto: 3, autorizadoPor: 'supervisor01' },
    });

    expect(r.pasos.map((p) => p.origen)).toEqual([
      'LISTA_PRECIOS',
      'PROMOCION',
      'CUPON',
      'MANUAL',
    ]);

    // 100 → 90 (lista) → 81 (-10%) → 76 (-5) → 73 (-3 manual)
    expect(r.precioFinal).toBe(73.0);
    expect(r.pasos.map((p) => p.montoDespues)).toEqual([90, 81, 76, 73]);
  });

  it('cada paso encadena: montoAntes es el montoDespues del anterior', () => {
    const r = aplicarCascada({
      precioBase: 100.0,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: 20, acumulable: true },
      cupon: { codigo: 'C', porcentaje: 10, acumulable: true },
    });

    for (let i = 1; i < r.pasos.length; i += 1) {
      expect(r.pasos[i]?.montoAntes).toBe(r.pasos[i - 1]?.montoDespues);
    }
  });

  it('numera los pasos consecutivamente desde 1', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: 10, acumulable: true },
      cupon: { codigo: 'C', montoFijo: 5, acumulable: true },
    });

    expect(r.pasos.map((p) => p.orden)).toEqual([1, 2]);
  });
});

describe('aplicarCascada — bandera acumulable', () => {
  it('una promoción NO acumulable corta la cascada', () => {
    const r = aplicarCascada({
      precioBase: 100.0,
      cantidad: 1,
      promocion: { referencia: 'EXCLUSIVA', porcentaje: 30, acumulable: false },
      cupon: { codigo: 'CUP10', porcentaje: 10, acumulable: true },
      descuentoManual: { monto: 5, autorizadoPor: 'supervisor01' },
    });

    // El cupón y el manual NO se aplican: la promoción cortó.
    expect(r.pasos.map((p) => p.origen)).toEqual(['PROMOCION']);
    expect(r.precioFinal).toBe(70.0);
  });

  it('un cupón NO acumulable corta el descuento manual', () => {
    const r = aplicarCascada({
      precioBase: 100.0,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: 10, acumulable: true },
      cupon: { codigo: 'UNICO', montoFijo: 20, acumulable: false },
      descuentoManual: { monto: 5, autorizadoPor: 'supervisor01' },
    });

    expect(r.pasos.map((p) => p.origen)).toEqual(['PROMOCION', 'CUPON']);
    expect(r.precioFinal).toBe(70.0);
  });

  it('la lista de precios nunca corta: solo fija el precio base', () => {
    const r = aplicarCascada({
      precioBase: 100.0,
      cantidad: 1,
      precioLista: 80.0,
      promocion: { referencia: 'P', porcentaje: 10, acumulable: true },
    });

    expect(r.pasos).toHaveLength(2);
    expect(r.precioFinal).toBe(72.0);
  });
});

describe('aplicarCascada — trazabilidad y auditoría', () => {
  it('el descuento manual registra quién lo autorizó (ADR-001)', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      descuentoManual: { monto: 10, autorizadoPor: 'supervisor01' },
    });

    expect(r.pasos[0]?.autorizadoPor).toBe('supervisor01');
  });

  it('las etapas automáticas no llevan autorizante', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: 10, acumulable: true },
    });

    expect(r.pasos[0]?.autorizadoPor).toBeUndefined();
  });

  it('el descuento total cuadra con la diferencia real', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: 25, acumulable: true },
    });

    expect(r.descuentoTotal).toBe(25);
    expect(r.precioLista - r.precioFinal).toBe(r.descuentoTotal);
  });
});

describe('aplicarCascada — casos límite: el cajero no puede quedarse bloqueado', () => {
  it('un descuento mayor que el precio no deja el total en negativo', () => {
    const r = aplicarCascada({
      precioBase: 10,
      cantidad: 1,
      descuentoManual: { monto: 999, autorizadoPor: 'supervisor01' },
    });

    expect(r.precioFinal).toBe(0);
    expect(r.precioFinal).toBeGreaterThanOrEqual(0);
  });

  it('un porcentaje mayor que 100 se acota', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: 500, acumulable: true },
    });

    expect(r.precioFinal).toBe(0);
  });

  it('un porcentaje negativo no sube el precio', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: -50, acumulable: true },
    });

    expect(r.precioFinal).toBe(100);
    expect(r.pasos).toHaveLength(0);
  });

  it('un descuento de cero no genera paso: no pasó nada que registrar', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'P', montoFijo: 0, acumulable: true },
    });

    expect(r.pasos).toHaveLength(0);
  });

  it('una promoción sin porcentaje ni monto no descuenta', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'VACIA', acumulable: true },
    });

    expect(r.precioFinal).toBe(100);
  });

  it('si vienen porcentaje y monto fijo, gana el porcentaje', () => {
    const r = aplicarCascada({
      precioBase: 100,
      cantidad: 1,
      promocion: { referencia: 'P', porcentaje: 10, montoFijo: 50, acumulable: true },
    });

    expect(r.precioFinal).toBe(90);
  });

  it('redondea a 2 decimales: el dinero no admite errores de coma flotante', () => {
    const r = aplicarCascada({
      precioBase: 33.33,
      cantidad: 3,
      promocion: { referencia: 'P', porcentaje: 15, acumulable: true },
    });

    expect(r.precioFinal).toBe(28.33);
    expect(r.importe).toBe(84.99);
    // Sin redondeo esto daría 84.98999999999999
    expect(Number.isInteger(r.importe * 100)).toBe(true);
  });

  it('es determinista: mismas entradas, mismo resultado', () => {
    const entrada = {
      precioBase: 87.65,
      cantidad: 7,
      precioLista: 79.9,
      promocion: { referencia: 'P', porcentaje: 12.5, acumulable: true },
      cupon: { codigo: 'C', montoFijo: 3.33, acumulable: true },
    };

    expect(aplicarCascada(entrada)).toEqual(aplicarCascada(entrada));
  });
});
