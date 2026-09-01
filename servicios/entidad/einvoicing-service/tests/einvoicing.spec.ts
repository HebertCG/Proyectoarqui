import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';

import { registrarRutas } from '../src/rutas.js';
import { Emisor } from '../src/emisor.js';
import { GeneradorUbl, aXmlCanonico } from '../src/ubl.js';
import { FirmadorSimulado, crearFirmador, ErrorFirma } from '../src/firma.js';
import { RepositorioComprobantesMemoria } from '../src/repositorio-memoria.js';
import { ClienteSunatSimulado, ErrorSunat, interpretarCdr } from '../src/cliente-sunat.js';
import { parsearNombreArchivo } from '../src/servidor-soap.js';
import {
  esperaMs,
  interpretarCodigoSunat,
  nombreArchivoSunat,
  puedeTransicionar,
  transicionar,
  ErrorTransicionInvalida,
  type Comprobante,
} from '../src/comprobante.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const contratos = resolve(aqui, '..', '..', '..', '..', 'contratos');

let app: FastifyInstance;
let auditoria: AuditoriaConsola;
let repositorio: RepositorioComprobantesMemoria;
let sunat: ClienteSunatSimulado;
let generador: GeneradorUbl;

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
  const [sef, xsd, comunes] = await Promise.all([
    readFile(join(contratos, 'xslt', 'comprobante-a-ubl-v1.sef.json'), 'utf-8'),
    readFile(join(contratos, 'xsd', 'einvoicing-v1.xsd'), 'utf-8'),
    readFile(join(contratos, 'xsd', 'tipos-comunes-v1.xsd'), 'utf-8'),
  ]);
  generador = new GeneradorUbl(sef, xsd, comunes);
});

