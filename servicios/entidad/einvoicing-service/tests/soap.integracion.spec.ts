/**
 * Prueba de integración de la superficie SOAP.
 *
 * Levanta el **servidor SOAP real** con el WSDL de `contratos/wsdl/` y lo
 * consume con el **cliente SOAP real**. Nada simulado en el transporte: es el
 * mismo camino que recorrerá un mensaje hacia SUNAT.
 *
 * Cubre el requisito literal del sílabo (sesiones 5–6, 21): ≥1 servicio expuesto
 * como SOAP con WSDL, funcional e invocable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as soap from 'soap';
import { AuditoriaConsola } from '@pos/service-kit';

import { montarServidorSoap } from '../src/servidor-soap.js';
import { RepositorioComprobantesMemoria } from '../src/repositorio-memoria.js';
import { Emisor } from '../src/emisor.js';
import { GeneradorUbl } from '../src/ubl.js';
import { FirmadorSimulado, FirmadorUbl, ErrorFirma } from '../src/firma.js';
import { ClienteSunatSimulado, ClienteSunatSoap, ErrorSunat } from '../src/cliente-sunat.js';
import type { Comprobante } from '../src/comprobante.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const contratos = resolve(aqui, '..', '..', '..', '..', 'contratos');

const PUERTO = 3905;
const RUTA = '/ol-ti-itcpe/billService';
const URL_WSDL = `http://127.0.0.1:${PUERTO}${RUTA}?wsdl`;

let servidor: Server;
let repositorio: RepositorioComprobantesMemoria;
let auditoria: AuditoriaConsola;
let sunat: ClienteSunatSimulado;

const UUID = '3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17';

const factura = (parcial: Partial<Comprobante> = {}): Comprobante => ({
  uuid: UUID,
  tipoComprobante: 'FACTURA',
  serie: 'F001',
  correlativo: 128,
  fechaEmision: '2026-08-29',
  cliente: {
    tipoDocumento: 'RUC',
    numeroDocumento: '20512345678',
    razonSocial: 'Distribuidora San Miguel S.A.C.',
  },
  lineas: [
    {
      sku: 'SH-500ML',
      descripcion: 'Shampoo anticaspa 500ml',
      cantidad: 3,
      precioUnitario: 25.0,
      importe: 75.0,
    },
  ],
  totalGravado: 63.56,
  totalIgv: 11.44,
  total: 75.0,
  estadoTributario: 'PENDIENTE_ENVIO',
  intentos: 0,
  ...parcial,
});

beforeAll(async () => {
  const [sef, xsd, comunes, wsdl] = await Promise.all([
    readFile(join(contratos, 'xslt', 'comprobante-a-ubl-v1.sef.json'), 'utf-8'),
    readFile(join(contratos, 'xsd', 'einvoicing-v1.xsd'), 'utf-8'),
    readFile(join(contratos, 'xsd', 'tipos-comunes-v1.xsd'), 'utf-8'),
    readFile(join(contratos, 'wsdl', 'einvoicing-v1.wsdl'), 'utf-8'),
  ]);

  repositorio = new RepositorioComprobantesMemoria();
  auditoria = new AuditoriaConsola();
  sunat = new ClienteSunatSimulado();

  servidor = createServer((_req, res) => {
    res.statusCode = 404;
    res.end('404');
  });
  await new Promise<void>((r) => servidor.listen(PUERTO, '127.0.0.1', r));

  await montarServidorSoap({
    servidor,
    ruta: RUTA,
    wsdl,
    repositorio,
    auditoria,
    emisor: new Emisor({
      generador: new GeneradorUbl(sef, xsd, comunes),
      firmador: new FirmadorSimulado(),
      cliente: sunat,
      rucEmisor: '20512345678',
    }),
  });
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

/**
 * El WSDL declara el endpoint canónico del servicio (puerto 3005). En la prueba
 * se sobreescribe para apuntar al servidor efímero. Es el mecanismo estándar de
 * node-soap y refleja lo que hará el ESB al mediar hacia otro entorno.
 */
async function crearCliente() {
  const cliente = await soap.createClientAsync(URL_WSDL);
  cliente.setEndpoint(`http://127.0.0.1:${PUERTO}${RUTA}`);
  return cliente;
}

