/**
 * Arranque de `E-Invoicing Service`.
 *
 * Levanta dos superficies sobre el mismo proceso:
 *
 *   - **REST/JSON** en `/comprobantes` — así habla el resto del inventario
 *   - **SOAP/WSDL** en `/ol-ti-itcpe/billService` — el requisito del sílabo, y
 *     el mismo protocolo que exige SUNAT
 *
 * Esa coexistencia es lo que da sentido a la mediación del ESB (CLAUDE.md §5.3).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crearServicio, cargarConfig, AuditoriaHttp } from '@pos/service-kit';

import { Emisor } from './emisor.js';
import { GeneradorUbl } from './ubl.js';
import { crearFirmador } from './firma.js';
import { registrarRutas } from './rutas.js';
import { montarServidorSoap } from './servidor-soap.js';
import { RepositorioComprobantesMemoria } from './repositorio-memoria.js';
import { ClienteSunatSimulado, ClienteSunatSoap } from './cliente-sunat.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..', '..', '..', '..');
const contratos = join(raiz, 'contratos');

const RUTA_SOAP = '/ol-ti-itcpe/billService';

const config = cargarConfig({
  nombre: 'EInvoicing.Entity',
  puertoPorDefecto: 3005,
});

const [sefXslt, xsdComprobante, xsdComunes, wsdl] = await Promise.all([
  readFile(join(contratos, 'xslt', 'comprobante-a-ubl-v1.sef.json'), 'utf-8'),
  readFile(join(contratos, 'xsd', 'einvoicing-v1.xsd'), 'utf-8'),
  readFile(join(contratos, 'xsd', 'tipos-comunes-v1.xsd'), 'utf-8'),
  readFile(join(contratos, 'wsdl', 'einvoicing-v1.wsdl'), 'utf-8'),
]);

const rucEmisor = process.env['SUNAT_RUC'] ?? '20000000001';

// Sin endpoint configurado se usa el simulador. Su naturaleza queda declarada
// en el log, para que nadie confunda una demo con un envío real.
const usarSimulador = process.env['SUNAT_ENDPOINT'] === undefined;

const cliente = usarSimulador
  ? new ClienteSunatSimulado()
  : new ClienteSunatSoap(process.env['SUNAT_ENDPOINT'] as string, {
      ruc: rucEmisor,
      usuario: process.env['SUNAT_USUARIO_SOL'] ?? 'MODDATOS',
      clave: process.env['SUNAT_CLAVE_SOL'] ?? 'moddatos',
    });

const emisor = new Emisor({
  generador: new GeneradorUbl(sefXslt, xsdComprobante, xsdComunes),
  // Sin certificado en desarrollo se marca el XML explícitamente; en producción
  // falla al arrancar, porque SUNAT rechaza lo que no viene firmado.
  firmador: crearFirmador(config.entorno, {
    clavePrivada: process.env['SUNAT_CLAVE_PRIVADA'],
    certificado: process.env['SUNAT_CERTIFICADO'],
  }),
  cliente,
  rucEmisor,
});

const auditoria = new AuditoriaHttp(config.urlAuditoria ?? 'http://localhost:3012');
const repositorio = new RepositorioComprobantesMemoria();

const app = await crearServicio({ config, auditoria });
registrarRutas(app, repositorio, emisor);

await app.listen({ port: config.puerto, host: '0.0.0.0' });

// El servidor SOAP se monta sobre el mismo servidor HTTP de Fastify.
await montarServidorSoap({
  servidor: app.server,
  ruta: RUTA_SOAP,
  wsdl,
  repositorio,
  emisor,
  auditoria,
});

app.log.info(
  {
    rest: '/comprobantes',
    soap: `${RUTA_SOAP}?wsdl`,
    sunat: usarSimulador ? 'SIMULADO' : process.env['SUNAT_ENDPOINT'],
    firma: process.env['SUNAT_CERTIFICADO'] ? 'real' : 'simulada',
  },
  'superficies expuestas',
);
