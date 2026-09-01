/**
 * Ruteo del ESB.
 *
 * Dos mecanismos, ambos exigidos por el temario (sesiones 11, 15–16):
 *
 *   1. **Tabla de ruteo declarativa** — por método y patrón de ruta.
 *   2. **Ruteo por contenido** — mira *dentro* del mensaje con XPath para decidir
 *      el destino. Es lo que permite, por ejemplo, mandar una FACTURA a un
 *      servicio y una BOLETA a otro sin que el emisor sepa nada de eso.
 *
 * **El bus no interpreta negocio.** Una regla de ruteo puede leer un campo del
 * mensaje, pero no decidir *qué significa* ese campo (CLAUDE.md §5.3 y §12).
 */
import { ConsultaXml } from '@pos/xml-kit';

export interface Ruta {
  /** Identificador para auditoría y diagnóstico. */
  id: string;
  /** Métodos HTTP que acepta. */
  metodos: string[];
  /** Prefijo de ruta que atiende. `/catalogo` casa con `/catalogo/items/X`. */
  prefijo: string;
  /** Servicio del inventario al que dirige. */
  servicio: string;
  /** URL base del servicio destino. */
  destino: string;
  /**
   * Condición XPath sobre el cuerpo XML. Si está presente, la ruta solo aplica
   * cuando la expresión evalúa a verdadero — **ruteo por contenido**.
   */
  condicionXPath?: string;
  /** Transformación a aplicar antes de entregar. */
  transformacion?: string;
}

export interface MensajeEntrante {
  metodo: string;
  ruta: string;
  correlationId: string;
  /** Cuerpo XML, cuando lo hay. Necesario para el ruteo por contenido. */
  cuerpoXml?: string | undefined;
}

export class ErrorSinRuta extends Error {
  readonly metodo: string;
  readonly ruta: string;

  constructor(metodo: string, ruta: string) {
    super(
      `El bus no tiene ruta para ${metodo} ${ruta}. ` +
        'Toda integración pasa por el ESB: si el destino existe, falta declararlo ' +
        'en la tabla de ruteo.',
    );
    this.name = 'ErrorSinRuta';
    this.metodo = metodo;
    this.ruta = ruta;
  }
}

/**
 * Tabla de ruteo. Declarativa a propósito: añadir un servicio al inventario no
 * debe exigir tocar la lógica del bus.
 */
export class TablaRuteo {
  readonly #rutas: Ruta[];

  constructor(rutas: Ruta[] = []) {
    this.#rutas = [...rutas];
  }

  agregar(ruta: Ruta): void {
    this.#rutas.push(ruta);
  }

  get rutas(): readonly Ruta[] {
    return this.#rutas;
  }

  /**
   * Resuelve el destino de un mensaje.
   *
   * Evalúa en orden de declaración. Las rutas con condición de contenido se
   * comprueban contra el cuerpo; si la condición no se cumple, se sigue buscando.
   */
  resolver(mensaje: MensajeEntrante): Ruta {
    const candidatas = this.#rutas.filter(
      (r) =>
        r.metodos.includes(mensaje.metodo.toUpperCase()) &&
        mensaje.ruta.startsWith(r.prefijo),
    );

    for (const ruta of candidatas) {
      if (!ruta.condicionXPath) return ruta;
      if (cumpleCondicion(ruta.condicionXPath, mensaje.cuerpoXml)) return ruta;
    }

    throw new ErrorSinRuta(mensaje.metodo, mensaje.ruta);
  }
}

/** Ruteo por contenido con XPath. Sin cuerpo XML, la condición no puede cumplirse. */
function cumpleCondicion(xpath: string, cuerpoXml: string | undefined): boolean {
  if (!cuerpoXml) return false;

  try {
    return new ConsultaXml(cuerpoXml).booleano(xpath);
  } catch {
    // Un cuerpo mal formado no casa ninguna condición. No es error del bus:
    // el mensaje simplemente no aplica a esta ruta.
    return false;
  }
}