describe('el servicio EXPONE SOAP con WSDL (sílabo, sesiones 5-6 y 21)', () => {
  it('publica el WSDL en ?wsdl', async () => {
    const res = await fetch(URL_WSDL);
    const cuerpo = await res.text();

    expect(res.status).toBe(200);
    expect(cuerpo).toContain('billService');
    expect(cuerpo).toContain('sendBill');
    expect(cuerpo).toContain('getStatus');
  });

  it('un cliente generado desde el WSDL descubre sus operaciones', async () => {
    const cliente = await crearCliente();
    const descripcion = cliente.describe();

    expect(descripcion['billService']['billPort']).toHaveProperty('sendBill');
    expect(descripcion['billService']['billPort']).toHaveProperty('getStatus');
  });
});

describe('sendBill — el camino real hacia SUNAT', () => {
  it('tramita el comprobante y devuelve el CDR en base64', async () => {
    await repositorio.registrar(factura());

    const cliente = await crearCliente();
    const [resultado] = await cliente.sendBillAsync({
      fileName: '20512345678-01-F001-128.zip',
      contentFile: 'contenido',
    });

    const cdr = Buffer.from(resultado.applicationResponse, 'base64').toString('utf-8');

    expect(cdr).toContain('<ResponseCode>0</ResponseCode>');
    expect(cdr).toContain('F001-128');

    // El comprobante quedó ACEPTADO tras el trámite.
    const guardado = await repositorio.porUuid(UUID);
    expect(guardado?.estadoTributario).toBe('ACEPTADO');
  });

  it('devuelve SOAP Fault si el nombre de archivo no sigue el formato de SUNAT', async () => {
    const cliente = await crearCliente();

    await expect(
      cliente.sendBillAsync({ fileName: 'archivo-cualquiera.txt', contentFile: 'x' }),
    ).rejects.toThrow(/formato/i);
  });

  it('devuelve SOAP Fault si el comprobante no existe', async () => {
    const cliente = await crearCliente();

    await expect(
      cliente.sendBillAsync({
        fileName: '20512345678-01-F001-999.zip',
        contentFile: 'x',
      }),
    ).rejects.toThrow(/No existe/i);
  });

  it('audita la invocación SOAP', async () => {
    await repositorio.registrar(
      factura({ uuid: '8a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d', correlativo: 200 }),
    );
    auditoria.entradas.length = 0;

    const cliente = await crearCliente();
    await cliente.sendBillAsync({
      fileName: '20512345678-01-F001-200.zip',
      contentFile: 'x',
    });

    const entrada = auditoria.entradas.find((e) => e.accion === 'SOAP_SENDBILL');
    expect(entrada?.detalle?.['archivo']).toBe('20512345678-01-F001-200.zip');
  });
});

describe('getStatus — consulta por ticket', () => {
  it('devuelve el estado de un comprobante tramitado', async () => {
    await repositorio.registrar(
      factura({ uuid: 'cccccccc-3333-4333-8333-333333333333', correlativo: 300 }),
    );

    const cliente = await crearCliente();
    await cliente.sendBillAsync({
      fileName: '20512345678-01-F001-300.zip',
      contentFile: 'x',
    });

    const [estado] = await cliente.getStatusAsync({
      ticket: 'cccccccc-3333-4333-8333-333333333333',
    });

    expect(estado.statusCode).toBe('0');
    expect(estado.content).toMatch(/aceptada/i);
  });

  it('responde 404 para un ticket inexistente sin romper', async () => {
    const cliente = await crearCliente();
    const [estado] = await cliente.getStatusAsync({ ticket: 'no-existe' });

    expect(estado.statusCode).toBe('404');
  });
});

describe('firma XMLDSig con clave real', () => {
  it('firma el documento y le incrusta la Signature', () => {
    // Par RSA generado en el test: no hay claves en el repositorio.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const firmador = new FirmadorUbl({
      clavePrivada: privateKey,
      certificado: publicKey,
    });

    const firmado = firmador.firmar(
      '<?xml version="1.0" encoding="UTF-8"?><Invoice><ID>F001-128</ID></Invoice>',
    );

    expect(firmado).toContain('<Signature');
    expect(firmado).toContain('SignatureValue');
    // RSA-SHA256, no SHA1 que está descontinuado.
    expect(firmado).toContain('rsa-sha256');
    // El documento original sigue ahí: la firma es enveloped.
    expect(firmado).toContain('<ID>F001-128</ID>');
  });

  it('rechaza construirse sin credenciales completas', () => {
    expect(() => new FirmadorUbl({ clavePrivada: '', certificado: 'x' })).toThrow(
      ErrorFirma,
    );
  });

  it('un XML mal formado produce ErrorFirma, no un fallo opaco', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const firmador = new FirmadorUbl({
      clavePrivada: privateKey,
      certificado: publicKey,
    });

    expect(() => firmador.firmar('<roto sin cerrar')).toThrow(ErrorFirma);
  });
});

