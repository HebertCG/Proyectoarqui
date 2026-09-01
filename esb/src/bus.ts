/**
 * Núcleo del bus: recibe, rutea, entrega y audita.
 *
 * **Todo mensaje que cruza el bus queda registrado** (CLAUDE.md §5.3). Esa es la
 * evidencia de trazabilidad que exigen las sesiones 31–34: el `correlationId`
 * permite reconstruir después el recorrido completo de una operación.
 *
 * El bus **no contiene lógica de negocio**. Solo ruta, transforma, media y audita.
 * Si aquí apareciera una regla de negocio, estaría mal ubicada (§12).
 */
import { randomUUID } from 'node:crypto';
import type { ClienteAuditoria } from '@pos/service-kit';

import { ErrorSinRuta, type MensajeEntrante, type Ruta, type TablaRuteo } from './ruteo.js';

export interface RespuestaDestino {
  estado: number;
  cuerpo: unknown;
  cabeceras: Record<string, string>;
}

/**
 * Entrega el mensaje al servicio destino. Se inyecta para poder probar el bus
 * sin levantar los servicios reales.
 */
export interface Transporte {
  entregar(
    ruta: Ruta,
    mensaje: MensajeEntrante,
    cuerpo: unknown,
    cabeceras: Record<string, string>,
  ): Promise<RespuestaDestino>;
}

export interface OpcionesBus {
  tabla: TablaRuteo;
  transporte: Transporte;
  auditoria: ClienteAuditoria;
  /** Nombre con el que el bus se identifica en la auditoría. */
  nombre?: string;
}

export class Bus {
  readonly #tabla: TablaRuteo;
  readonly #transporte: Transporte;
  readonly #auditoria: ClienteAuditoria;
  readonly #nombre: string;

  constructor(opciones: OpcionesBus) {
    this.#tabla = opciones.tabla;
    this.#transporte = opciones.transporte;
    this.#auditoria = opciones.auditoria;
    this.#nombre = opciones.nombre ?? 'ESB';
  }

  /**
   * Procesa un mensaje de extremo a extremo: resuelve la ruta, lo entrega y deja
   * constancia de ambos pasos.
   */
  async procesar(
    mensaje: MensajeEntrante,
    cuerpo: unknown,
    cabeceras: Record<string, string> = {},
  ): Promise<RespuestaDestino> {
    let ruta: Ruta;

    try {
      ruta = this.#tabla.resolver(mensaje);
    } catch (causa) {
      if (causa instanceof ErrorSinRuta) {
        await this.#auditar(mensaje, 'MENSAJE_SIN_RUTA', {
          metodo: mensaje.metodo,
          ruta: mensaje.ruta,
        });
      }
      throw causa;
    }

    await this.#auditar(mensaje, 'MENSAJE_RUTEADO', {
      rutaId: ruta.id,
      destino: ruta.servicio,
      porContenido: Boolean(ruta.condicionXPath),
    });

    const inicio = Date.now();
    try {
      const respuesta = await this.#transporte.entregar(
        ruta,
        mensaje,
        cuerpo,
        cabeceras,
      );

      await this.#auditar(mensaje, 'MENSAJE_ENTREGADO', {
        rutaId: ruta.id,
        destino: ruta.servicio,
        estado: respuesta.estado,
        duracionMs: Date.now() - inicio,
      });

      return respuesta;
    } catch (causa) {
      await this.#auditar(mensaje, 'ENTREGA_FALLIDA', {
        rutaId: ruta.id,
        destino: ruta.servicio,
        duracionMs: Date.now() - inicio,
        error: causa instanceof Error ? causa.message : String(causa),
      });
      throw causa;
    }
  }

  /**
   * La auditoría nunca puede tumbar el tránsito del mensaje. Si el servicio de
   * auditoría no responde, el cliente ya encola y reintenta por su cuenta.
   */
  async #auditar(
    mensaje: MensajeEntrante,
    accion: string,
    detalle: Record<string, unknown>,
  ): Promise<void> {
    await this.#auditoria.registrar({
      correlationId: mensaje.correlationId,
      servicio: this.#nombre,
      accion,
      recurso: 'mensaje',
      recursoId: randomUUID(),
      usuario: 'sistema',
      timestamp: new Date().toISOString(),
      detalle,
    });
  }
}
