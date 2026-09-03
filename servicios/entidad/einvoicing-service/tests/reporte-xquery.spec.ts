/**
 * Reporte consolidado con XQuery 3.1.
 *
 * Cubre el ítem del temario *"XSLT, XQuery, XPath"* (Unidad 1) con el caso que
 * el propio `CLAUDE.md` §5 nombra: reportes sobre comprobantes.
 */
import { describe, expect, it } from 'vitest';

import { aDocumentoXml, consolidarPorSerie, NS_REPORTE } from '../src/reporte-xquery.js';
import type { Comprobante } from '../src/comprobante.js';

function comprobante(parcial: Partial<Comprobante> & Pick<Comprobante, 'uuid'>): Comprobante {
  return {
    tipoComprobante: 'FACTURA',
    serie: 'F001',
    correlativo: 1,
    fechaEmision: '2026-09-01',
    cliente: { tipoDocumento: 'RUC', numeroDocumento: '20512345678', razonSocial: 'Andina SAC' },
    lineas: [
      { sku: 'SH-500ML', descripcion: 'Shampoo', cantidad: 1, precioUnitario: 25, importe: 25 },
    ],
    totalGravado: 21.19,
    totalIgv: 3.81,
    total: 25,
    estadoTributario: 'ACEPTADO',
    intentos: 1,
    ...parcial,
  };
}

const MUESTRA: Comprobante[] = [
  comprobante({ uuid: 'a1', serie: 'F001', correlativo: 1, total: 100 }),
  comprobante({ uuid: 'a2', serie: 'F001', correlativo: 2, total: 50 }),
  comprobante({
    uuid: 'a3',
    serie: 'F001',
    correlativo: 3,
    total: 20,
    estadoTributario: 'RECHAZADO',
  }),
  comprobante({
    uuid: 'b1',
    serie: 'B001',
    correlativo: 1,
    tipoComprobante: 'BOLETA',
    total: 30,
    estadoTributario: 'PENDIENTE_ENVIO',
  }),
  comprobante({
    uuid: 'b2',
    serie: 'B001',
    correlativo: 2,
    tipoComprobante: 'BOLETA',
    total: 10,
    estadoTributario: 'ENVIADO',
    fechaEmision: '2026-09-05',
  }),
];

describe('proyección a documento XML', () => {
  it('declara el namespace del servicio (convención §7)', () => {
    expect(aDocumentoXml(MUESTRA)).toContain(`xmlns="${NS_REPORTE}"`);
  });

  it('emite un elemento por comprobante', () => {
    const xml = aDocumentoXml(MUESTRA);

    expect(xml.match(/<comprobante /g)).toHaveLength(5);
  });

  it('escapa el contenido: una razón social con & no rompe el documento', () => {
    const xml = aDocumentoXml([
      comprobante({ uuid: 'x', serie: 'F001', tipoComprobante: 'FACTURA' }),
    ]);

    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it('un documento sin comprobantes sigue siendo XML válido', () => {
    expect(() => consolidarPorSerie([])).not.toThrow();
  });
});

describe('consolidarPorSerie — XQuery 3.1', () => {
  it('agrupa por serie', () => {
    const r = consolidarPorSerie(MUESTRA);

    expect(r.porSerie.map((s) => s.serie)).toEqual(['B001', 'F001']);
  });

  it('cuenta emitidos por serie', () => {
    const r = consolidarPorSerie(MUESTRA);

    expect(r.porSerie.find((s) => s.serie === 'F001')?.emitidos).toBe(3);
    expect(r.porSerie.find((s) => s.serie === 'B001')?.emitidos).toBe(2);
  });

  it('separa aceptados, rechazados y pendientes', () => {
    const f001 = consolidarPorSerie(MUESTRA).porSerie.find((s) => s.serie === 'F001');

    expect(f001).toMatchObject({ aceptados: 2, rechazados: 1, pendientes: 0 });
  });

  it('cuenta como pendiente tanto PENDIENTE_ENVIO como ENVIADO', () => {
    // Los dos estados significan "aún sin resolución de SUNAT".
    const b001 = consolidarPorSerie(MUESTRA).porSerie.find((s) => s.serie === 'B001');

    expect(b001?.pendientes).toBe(2);
  });

  it('suma el monto por serie', () => {
    const r = consolidarPorSerie(MUESTRA);

    expect(r.porSerie.find((s) => s.serie === 'F001')?.montoTotal).toBe(170);
    expect(r.porSerie.find((s) => s.serie === 'B001')?.montoTotal).toBe(40);
  });

  it('el total general es la suma de las series', () => {
    const r = consolidarPorSerie(MUESTRA);

    expect(r.totalComprobantes).toBe(5);
    expect(r.montoTotal).toBe(210);
  });

  it('redondea a dos decimales: sum() arrastra error de coma flotante', () => {
    const r = consolidarPorSerie([
      comprobante({ uuid: 'c1', total: 0.1 }),
      comprobante({ uuid: 'c2', correlativo: 2, total: 0.2 }),
    ]);

    expect(r.montoTotal).toBe(0.3);
  });

  it('ordena las series alfabéticamente, no por orden de llegada', () => {
    const r = consolidarPorSerie([...MUESTRA].reverse());

    expect(r.porSerie.map((s) => s.serie)).toEqual(['B001', 'F001']);
  });
});

describe('consolidarPorSerie — filtro por fechas', () => {
  it('excluye lo anterior a `desde`', () => {
    const r = consolidarPorSerie(MUESTRA, { desde: '2026-09-05' });

    expect(r.totalComprobantes).toBe(1);
    expect(r.porSerie).toHaveLength(1);
    expect(r.desde).toBe('2026-09-05');
  });

  it('excluye lo posterior a `hasta`', () => {
    const r = consolidarPorSerie(MUESTRA, { hasta: '2026-09-01' });

    expect(r.totalComprobantes).toBe(4);
  });

  it('un rango sin comprobantes devuelve el reporte vacío, no un error', () => {
    const r = consolidarPorSerie(MUESTRA, { desde: '2027-01-01' });

    expect(r).toMatchObject({ totalComprobantes: 0, montoTotal: 0, porSerie: [] });
  });
});
