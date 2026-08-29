/**
 * Pruebas de @pos/xml-kit contra los contratos canonicos reales
 * (contratos/xsd y contratos/xslt), no contra fixtures inventados.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  ValidadorXsd,
  ErrorEsquemaXml,
  ErrorCompilacionEsquema,
} from '../src/validador-xsd.js';
import { TransformadorXslt } from '../src/transformador-xslt.js';
import { ConsultaXml, extraer } from '../src/consulta-xml.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..', '..', '..');
const contratos = join(raiz, 'contratos');
const fixtures = join(aqui, 'fixtures');

let validador: ValidadorXsd;
let transformador: TransformadorXslt;
let xmlValido: string;
let xmlInvalido: string;

beforeAll(async () => {
  const [xsd, comunes, sef, valido, invalido] = await Promise.all([
    readFile(join(contratos, 'xsd', 'comprobante-v1.xsd'), 'utf-8'),
    readFile(join(contratos, 'xsd', 'tipos-comunes-v1.xsd'), 'utf-8'),
    readFile(join(contratos, 'xslt', 'comprobante-a-ubl-v1.sef.json'), 'utf-8'),
    readFile(join(fixtures, 'comprobante-valido.xml'), 'utf-8'),
    readFile(join(fixtures, 'comprobante-ruc-invalido.xml'), 'utf-8'),
  ]);

  // El esquema del comprobante importa los tipos canonicos: hay que
  // suministrarlos con el nombre exacto del schemaLocation.
  validador = new ValidadorXsd(xsd, {
    nombre: 'comprobante-v1',
    importados: [{ nombre: 'tipos-comunes-v1.xsd', contenido: comunes }],
  });
  transformador = new TransformadorXslt(sef, 'comprobante-a-ubl-v1');
  xmlValido = valido;
  xmlInvalido = invalido;
});

describe('ValidadorXsd (P1 — contrato estandarizado)', () => {
  it('acepta un comprobante que cumple el esquema', async () => {
    const r = await validador.validar(xmlValido);
    expect(r.valido).toBe(true);
    expect(r.errores).toHaveLength(0);
  });

  it('rechaza un RUC con prefijo invalido', async () => {
    const r = await validador.validar(xmlInvalido);
    expect(r.valido).toBe(false);
    expect(r.errores.length).toBeGreaterThan(0);
  });

  it('exigir() lanza ErrorEsquemaXml con el detalle del fallo', async () => {
    await expect(validador.exigir(xmlInvalido)).rejects.toThrow(ErrorEsquemaXml);
  });

  it('exigir() no lanza cuando el documento es valido', async () => {
    await expect(validador.exigir(xmlValido)).resolves.toBeUndefined();
  });

  it('distingue un esquema roto de un documento invalido', async () => {
    // Sin suministrar el esquema importado, el XSD no compila. Eso es un
    // error del contrato y debe reportarse como tal, no como "documento invalido".
    const sinImportados = new ValidadorXsd(
      await readFile(join(contratos, 'xsd', 'comprobante-v1.xsd'), 'utf-8'),
      { nombre: 'comprobante-v1' },
    );
    await expect(sinImportados.validar(xmlValido)).rejects.toThrow(
      ErrorCompilacionEsquema,
    );
    await expect(sinImportados.validar(xmlValido)).rejects.toThrow(/importado/i);
  });

  it('el mismo validador sirve para muchos documentos', async () => {
    const resultados = await Promise.all([
      validador.validar(xmlValido),
      validador.validar(xmlInvalido),
      validador.validar(xmlValido),
    ]);
    expect(resultados.map((r) => r.valido)).toEqual([true, false, true]);
  });
});

describe('TransformadorXslt (mediacion del ESB)', () => {
  it('transforma el comprobante interno a UBL 2.1 de SUNAT', () => {
    const ubl = transformador.transformar(xmlValido);

    expect(ubl).toContain('<cbc:ID>F001-128</cbc:ID>');
    // Catalogo 01 de SUNAT: 01 = Factura
    expect(ubl).toContain('<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>');
    // Catalogo 06: 6 = RUC
    expect(ubl).toContain('schemeID="6"');
    expect(ubl).toContain('20512345678');
    expect(ubl).toContain('Distribuidora San Miguel S.A.C.');
  });

  it('genera una linea UBL por cada linea del comprobante', () => {
    const ubl = transformador.transformar(xmlValido);
    const lineas = ubl.match(/<cac:InvoiceLine>/g) ?? [];
    expect(lineas).toHaveLength(2);
  });

  it('conserva el estado tributario para decidir la reversion (ADR-002)', () => {
    const q = new ConsultaXml(xmlValido);
    expect(q.texto('/*:Comprobante/*:estadoTributario')).toBe('ACEPTADO');
    // ACEPTADO por SUNAT => la reversion legal es nota de credito, no anulacion.
    expect(q.booleano("/*:Comprobante/*:estadoTributario = 'ACEPTADO'")).toBe(true);
  });

  it('la salida UBL vuelve a ser XML consultable', () => {
    const ubl = transformador.transformar(xmlValido);
    const total = extraer(ubl, '//*:LegalMonetaryTotal/*:PayableAmount');
    expect(total).toBe('120.00');
  });
});

describe('ConsultaXml — XPath 3.1 (ruteo por contenido del ESB)', () => {
  it('extrae el tipo de comprobante para decidir la ruta', () => {
    const q = new ConsultaXml(xmlValido);
    expect(q.texto('/*:Comprobante/*:tipoComprobante')).toBe('FACTURA');
  });

  it('suma los importes de linea', () => {
    const q = new ConsultaXml(xmlValido);
    expect(q.numero('sum(/*:Comprobante/*:lineas/*:linea/*:importe)')).toBe(120);
  });

  it('evalua condiciones de ruteo como booleano', () => {
    const q = new ConsultaXml(xmlValido);
    expect(q.booleano("/*:Comprobante/*:cliente/*:tipoDocumento = 'RUC'")).toBe(true);
    expect(q.booleano("/*:Comprobante/*:cliente/*:tipoDocumento = 'DNI'")).toBe(false);
  });

  it('devuelve varios valores', () => {
    const q = new ConsultaXml(xmlValido);
    expect(q.textos('/*:Comprobante/*:lineas/*:linea/*:sku')).toEqual([
      'SH-500ML',
      'SRV-CORTE',
    ]);
  });
});

describe('ConsultaXml — XQuery 3.1 (reportes sobre comprobantes)', () => {
  it('filtra lineas por importe', () => {
    const q = new ConsultaXml(xmlValido);
    const skus = q.xquery(`
      for $l in /*:Comprobante/*:lineas/*:linea
      where xs:decimal($l/*:importe) > 50
      return string($l/*:sku)
    `);
    expect(skus).toEqual(['SH-500ML']);
  });

  it('proyecta un resumen legible por linea', () => {
    const q = new ConsultaXml(xmlValido);
    const filas = q.xquery(`
      for $l in /*:Comprobante/*:lineas/*:linea
      order by xs:decimal($l/*:importe) descending
      return concat($l/*:sku, '|', $l/*:importe)
    `);
    expect(filas).toEqual(['SH-500ML|75.00', 'SRV-CORTE|45.00']);
  });
});
