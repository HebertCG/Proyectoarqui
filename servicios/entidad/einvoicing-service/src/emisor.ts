/**
 * Emisor: orquesta el trámite tributario de un comprobante.
 *
 *     validar UBL → firmar → comprimir → enviar por SOAP → interpretar CDR
 *
 * Todo esto ocurre **después** de que el cliente se fue con su comprobante. El
 * ticket se emitió localmente en `Sales & Customer Service` y el trámite pasa
 * por aquí cuando hay conexión.
 *
 * El emisor no decide *si* enviar: eso lo decide el estado tributario. Solo
 * ejecuta el trámite y aplica la transición que corresponda.
 */
import { gzipSync } from 'node:zlib';

import {
  interpretarCodigoSunat,
  nombreArchivoSunat,
  transicionar,
  type Comprobante,
} from './comprobante.js';
import type { ClienteSunat, RespuestaEnvio } from './cliente-sunat.js';
import { ErrorSunat } from './cliente-sunat.js';
import type { Firmador } from './firma.js';
import type { GeneradorUbl } from './ubl.js';

export interface ResultadoEmision {
  comprobante: Comprobante;
  respuesta?: RespuestaEnvio | undefined;
  /** Si falló de forma reintentable, el comprobante vuelve a PENDIENTE_ENVIO. */
  reintentable: boolean;
  error?: string | undefined;
}

export interface DependenciasEmisor {
  generador: GeneradorUbl;
  firmador: Firmador;
  cliente: ClienteSunat;
  rucEmisor: string;
}

export class Emisor {
  readonly #generador: GeneradorUbl;
  readonly #firmador: Firmador;
  readonly #cliente: ClienteSunat;
  readonly #ruc: string;

  constructor(deps: DependenciasEmisor) {
    this.#generador = deps.generador;
    this.#firmador = deps.firmador;
    this.#cliente = deps.cliente;
    this.#ruc = deps.rucEmisor;
  }

  /**
   * Ejecuta el trámite completo.
   *
   * **No lanza ante un fallo de SUNAT**: devuelve el resultado con el estado que
   * corresponda. Un error no controlado aquí dejaría el comprobante en un estado
   * inconsistente, y el worker de reintentos no sabría qué hacer con él.
   */
  async emitir(comprobante: Comprobante): Promise<ResultadoEmision> {
    // La NOTA_VENTA no es comprobante fiscal: SUNAT no la recibe.
    if (comprobante.tipoComprobante === 'NOTA_VENTA') {
      return {
        comprobante,
        reintentable: false,
        error: 'La nota de venta no se envía a SUNAT: no es comprobante fiscal.',
      };
    }

    let enviado: Comprobante;
    try {
      enviado = transicionar(comprobante, 'ENVIADO');
    } catch (causa) {
      return {
        comprobante,
        reintentable: false,
        error: causa instanceof Error ? causa.message : String(causa),
      };
    }

    enviado = {
      ...enviado,
      intentos: enviado.intentos + 1,
      ultimoIntento: new Date(),
    };

    let contenido: string;
    try {
      // Validar antes de firmar: firmar un documento inválido gasta tiempo y
      // acaba en un rechazo de SUNAT que consume el correlativo.
      const ubl = await this.#generador.generar(comprobante);
      const firmado = this.#firmador.firmar(ubl);
      contenido = gzipSync(Buffer.from(firmado, 'utf-8')).toString('base64');
    } catch (causa) {
      // Un documento mal formado no mejora reintentando.
      return {
        comprobante: { ...enviado, estadoTributario: 'RECHAZADO' },
        reintentable: false,
        error: causa instanceof Error ? causa.message : String(causa),
      };
    }

    try {
      const respuesta = await this.#cliente.enviarComprobante(
        nombreArchivoSunat(this.#ruc, comprobante),
        contenido,
      );

      const estado = interpretarCodigoSunat(respuesta.codigo);

      return {
        comprobante: {
          ...enviado,
          estadoTributario: estado,
          respuestaSunat: {
            codigo: respuesta.codigo,
            descripcion: respuesta.descripcion,
            recibidoEn: new Date(),
          },
        },
        respuesta,
        reintentable: false,
      };
    } catch (causa) {
      const esSunat = causa instanceof ErrorSunat;
      const reintentable = esSunat ? causa.reintentable : true;

      return {
        // Un fallo de red vuelve a la cola; un rechazo de negocio, no.
        comprobante: {
          ...enviado,
          estadoTributario: reintentable ? 'PENDIENTE_ENVIO' : 'RECHAZADO',
        },
        reintentable,
        error: causa instanceof Error ? causa.message : String(causa),
      };
    }
  }
}
