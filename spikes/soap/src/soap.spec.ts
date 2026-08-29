/**
 * SPIKE — node-soap como servidor y como cliente.
 *
 * Valida lo que la Fase 6 (EInvoicing) da por sentado:
 *   1. Exponer un WSDL propio y servirlo por HTTP
 *   2. Consumirlo desde un cliente generado a partir de ese WSDL
 *   3. Aplicar WS-Security UsernameToken (lo que exige SUNAT)
 *   4. Devolver un SOAP Fault correctamente tipado
 *
 * Si esto falla, hay que cambiar de librería SOAP antes de comprometer la Fase 6.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as soap from 'soap';

const here = dirname(fileURLToPath(import.meta.url));
const wsdlPath = join(here, '..', 'fixtures', 'billService.wsdl');

const PUERTO = 8099;
const RUTA = '/ol-ti-itcpe/billService';
const URL_WSDL = `http://localhost:${PUERTO}${RUTA}?wsdl`;

/** Credenciales que el servidor espera en el UsernameToken. */
const USUARIO = '20512345678MODDATOS';
const CLAVE = 'moddatos';

/** Guarda la última cabecera de seguridad recibida, para poder afirmarla. */
let ultimoUsuario: string | null = null;

const servicio = {
  billService: {
    billPort: {
      sendBill(args: { fileName: string; contentFile: string }) {
        if (!args.fileName?.endsWith('.zip')) {
          throw {
            Fault: {
              Code: { Value: 'soap:Sender', Subcode: { value: 'rpc:BadArguments' } },
              Reason: { Text: 'El nombre de archivo debe terminar en .zip' },
              statusCode: 400,
            },
          };
        }
        // Devuelve un CDR simulado (en SUNAT real viene un ZIP con el XML de respuesta)
        const cdr = Buffer.from(
          `<ApplicationResponse><ResponseCode>0</ResponseCode>` +
            `<Description>La ${args.fileName} ha sido aceptada</Description>` +
            `</ApplicationResponse>`,
        ).toString('base64');
        return { applicationResponse: cdr };
      },
      getStatus(args: { ticket: string }) {
        return { statusCode: '0', content: `Ticket ${args.ticket} procesado` };
      },
    },
  },
};

let servidor: Server;

beforeAll(async () => {
  const wsdl = await readFile(wsdlPath, 'utf-8');
  servidor = createServer((_req, res) => {
    res.statusCode = 404;
    res.end('404');
  });
  await new Promise<void>((r) => servidor.listen(PUERTO, r));

  const soapServer = soap.listen(servidor, RUTA, servicio, wsdl);
  // Captura el UsernameToken entrante para comprobar que llegó
  soapServer.on('headers', (headers: Record<string, unknown>) => {
    const sec = headers?.['Security'] as
      | { UsernameToken?: { Username?: string } }
      | undefined;
    ultimoUsuario = sec?.UsernameToken?.Username ?? null;
  });
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

describe('node-soap como servidor', () => {
  it('publica el WSDL en ?wsdl', async () => {
    const res = await fetch(URL_WSDL);
    const cuerpo = await res.text();
    expect(res.status).toBe(200);
    expect(cuerpo).toContain('billService');
    expect(cuerpo).toContain('sendBill');
  });
});

describe('node-soap como cliente', () => {
  it('genera el cliente desde el WSDL y descubre sus operaciones', async () => {
    const cliente = await soap.createClientAsync(URL_WSDL);
    const desc = cliente.describe();
    expect(desc['billService']['billPort']).toHaveProperty('sendBill');
    expect(desc['billService']['billPort']).toHaveProperty('getStatus');
  });

  it('envía un comprobante y recibe el CDR', async () => {
    const cliente = await soap.createClientAsync(URL_WSDL);
    const [resultado] = await cliente.sendBillAsync({
      fileName: '20512345678-01-F001-128.zip',
      contentFile: Buffer.from('contenido-ubl-zip').toString('base64'),
    });

    const cdr = Buffer.from(resultado.applicationResponse, 'base64').toString('utf-8');
    expect(cdr).toContain('<ResponseCode>0</ResponseCode>');
    expect(cdr).toContain('ha sido aceptada');
  });

  it('aplica WS-Security UsernameToken y el servidor lo recibe', async () => {
    const cliente = await soap.createClientAsync(URL_WSDL);
    cliente.setSecurity(new soap.WSSecurity(USUARIO, CLAVE, { passwordType: 'PasswordText' }));

    await cliente.getStatusAsync({ ticket: '1234567890' });

    expect(ultimoUsuario).toBe(USUARIO);
  });

  it('propaga un SOAP Fault como error tipado', async () => {
    const cliente = await soap.createClientAsync(URL_WSDL);
    await expect(
      cliente.sendBillAsync({ fileName: 'archivo-sin-extension', contentFile: 'x' }),
    ).rejects.toThrow(/zip/i);
  });
});
