/**
 * SPIKE — Toolchain XML en Windows sin compilación nativa.
 *
 * Valida las cuatro tecnologías que el sílabo exige (CLAUDE.md §5, sesiones 5-6):
 *   XSD    → xmllint-wasm
 *   XPath  → fontoxpath
 *   XQuery → fontoxpath
 *   XSLT   → saxon-js (compilado a SEF con xslt3)
 *
 * Si algo de esto falla, la Fase 6 (EInvoicing) se cae. Por eso se corre en la Fase 0.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');

const leer = (n: string) => readFile(join(fixtures, n), 'utf-8');

describe('XSD — validación de esquema (xmllint-wasm)', () => {
  let xsd: string;
  let valido: string;
  let invalido: string;

  beforeAll(async () => {
    [xsd, valido, invalido] = await Promise.all([
      leer('comprobante.xsd'),
      leer('comprobante-valido.xml'),
      leer('comprobante-ruc-invalido.xml'),
    ]);
  });

  it('acepta un comprobante con RUC válido', async () => {
    const { validateXML } = await import('xmllint-wasm');
    const r = await validateXML({
      xml: [{ fileName: 'comprobante.xml', contents: valido }],
      schema: [xsd],
    });
    if (!r.valid) console.error('Errores:', r.errors);
    expect(r.valid).toBe(true);
  });

  it('rechaza un RUC con prefijo inválido (99) y 10 dígitos', async () => {
    const { validateXML } = await import('xmllint-wasm');
    const r = await validateXML({
      xml: [{ fileName: 'comprobante.xml', contents: invalido }],
      schema: [xsd],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('XPath 3.1 — ruteo por contenido (fontoxpath)', () => {
  it('extrae el tipo de comprobante para decidir la ruta del ESB', async () => {
    const { parseXmlDocument } = await import('slimdom');
    const { evaluateXPathToString } = await import('fontoxpath');

    const doc = parseXmlDocument(await leer('comprobante-valido.xml'));
    const tipo = evaluateXPathToString(
      '/*:Comprobante/*:tipoComprobante',
      doc,
      null,
    );
    expect(tipo).toBe('FACTURA');
  });

  it('suma los importes de línea para verificar el total', async () => {
    const { parseXmlDocument } = await import('slimdom');
    const { evaluateXPathToNumber } = await import('fontoxpath');

    const doc = parseXmlDocument(await leer('comprobante-valido.xml'));
    const suma = evaluateXPathToNumber(
      'sum(/*:Comprobante/*:lineas/*:linea/*:importe)',
      doc,
      null,
    );
    expect(suma).toBe(120);
  });
});

describe('XQuery 3.1 — consulta sobre documentos (fontoxpath)', () => {
  it('proyecta las líneas a una estructura de reporte', async () => {
    const { parseXmlDocument } = await import('slimdom');
    const fonto = await import('fontoxpath');

    const doc = parseXmlDocument(await leer('comprobante-valido.xml'));
    const query = `
      for $l in /*:Comprobante/*:lineas/*:linea
      where xs:decimal($l/*:importe) > 50
      return string($l/*:sku)
    `;
    const skus = fonto.evaluateXPathToStrings(query, doc, null, {}, {
      language: fonto.evaluateXPath.XQUERY_3_1_LANGUAGE,
    });
    expect(skus).toEqual(['SH-500ML']);
  });
});

describe('XSLT 3.0 — transformación a UBL (saxon-js)', () => {
  it('transforma el comprobante interno al formato UBL de SUNAT', async () => {
    const SaxonJS = (await import('saxon-js')).default;
    const sef = JSON.parse(await leer('comprobante-a-ubl.sef.json'));

    const salida = SaxonJS.transform(
      {
        stylesheetInternal: sef,
        sourceText: await leer('comprobante-valido.xml'),
        destination: 'serialized',
      },
      'sync',
    ) as { principalResult: string };

    const ubl = salida.principalResult;
    expect(ubl).toContain('<cbc:ID>F001-128</cbc:ID>');
    expect(ubl).toContain('<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>');
    expect(ubl).toContain('schemeID="6"');
    expect(ubl).toContain('20512345678');
  });
});
