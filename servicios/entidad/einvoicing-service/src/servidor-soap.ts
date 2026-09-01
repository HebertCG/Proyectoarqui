/**
 * Servidor SOAP de `E-Invoicing Service`.
 *
 * Expone `contratos/wsdl/einvoicing-v1.wsdl` con las mismas operaciones que el
 * `billService` de SUNAT: `sendBill` y `getStatus`.
 *
 * **Por qué el servicio expone SOAP además de consumirlo:** el sílabo exige
 * ≥1 servicio expuesto como SOAP con WSDL (sesiones 5–6 y 21). Y tiene sentido
 * de diseño: cualquier sistema externo que ya hable con SUNAT puede integrarse
 * con este servicio sin cambiar de protocolo.
 *
 * Es también el otro extremo de la mediación del ESB: entra REST/JSON del POS,
 * sale SOAP/XML por aquí.
 */
import type { Server } from 'node:http';
import type { ClienteAuditoria } from '@pos/service-kit';

import { interpretarCodigoSunat, type Comprobante } from './comprobante.js';
import type { RepositorioComprobantes } from './repositorio.js';
import type { Emisor } from './emisor.js';

export interface OpcionesSoap {
  servidor: Server;
  ruta: string;
  wsdl: string;
  repositorio: RepositorioComprobantes;
  emisor: Emisor;
  auditoria: ClienteAuditoria;
}

interface ArgsSendBill {
  fileName: string;
  contentFile: string;
}

interface ArgsGetStatus {
  ticket: string;
}

/** Un SOAP Fault con la forma que espera node-soap. */
function fault(subcodigo: string, razon: string, estado = 400) {
  return {
    Fault: {
      Code: { Value: 'soap:Sender', Subcode: { value: subcodigo } },
      Reason: { Text: razon },
      statusCode: estado,
    },
  };
}

/**
 * Del nombre de archivo de SUNAT se extrae serie y correlativo:
 * `20512345678-01-F001-128.zip` → `F001`, `128`.
 */
export function parsearNombreArchivo(
  nombre: string,
): { serie: string; correlativo: number } | null {
  const m = nombre.match(/^\d{11}-\d{2}-([BFN][A-Z0-9]{3})-(\d+)\.zip$/i);
  if (!m?.[1] || !m[2]) return null;

  return { serie: m[1].toUpperCase(), correlativo: Number(m[2]) };
}

export async function montarServidorSoap(opciones: OpcionesSoap): Promise<void> {
  const soap = await import('soap');
  const { repositorio, emisor, auditoria } = opciones;

  const servicio = {
    billService: {
      billPort: {
        /**
         * Recibe un comprobante ya empaquetado y dispara su trámite.
         *
         * Devuelve el CDR en base64, igual que SUNAT.
         */
        async sendBill(args: ArgsSendBill) {
          const referencia = parsearNombreArchivo(args.fileName);

          if (!referencia) {
            throw fault(
              'rpc:BadArguments',
              'El nombre de archivo debe seguir el formato ' +
                '{RUC}-{tipo}-{serie}-{correlativo}.zip',
            );
          }

          const comprobante = await repositorio.porSerie(
            referencia.serie,
            referencia.correlativo,
          );

          if (!comprobante) {
            throw fault(
              'rpc:NotFound',
              `No existe el comprobante ${referencia.serie}-${referencia.correlativo}.`,
              404,
            );
          }

          const resultado = await emisor.emitir(comprobante);
          await repositorio.guardar(resultado.comprobante);

          await auditoria.registrar({
            correlationId: comprobante.uuid,
            servicio: 'EInvoicing.Entity',
            accion: 'SOAP_SENDBILL',
            recurso: 'comprobante',
            recursoId: comprobante.uuid,
            usuario: 'sistema',
            timestamp: new Date().toISOString(),
            detalle: {
              archivo: args.fileName,
              estado: resultado.comprobante.estadoTributario,
            },
          });

          return { applicationResponse: construirCdr(resultado.comprobante) };
        },

        async getStatus(args: ArgsGetStatus) {
          const comprobante = await repositorio.porUuid(args.ticket);

          if (!comprobante) {
            return { statusCode: '404', content: `Ticket ${args.ticket} no encontrado` };
          }

          return {
            statusCode: comprobante.respuestaSunat?.codigo ?? '98',
            content:
              comprobante.respuestaSunat?.descripcion ??
              `Comprobante en estado ${comprobante.estadoTributario}`,
          };
        },
      },
    },
  };

  soap.listen(opciones.servidor, opciones.ruta, servicio, opciones.wsdl);
}

/** CDR con la misma forma que devuelve SUNAT. */
function construirCdr(comprobante: Comprobante): string {
  const codigo = comprobante.respuestaSunat?.codigo ?? '98';
  const descripcion =
    comprobante.respuestaSunat?.descripcion ??
    `Comprobante ${comprobante.serie}-${comprobante.correlativo} en trámite`;

  const cdr =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ApplicationResponse>` +
    `<ResponseCode>${codigo}</ResponseCode>` +
    `<Description>${descripcion}</Description>` +
    `<DocumentReference>${comprobante.serie}-${comprobante.correlativo}</DocumentReference>` +
    `</ApplicationResponse>`;

  return Buffer.from(cdr, 'utf-8').toString('base64');
}

export { interpretarCodigoSunat };