beforeEach(async () => {
  auditoria = new AuditoriaConsola();
  repositorio = new RepositorioComprobantesMemoria();
  sunat = new ClienteSunatSimulado();

  app = await crearServicio({
    config: cargarConfig({
      nombre: 'EInvoicing.Entity',
      puertoPorDefecto: 3005,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria,
  });

  registrarRutas(
    app,
    repositorio,
    new Emisor({
      generador,
      firmador: new FirmadorSimulado(),
      cliente: sunat,
      rucEmisor: '20512345678',
    }),
  );

  await app.ready();
});

const recibir = (c: Partial<Comprobante> = {}) => {
  const { estadoTributario, intentos, ...cuerpo } = factura(c);
  void estadoTributario;
  void intentos;
  return app.inject({ method: 'POST', url: '/comprobantes', payload: cuerpo });
};

const enviar = (uuid = UUID) =>
  app.inject({ method: 'POST', url: `/comprobantes/${uuid}/envio` });

// ══════════════════════════════════════════════════════════════════
//  Máquina de estados tributarios (ADR-002)
// ══════════════════════════════════════════════════════════════════

describe('máquina de estados tributarios', () => {
  it('PENDIENTE_ENVIO puede pasar a ENVIADO', () => {
    expect(puedeTransicionar('PENDIENTE_ENVIO', 'ENVIADO')).toBe(true);
  });

  it('ACEPTADO es terminal: no cambia de estado', () => {
    for (const destino of ['ENVIADO', 'ANULADO', 'RECHAZADO', 'PENDIENTE_ENVIO'] as const) {
      expect(puedeTransicionar('ACEPTADO', destino)).toBe(false);
    }
  });

  it('no se puede saltar de PENDIENTE_ENVIO a ACEPTADO sin pasar por ENVIADO', () => {
    expect(puedeTransicionar('PENDIENTE_ENVIO', 'ACEPTADO')).toBe(false);
  });

  it('un rechazo se corrige y se reenvía', () => {
    expect(puedeTransicionar('RECHAZADO', 'PENDIENTE_ENVIO')).toBe(true);
  });

  it('transicionar lanza con una explicación útil ante un salto ilegal', () => {
    expect(() => transicionar(factura({ estadoTributario: 'ACEPTADO' }), 'ANULADO'))
      .toThrow(ErrorTransicionInvalida);

    expect(() => transicionar(factura({ estadoTributario: 'ACEPTADO' }), 'ANULADO'))
      .toThrow(/nota de crédito/);
  });
});

describe('códigos de SUNAT', () => {
  it('0 es aceptado', () => {
    expect(interpretarCodigoSunat('0')).toBe('ACEPTADO');
  });

  it('2000-3999 es rechazado', () => {
    expect(interpretarCodigoSunat('2033')).toBe('RECHAZADO');
    expect(interpretarCodigoSunat('3999')).toBe('RECHAZADO');
  });

  it('4000+ es observado: aceptado con reparos', () => {
    expect(interpretarCodigoSunat('4000')).toBe('OBSERVADO');
  });

  it('un código no numérico se trata como rechazo', () => {
    expect(interpretarCodigoSunat('ERROR')).toBe('RECHAZADO');
  });
});

describe('nombre de archivo que exige SUNAT', () => {
  it('usa el código del catálogo 01 según el tipo', () => {
    expect(nombreArchivoSunat('20512345678', factura())).toBe(
      '20512345678-01-F001-128.zip',
    );
    expect(
      nombreArchivoSunat('20512345678', factura({ tipoComprobante: 'BOLETA', serie: 'B001' })),
    ).toBe('20512345678-03-B001-128.zip');
    expect(
      nombreArchivoSunat(
        '20512345678',
        factura({ tipoComprobante: 'NOTA_CREDITO', serie: 'N001' }),
      ),
    ).toBe('20512345678-07-N001-128.zip');
  });

  it('el nombre se puede volver a parsear', () => {
    const nombre = nombreArchivoSunat('20512345678', factura());
    expect(parsearNombreArchivo(nombre)).toEqual({ serie: 'F001', correlativo: 128 });
  });

  it('rechaza un nombre con formato inválido', () => {
    expect(parsearNombreArchivo('cualquier-cosa.zip')).toBeNull();
  });
});

describe('backoff exponencial (RF-SYNC-06)', () => {
  it('duplica la espera en cada intento', () => {
    expect(esperaMs(1)).toBe(60_000);
    expect(esperaMs(2)).toBe(120_000);
    expect(esperaMs(3)).toBe(240_000);
  });

  it('tiene techo de una hora: un comprobante no se queda colgado días', () => {
    expect(esperaMs(50)).toBe(3_600_000);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Generación de UBL
// ══════════════════════════════════════════════════════════════════

describe('GeneradorUbl', () => {
  it('produce UBL 2.1 con los códigos correctos de SUNAT', async () => {
    const ubl = await generador.generar(factura());

    expect(ubl).toContain('<cbc:ID>F001-128</cbc:ID>');
    // Catálogo 01: 01 = Factura
    expect(ubl).toContain('<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>');
    // Catálogo 06: 6 = RUC
    expect(ubl).toContain('schemeID="6"');
    expect(ubl).toContain('20512345678');
  });

  it('la BOLETA lleva el código 03 y el DNI el schemeID 1', async () => {
    const ubl = await generador.generar(
      factura({
        tipoComprobante: 'BOLETA',
        serie: 'B001',
        cliente: {
          tipoDocumento: 'DNI',
          numeroDocumento: '45678912',
          razonSocial: 'Juan Pérez',
        },
      }),
    );

    expect(ubl).toContain('<cbc:InvoiceTypeCode>03</cbc:InvoiceTypeCode>');
    expect(ubl).toContain('schemeID="1"');
  });

  it('genera una línea UBL por cada línea del comprobante', async () => {
    const ubl = await generador.generar(
      factura({
        lineas: [
          { sku: 'IT-01', descripcion: 'Uno', cantidad: 1, precioUnitario: 10, importe: 10 },
          { sku: 'IT-02', descripcion: 'Dos', cantidad: 2, precioUnitario: 20, importe: 40 },
        ],
        total: 50,
        totalGravado: 42.37,
        totalIgv: 7.63,
      }),
    );

    expect(ubl.match(/<cac:InvoiceLine>/g)).toHaveLength(2);
  });

  it('escapa caracteres especiales de la razón social', async () => {
    const xml = aXmlCanonico(
      factura({
        cliente: {
          tipoDocumento: 'RUC',
          numeroDocumento: '20512345678',
          razonSocial: 'Perez & Hijos <SAC>',
        },
      }),
    );

    expect(xml).toContain('Perez &amp; Hijos &lt;SAC&gt;');
  });

  it('valida contra el XSD antes de transformar', async () => {
    // Serie inválida: el XSD debe rechazarla antes de llegar a SUNAT.
    await expect(generador.generar(factura({ serie: 'XX' }))).rejects.toThrow();
  });

  it('el cliente GENERICO no lleva número de documento', async () => {
    const xml = aXmlCanonico(
      factura({
        tipoComprobante: 'NOTA_VENTA',
        serie: 'N001',
        cliente: { tipoDocumento: 'GENERICO', razonSocial: 'Cliente varios' },
      }),
    );

    expect(xml).not.toContain('<numeroDocumento>');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Firma
// ══════════════════════════════════════════════════════════════════

describe('firma digital', () => {
  it('el firmador simulado marca el XML explícitamente', () => {
    const firmado = new FirmadorSimulado().firmar('<?xml version="1.0"?><a/>');

    // Imposible confundirlo con uno firmado de verdad.
    expect(firmado).toContain('SIN FIRMA DIGITAL REAL');
  });

  it('en desarrollo sin certificado devuelve el simulado', () => {
    expect(crearFirmador('development')).toBeInstanceOf(FirmadorSimulado);
  });

  it('en PRODUCCIÓN sin certificado falla al arrancar', () => {
    // Descubrir esto en SUNAT sería mucho más caro que fallar aquí.
    expect(() => crearFirmador('production')).toThrow(ErrorFirma);
    expect(() => crearFirmador('production')).toThrow(/SUNAT rechaza/);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Emisión
// ══════════════════════════════════════════════════════════════════

describe('RecibirComprobante', () => {
  it('acepta con 202 y lo deja PENDIENTE_ENVIO', async () => {
    const r = await recibir();

    expect(r.statusCode).toBe(202);
    expect(r.json().datos.comprobante.estadoTributario).toBe('PENDIENTE_ENVIO');
    expect(r.json().datos.duplicado).toBe(false);
  });

  it('es idempotente: reenviar no duplica (RF-SYNC-07)', async () => {
    await recibir();
    const segundo = await recibir();

    expect(segundo.statusCode).toBe(200);
    expect(segundo.json().datos.duplicado).toBe(true);
    expect(repositorio.tamano).toBe(1);
  });

  it('rechaza una serie con formato inválido', async () => {
    const r = await recibir({ serie: 'XXXX' as never });
    expect(r.statusCode).toBe(400);
  });

  it('rechaza un comprobante sin líneas', async () => {
    const { estadoTributario, intentos, ...cuerpo } = factura();
    void estadoTributario;
    void intentos;

    const r = await app.inject({
      method: 'POST',
      url: '/comprobantes',
      payload: { ...cuerpo, lineas: [] },
    });

    expect(r.statusCode).toBe(400);
  });

  it('audita la recepción', async () => {
    await recibir();

    const entrada = auditoria.entradas.find((e) => e.accion === 'COMPROBANTE_RECIBIDO');
    expect(entrada?.detalle?.['documento']).toBe('F001-128');
  });
});

describe('EnviarComprobante', () => {
  it('envía a SUNAT y queda ACEPTADO', async () => {
    await recibir();
    const r = await enviar();
    const d = r.json().datos;

    expect(r.statusCode).toBe(200);
    expect(d.comprobante.estadoTributario).toBe('ACEPTADO');
    expect(d.comprobante.respuestaSunat.codigo).toBe('0');
    expect(sunat.enviados).toHaveLength(1);
  });

  it('manda el archivo con el nombre que exige SUNAT', async () => {
    await recibir();
    await enviar();

    expect(sunat.enviados[0]?.nombreArchivo).toBe('20512345678-01-F001-128.zip');
  });

  it('el contenido va comprimido y en base64', async () => {
    await recibir();
    await enviar();

    const contenido = sunat.enviados[0]?.contenidoZip ?? '';
    expect(contenido).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // gzip empieza por 0x1f 0x8b
    expect(Buffer.from(contenido, 'base64').subarray(0, 2)).toEqual(
      Buffer.from([0x1f, 0x8b]),
    );
  });

  it('un rechazo de SUNAT NO es error HTTP: la operación se ejecutó', async () => {
    await recibir();
    sunat.respuestaForzada = {
      codigo: '2033',
      descripcion: 'El documento ya fue informado',
      estado: 'RECHAZADO',
    };

    const r = await enviar();

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.comprobante.estadoTributario).toBe('RECHAZADO');
  });

  it('un fallo de RED devuelve el comprobante a la cola', async () => {
    await recibir();
    sunat.errorForzado = new ErrorSunat('RED', 'timeout', true);

    const d = (await enviar()).json().datos;

    expect(d.comprobante.estadoTributario).toBe('PENDIENTE_ENVIO');
    expect(d.reintentable).toBe(true);
    expect(d.comprobante.intentos).toBe(1);
  });

  it('un rechazo de NEGOCIO no se reintenta', async () => {
    await recibir();
    sunat.errorForzado = new ErrorSunat('SOAP_FAULT', 'RUC inválido', false);

    const d = (await enviar()).json().datos;

    expect(d.comprobante.estadoTributario).toBe('RECHAZADO');
    expect(d.reintentable).toBe(false);
  });

  it('la NOTA_VENTA no se envía: no es comprobante fiscal', async () => {
    await recibir({ tipoComprobante: 'NOTA_VENTA', serie: 'N001' });

    const d = (await enviar()).json().datos;

    expect(sunat.enviados).toHaveLength(0);
    expect(d.error).toMatch(/no es comprobante fiscal/);
  });

  it('no se puede reenviar un comprobante ya ACEPTADO', async () => {
    await recibir();
    await enviar();

    const d = (await enviar()).json().datos;

    expect(d.error).toMatch(/Transición inválida/);
    expect(sunat.enviados).toHaveLength(1);
  });

  it('cuenta los intentos, que alimentan el backoff', async () => {
    await recibir();
    sunat.errorForzado = new ErrorSunat('RED', 'timeout', true);

    await enviar();
    const d = (await enviar()).json().datos;

    expect(d.comprobante.intentos).toBe(2);
  });

  it('audita el resultado con el código de SUNAT', async () => {
    await recibir();
    await enviar();

    const entrada = auditoria.entradas.find((e) => e.accion === 'COMPROBANTE_ACEPTADO');
    expect(entrada?.detalle?.['codigoSunat']).toBe('0');
  });

  it('404 si el comprobante no existe', async () => {
    const r = await enviar('8a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d');
    expect(r.statusCode).toBe(404);
  });
});

describe('consultas', () => {
  it('devuelve el comprobante por uuid', async () => {
    await recibir();
    const r = await app.inject({ method: 'GET', url: `/comprobantes/${UUID}` });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.serie).toBe('F001');
  });

  it('devuelve el comprobante por serie y correlativo', async () => {
    await recibir();
    const r = await app.inject({ method: 'GET', url: '/comprobantes/serie/F001/128' });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.uuid).toBe(UUID);
  });

  it('404 con envelope si la serie no existe', async () => {
    const r = await app.inject({ method: 'GET', url: '/comprobantes/serie/F001/999' });

    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe('COMPROBANTE_NO_ENCONTRADO');
  });

  it('lista los pendientes para el worker de envío', async () => {
    await recibir();
    await recibir({ uuid: '8a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d', correlativo: 129 });

    const r = await app.inject({ method: 'GET', url: '/comprobantes/pendientes' });

    expect(r.json().datos).toHaveLength(2);
  });

  it('un comprobante aceptado ya no figura como pendiente', async () => {
    await recibir();
    await enviar();

    const r = await app.inject({ method: 'GET', url: '/comprobantes/pendientes' });
    expect(r.json().datos).toHaveLength(0);
  });

  it('busca por estado — lo consume Analytics para consolidar series', async () => {
    await recibir();
    await recibir({ uuid: '8a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d', correlativo: 129 });
    await enviar();

    const r = await app.inject({ method: 'GET', url: '/comprobantes?estado=ACEPTADO' });

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
  });
});

describe('interpretación del CDR', () => {
  it('extrae código y descripción del XML de SUNAT', () => {
    const cdr = Buffer.from(
      '<ApplicationResponse><cbc:ResponseCode>0</cbc:ResponseCode>' +
        '<cbc:Description>La Factura F001-128 ha sido aceptada</cbc:Description>' +
        '</ApplicationResponse>',
    ).toString('base64');

    const r = interpretarCdr(cdr);

    expect(r.codigo).toBe('0');
    expect(r.estado).toBe('ACEPTADO');
    expect(r.descripcion).toMatch(/aceptada/);
  });

  it('un CDR con código de rechazo se interpreta como tal', () => {
    const cdr = Buffer.from(
      '<ApplicationResponse><ResponseCode>2033</ResponseCode>' +
        '<Description>El documento ya fue informado</Description></ApplicationResponse>',
    ).toString('base64');

    expect(interpretarCdr(cdr).estado).toBe('RECHAZADO');
  });
});
