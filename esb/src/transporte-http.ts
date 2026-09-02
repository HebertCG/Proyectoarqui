/**
 * Transporte HTTP del bus.
 *
 * Propaga el `correlationId` hacia el servicio destino: sin eso, la traza se
 * corta en el bus y la auditoría extremo a extremo pierde sentido.
 *
 * **No transforma el cuerpo.** La transformación es otra responsabilidad del bus
 * y vive aparte; este módulo solo mueve bytes.
 */
import { CABECERA_CORRELACION, errorDependencia } from '@pos/service-kit';

import type { RespuestaDestino, Transporte } from './bus.js';
import type { MensajeEntrante, Ruta } from './ruteo.js';

/** Cabeceras que el bus nunca reenvía: las regenera el transporte. */
const CABECERAS_OMITIDAS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
]);

export class TransporteHttp implements Transporte {
  readonly #timeoutMs: number;

  constructor(timeoutMs = 10_000) {
    this.#timeoutMs = timeoutMs;
  }

  async entregar(
    ruta: Ruta,
    mensaje: MensajeEntrante,
    cuerpo: unknown,
    cabeceras: Record<string, string>,
  ): Promise<RespuestaDestino> {
    const url = `${ruta.destino}${mensaje.ruta}`;
    const llevaCuerpo = cuerpo !== undefined && cuerpo !== null;
    const salientes = this.#prepararCabeceras(
      cabeceras,
      mensaje.correlationId,
      llevaCuerpo,
    );

    try {
      const respuesta = await fetch(url, {
        method: mensaje.metodo,
        headers: salientes,
        body: llevaCuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });

      return {
        estado: respuesta.status,
        cuerpo: await this.#leerCuerpo(respuesta),
        cabeceras: Object.fromEntries(respuesta.headers.entries()),
      };
    } catch (causa) {
      // Un destino caído es un fallo de dependencia (502), no del emisor.
      throw errorDependencia(
        'DESTINO_INALCANZABLE',
        `El servicio ${ruta.servicio} no respondió.`,
        { destino: ruta.servicio, url, error: mensajeDe(causa) },
      );
    }
  }

  #prepararCabeceras(
    entrantes: Record<string, string>,
    correlationId: string,
    llevaCuerpo: boolean,
  ): Record<string, string> {
    const salientes: Record<string, string> = {};

    for (const [clave, valor] of Object.entries(entrantes)) {
      const nombre = clave.toLowerCase();
      if (CABECERAS_OMITIDAS.has(nombre)) continue;

      // Declarar `content-type: application/json` sin enviar cuerpo hace que el
      // destino rechace la peticion: anuncia un JSON que nunca llega. Una accion
      // sin payload —`POST /comprobantes/{uuid}/envio`— es perfectamente valida.
      if (nombre === 'content-type' && !llevaCuerpo) continue;

      salientes[clave] = valor;
    }

    // Sin esto la traza se corta en el bus.
    salientes[CABECERA_CORRELACION] = correlationId;
    if (llevaCuerpo) salientes['content-type'] ??= 'application/json';

    return salientes;
  }

  async #leerCuerpo(respuesta: Response): Promise<unknown> {
    const tipo = respuesta.headers.get('content-type') ?? '';
    if (tipo.includes('application/json')) return respuesta.json();
    return respuesta.text();
  }
}

function mensajeDe(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}