describe('ClienteSunatSoap — el cliente que hablara con SUNAT', () => {
  /**
   * Se apunta al servidor SOAP propio, que expone las mismas operaciones que
   * SUNAT. Es la unica forma de probar el cliente real sin depender de la
   * disponibilidad de SUNAT en cada ejecucion de la suite.
   */
  const credenciales = {
    ruc: '20512345678',
    usuario: 'MODDATOS',
    clave: 'moddatos',
  };

  it('envia el comprobante y interpreta el CDR', async () => {
    await repositorio.registrar(
      factura({ uuid: 'dddddddd-4444-4444-8444-444444444444', correlativo: 400 }),
    );

    const cliente = new ClienteSunatSoap(
      `http://127.0.0.1:${PUERTO}${RUTA}`,
      credenciales,
      5000,
    );

    const respuesta = await cliente.enviarComprobante(
      '20512345678-01-F001-400.zip',
      'contenido',
    );

    expect(respuesta.codigo).toBe('0');
    expect(respuesta.estado).toBe('ACEPTADO');
  });

  it('consulta el estado por ticket', async () => {
    await repositorio.registrar(
      factura({ uuid: 'eeeeeeee-5555-4555-8555-555555555555', correlativo: 500 }),
    );

    const cliente = new ClienteSunatSoap(
      `http://127.0.0.1:${PUERTO}${RUTA}`,
      credenciales,
      5000,
    );
    await cliente.enviarComprobante('20512345678-01-F001-500.zip', 'x');

    const estado = await cliente.consultarEstado('eeeeeeee-5555-4555-8555-555555555555');
    expect(estado.estado).toBe('ACEPTADO');
  });

  it('un endpoint inalcanzable se traduce a error REINTENTABLE de red', async () => {
    const cliente = new ClienteSunatSoap(
      'http://127.0.0.1:59997/no-existe',
      credenciales,
      1500,
    );

    try {
      await cliente.enviarComprobante('20512345678-01-F001-128.zip', 'x');
      expect.unreachable('debio lanzar');
    } catch (e) {
      // Distinguir red de rechazo de negocio decide si se reintenta o no.
      expect(e).toBeInstanceOf(ErrorSunat);
      if (e instanceof ErrorSunat) expect(e.reintentable).toBe(true);
    }
  });

  it('un WSDL que responde 404 es REINTENTABLE, no un rechazo', async () => {
    // El caso que lo destapo en la demo real: el endpoint beta de SUNAT
    // devolvio 404 al pedir el WSDL. Clasificarlo como rechazo definitivo hizo
    // que el orquestador compensara y revirtiera una venta que estaba bien.
    const cliente = new ClienteSunatSoap(
      `http://127.0.0.1:${PUERTO}/ruta-que-no-existe`,
      credenciales,
      3000,
    );

    try {
      await cliente.enviarComprobante('20512345678-01-F001-129.zip', 'x');
      expect.unreachable('debio lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorSunat);
      if (e instanceof ErrorSunat) {
        expect(e.reintentable).toBe(true);
        expect(e.codigo).toBe('RED');
      }
    }
  });

  it('un SOAP Fault de negocio NO es reintentable', async () => {
    const cliente = new ClienteSunatSoap(
      `http://127.0.0.1:${PUERTO}${RUTA}`,
      credenciales,
      5000,
    );

    try {
      // Nombre invalido: el servidor responde SOAP Fault, no un error de red.
      await cliente.enviarComprobante('nombre-invalido.txt', 'x');
      expect.unreachable('debio lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorSunat);
      if (e instanceof ErrorSunat) expect(e.reintentable).toBe(false);
    }
  });
});
