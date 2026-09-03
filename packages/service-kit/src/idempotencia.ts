/**
 * Idempotencia por UUIDv4.
 *
 * Garantiza RF-SYNC-07 y RNF-09: reenviar un evento ya procesado no duplica la
 * venta, el movimiento de caja ni el comprobante. Es la pieza que hace seguro
 * el reintento con backoff del worker de sincronización.
 *
 * El almacén es intercambiable: en memoria para pruebas, PostgreSQL en
 * producción. El contrato es el mismo.
 */

const PATRON_UUIDV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const esUuidV4 = (v: string): boolean => PATRON_UUIDV4.test(v);

export interface RespuestaGuardada {
  estado: number;
  cuerpo: unknown;
  guardadoEn: number;
}

export interface AlmacenIdempotencia {
  obtener(clave: string): Promise<RespuestaGuardada | null>;
  guardar(clave: string, respuesta: RespuestaGuardada): Promise<void>;
  /** Reserva la clave. `false` si otra petición ya la tomó (carrera). */
  reservar(clave: string): Promise<boolean>;
  liberar(clave: string): Promise<void>;
}

/** Almacén en memoria con expiración. Para pruebas y desarrollo. */
export class AlmacenMemoria implements AlmacenIdempotencia {
  readonly #datos = new Map<string, RespuestaGuardada>();
  readonly #reservas = new Set<string>();
  readonly #ttlMs: number;

  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.#ttlMs = ttlMs;
  }

  async obtener(clave: string): Promise<RespuestaGuardada | null> {
    const r = this.#datos.get(clave);
    if (!r) return null;
    if (Date.now() - r.guardadoEn > this.#ttlMs) {
      this.#datos.delete(clave);
      return null;
    }
    return r;
  }

  async guardar(clave: string, respuesta: RespuestaGuardada): Promise<void> {
    this.#datos.set(clave, respuesta);
    this.#reservas.delete(clave);
  }

  async reservar(clave: string): Promise<boolean> {
    if (this.#reservas.has(clave) || this.#datos.has(clave)) return false;
    this.#reservas.add(clave);
    return true;
  }

  async liberar(clave: string): Promise<void> {
    this.#reservas.delete(clave);
  }

  get tamano(): number {
    return this.#datos.size;
  }
}

export const CABECERA_IDEMPOTENCIA = 'idempotency-key';

/**
 * Acota la clave a la operación concreta.
 *
 * Sin esto, dos operaciones distintas que compartan clave colisionan y la
 * segunda recibe la respuesta cacheada de la primera. El caso que lo destapó:
 * cerrar y luego revertir el mismo ticket con la misma clave devolvía el cierre
 * y **la reversión no llegaba a ejecutarse** — una compensación que no compensa
 * y no avisa.
 *
 * Se usa la plantilla de ruta (`/ventas/tickets/:uuid/cierre`), no la URL
 * concreta: reusar una clave sobre otro recurso del mismo endpoint sigue siendo
 * un error del llamante, que es la semántica estándar.
 */
export function claveDeOperacion(
  metodo: string,
  ruta: string,
  clave: string,
): string {
  return `${metodo} ${ruta}#${clave}`;
}

/** Métodos que cambian estado y por tanto requieren protección. */
export const METODOS_PROTEGIDOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
