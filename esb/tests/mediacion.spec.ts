/**
 * Pruebas de la mediación de protocolos — el caso estrella del PROY
 * (sesiones 31-32, "Servicio bus").
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransformadorXslt } from '@pos/xml-kit';

import {
  MediadorRestASoap,
  MediadorSoapARest,
  desenvolverSoap,
  envolverEnSoap,
  esSoapFault,
  jsonAXml,
  traducirFault,
  xmlAJson,
} from '../src/mediacion.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const contratos = resolve(aqui, '..', '..', 'contratos');

const NS = 'urn:pos:einvoicing:v1';

let transformacion: TransformadorXslt;

beforeAll(async () => {
  const sef = await readFile(
    join(contratos, 'xslt', 'comprobante-a-ubl-v1.sef.json'),
    'utf-8',
  );
  transformacion = new TransformadorXslt(sef, 'comprobante-a-ubl-v1');
});

// ══════════════════════════════════════════════════════════════════
//  Sobre SOAP
// ══════════════════════════════════════════════════════════════════

describe('sobre SOAP', () => {
  it('envuelve un documento XML', () => {
    const sobre = envolverEnSoap(
      '<?xml version="1.0"?><Doc><id>1</id></Doc>',
      NS,
      'sendBill',
    );

    expect(sobre).toContain('soap:Envelope');
    expect(sobre).toContain('<ns:sendBill');
    expect(sobre).toContain('<Doc><id>1</id></Doc>');
  });

  it('descarta la declaración XML interior: solo puede haber una', () => {
    const sobre = envolverEnSoap('<?xml version="1.0"?><Doc/>', NS, 'sendBill');

    expect(sobre.match(/<\?xml/g)).toHaveLength(1);
  });

  it('desenvolver recupera el contenido del Body', () => {
    const sobre = envolverEnSoap('<Doc><id>1</id></Doc>', NS, 'sendBill');
    const contenido = desenvolverSoap(sobre);

    expect(contenido).toContain('<Doc><id>1</id></Doc>');
    expect(contenido).not.toContain('Envelope');
  });

  it('desenvolver devuelve el original si no hay Body', () => {
    expect(desenvolverSoap('<suelto/>')).toBe('<suelto/>');
  });
});

describe('detección y traducción de SOAP Fault', () => {
  const fault11 =
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    '<soap:Fault><faultcode>soap:Client</faultcode>' +
    '<faultstring>El RUC del emisor no está habilitado</faultstring>' +
    '</soap:Fault></soap:Body></soap:Envelope>';

  const fault12 =
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
    '<soap:Fault><soap:Code><soap:Value>soap:Sender</soap:Value>' +
    '<soap:Subcode><soap:Value>rpc:BadArguments</soap:Value></soap:Subcode></soap:Code>' +
    '<soap:Reason><soap:Text>Nombre de archivo inválido</soap:Text></soap:Reason>' +
    '</soap:Fault></soap:Body></soap:Envelope>';

  it('detecta un fault', () => {
    expect(esSoapFault(fault11)).toBe(true);
    expect(esSoapFault('<soap:Envelope><soap:Body><ok/></soap:Body></soap:Envelope>'))
      .toBe(false);
  });

  it('traduce un fault SOAP 1.1', () => {
    const f = traducirFault(fault11);

    expect(f.codigo).toBe('soap:Client');
    expect(f.razon).toMatch(/RUC del emisor/);
  });

  it('traduce un fault SOAP 1.2 prefiriendo el Subcode', () => {
    const f = traducirFault(fault12);

    expect(f.codigo).toBe('rpc:BadArguments');
    expect(f.razon).toBe('Nombre de archivo inválido');
  });

  it('un fault sin descripción no deja al llamante a ciegas', () => {
    const f = traducirFault(
      '<Envelope><Body><Fault><Code><Value>x</Value></Code></Fault></Body></Envelope>',
    );

    expect(f.razon).toMatch(/sin descripción/);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Conversión JSON ⇄ XML
// ══════════════════════════════════════════════════════════════════

describe('jsonAXml', () => {
  it('convierte un objeto plano', () => {
    const xml = jsonAXml({ serie: 'F001', correlativo: 128 }, 'Comprobante', NS);

    expect(xml).toContain(`<Comprobante xmlns="${NS}">`);
    expect(xml).toContain('<serie>F001</serie>');
    expect(xml).toContain('<correlativo>128</correlativo>');
  });

  it('convierte objetos anidados', () => {
    const xml = jsonAXml(
      { cliente: { tipoDocumento: 'RUC', razonSocial: 'ACME' } },
      'Doc',
      NS,
    );

    expect(xml).toContain('<cliente><tipoDocumento>RUC</tipoDocumento>');
  });

  it('repite el elemento por cada item del array', () => {
    const xml = jsonAXml({ linea: [{ sku: 'A1' }, { sku: 'B2' }] }, 'Doc', NS);

    expect(xml.match(/<linea>/g)).toHaveLength(2);
  });

  it('omite null y undefined en vez de emitir elementos vacíos', () => {
    const xml = jsonAXml({ a: 'x', b: null, c: undefined }, 'Doc', NS);

    expect(xml).toContain('<a>x</a>');
    expect(xml).not.toContain('<b>');
    expect(xml).not.toContain('<c>');
  });

  it('escapa caracteres especiales', () => {
    const xml = jsonAXml({ razonSocial: 'Perez & Hijos <SAC>' }, 'Doc', NS);

    expect(xml).toContain('Perez &amp; Hijos &lt;SAC&gt;');
  });
});

describe('xmlAJson', () => {
  it('convierte XML a objeto', () => {
    const obj = xmlAJson('<Doc xmlns="urn:x"><serie>F001</serie><total>120</total></Doc>');

    expect(obj['serie']).toBe('F001');
    expect(obj['total']).toBe('120');
  });

  it('agrupa elementos repetidos en un array', () => {
    const obj = xmlAJson(
      '<Doc xmlns="urn:x"><linea><sku>A1</sku></linea><linea><sku>B2</sku></linea></Doc>',
    );

    expect(Array.isArray(obj['linea'])).toBe(true);
    expect((obj['linea'] as unknown[]).length).toBe(2);
  });

  it('descarta el prefijo de namespace en los nombres', () => {
    const obj = xmlAJson(
      '<ns:Doc xmlns:ns="urn:x"><ns:serie>F001</ns:serie></ns:Doc>',
    );

    expect(obj['serie']).toBe('F001');
  });

  it('ida y vuelta conserva los valores', () => {
    const original = { serie: 'F001', cliente: { razonSocial: 'ACME SAC' } };
    const vuelta = xmlAJson(jsonAXml(original, 'Doc', NS));

    expect(vuelta['serie']).toBe('F001');
    expect((vuelta['cliente'] as Record<string, unknown>)['razonSocial']).toBe('ACME SAC');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Mediación completa REST ⇄ SOAP
// ══════════════════════════════════════════════════════════════════

describe('MediadorRestASoap — el caso que justifica el bus', () => {
  const comprobanteJson = {
    uuid: '3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17',
    tipoComprobante: 'FACTURA',
    serie: 'F001',
    correlativo: 128,
    fechaEmision: '2026-08-29',
    cliente: {
      tipoDocumento: 'RUC',
      numeroDocumento: '20512345678',
      razonSocial: 'Distribuidora San Miguel S.A.C.',
    },
    lineas: {
      linea: [
        {
          sku: 'SH-500ML',
          descripcion: 'Shampoo anticaspa 500ml',
          cantidad: 3,
          precioUnitario: '25.00',
          importe: '75.00',
        },
      ],
    },
    totalGravado: '63.56',
    totalIgv: '11.44',
    total: '75.00',
    estadoTributario: 'PENDIENTE_ENVIO',
  };

  it('convierte JSON del POS en un sobre SOAP con UBL dentro', () => {
    const mediador = new MediadorRestASoap({
      transformacion,
      namespaceOperacion: 'urn:pos:einvoicing:bill:v1',
      operacion: 'sendBill',
    });

    const resultado = mediador.mediar(comprobanteJson, 'Comprobante', NS);

    // Sobre SOAP…
    expect(resultado.cuerpo).toContain('soap:Envelope');
    expect(resultado.cuerpo).toContain('<ns:sendBill');
    // …con UBL de SUNAT dentro.
    expect(resultado.cuerpo).toContain('<cbc:ID>F001-128</cbc:ID>');
    expect(resultado.cuerpo).toContain('<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>');
    expect(resultado.cuerpo).toContain('schemeID="6"');
  });

  it('declara el content-type y el SOAPAction del destino', () => {
    const mediador = new MediadorRestASoap({
      transformacion,
      namespaceOperacion: 'urn:pos:einvoicing:bill:v1',
      operacion: 'sendBill',
    });

    const r = mediador.mediar(comprobanteJson, 'Comprobante', NS);

    expect(r.contentType).toBe('text/xml; charset=utf-8');
    expect(r.soapAction).toBe('urn:sendBill');
  });

  it('sin transformación, envuelve el XML canónico tal cual', () => {
    const mediador = new MediadorRestASoap({
      namespaceOperacion: 'urn:x',
      operacion: 'op',
    });

    const r = mediador.mediar({ a: 1 }, 'Doc', NS);

    expect(r.cuerpo).toContain('<a>1</a>');
  });
});

describe('MediadorSoapARest — la respuesta de vuelta', () => {
  const mediador = new MediadorSoapARest();

  it('convierte una respuesta SOAP en envelope REST de éxito', () => {
    const sobre =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<sendBillResponse><applicationResponse>abc123</applicationResponse></sendBillResponse>' +
      '</soap:Body></soap:Envelope>';

    const r = mediador.mediar(sobre);

    expect(r.estado).toBe(200);
    const cuerpo = r.cuerpo as { exito: boolean; datos: Record<string, unknown> };
    expect(cuerpo.exito).toBe(true);
    expect(cuerpo.datos['applicationResponse']).toBe('abc123');
  });

  it('un SOAP Fault se traduce a 422 con el envelope de error', () => {
    const sobre =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<soap:Fault><faultcode>soap:Client</faultcode>' +
      '<faultstring>El RUC no está habilitado</faultstring>' +
      '</soap:Fault></soap:Body></soap:Envelope>';

    const r = mediador.mediar(sobre);

    // 422 y no 500: el destino respondió, y su respuesta fue un rechazo de
    // negocio. El bus no falló.
    expect(r.estado).toBe(422);
    const cuerpo = r.cuerpo as { exito: boolean; error: { codigo: string; mensaje: string } };
    expect(cuerpo.exito).toBe(false);
    expect(cuerpo.error.codigo).toBe('soap:Client');
    expect(cuerpo.error.mensaje).toMatch(/RUC no está habilitado/);
  });
});

describe('ida y vuelta completa REST → SOAP → REST', () => {
  it('el POS envía JSON y recibe JSON, sin saber que hubo SOAP en medio', () => {
    const aSoap = new MediadorRestASoap({
      transformacion,
      namespaceOperacion: 'urn:pos:einvoicing:bill:v1',
      operacion: 'sendBill',
    });
    const aRest = new MediadorSoapARest();

    // El POS manda JSON…
    const peticion = aSoap.mediar(
      { uuid: 'x', serie: 'F001', correlativo: 1 },
      'Comprobante',
      NS,
    );
    expect(peticion.cuerpo).toContain('soap:Envelope');

    // …SUNAT responde SOAP…
    const respuestaSoap =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<respuesta><codigo>0</codigo><descripcion>Aceptada</descripcion></respuesta>' +
      '</soap:Body></soap:Envelope>';

    // …y el POS recibe JSON.
    const respuesta = aRest.mediar(respuestaSoap);
    const datos = (respuesta.cuerpo as { datos: Record<string, unknown> }).datos;

    expect(respuesta.estado).toBe(200);
    // El elemento raiz del Body se descarta: sus hijos son las claves.
    expect(datos['codigo']).toBe('0');
    expect(datos['descripcion']).toBe('Aceptada');
  });
});
