/**
 * Único camino de salida de este servicio: **el ESB**.
 *
 * Un servicio de tarea orquesta a otros servicios, y esa es justo la situación
 * donde la tentación de llamar punto a punto es más fuerte. No se hace
 * (CLAUDE.md §9.1 regla 8): si el orquestador esquivara el bus, se perdería el
 * ruteo, la mediación y la auditoría — es decir, todo lo que el bus aporta.
 *
 * Aquí no hay lógica de negocio: se traduce entre el envelope del inventario y
 * excepciones de JavaScript, nada más.
 */
import { errorDependencia, ErrorServicio, CABECERA_CORRELACION } from '@pos/service-kit';
import type { Envelope } from '@pos/service-kit';

export interface RespuestaEsb<T> {
  estado: number;
  datos: T | null;
  error: Envelope<unknown>['error'];
}

export interface Peticion {
  metodo: 'GET' | 'POST' | 'PATCH';
  ruta: string;
  correlationId: string;
  cuerpo?: unknown;
  /** Sin ella el bus no puede descartar un reenvío duplicado. */
  claveIdempotencia?: string | undefined;
}

export interface Esb {
  llamar<T>(peticion: Peticion): Promise<RespuestaEsb<T>>;
}

export class EsbHttp implements Esb {
  readonly #base: string;
  readonly #timeoutMs: number;

  constructor(base: string, timeoutMs = 15_000) {
    this.#base = base.replace(/\/$/, '');
    this.#timeoutMs = timeoutMs;
  }

  async llamar<T>(peticion: Peticion): Promise<RespuestaEsb<T>> {
    const cabeceras: Record<string, string> = {
      [CABECERA_CORRELACION]: peticion.correlationId,
    };

    if (peticion.cuerpo !== undefined) {
      cabeceras['content-type'] = 'application/json';
    }
    if (peticion.claveIdempotencia) {
      cabeceras['idempotency-key'] = peticion.claveIdempotencia;
    }

    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.#base}${peticion.ruta}`, {
        method: peticion.metodo,
        headers: cabeceras,
        body: peticion.cuerpo === undefined ? undefined : JSON.stringify(peticion.cuerpo),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (causa) {
      // El bus caído no es culpa de quien pidió la venta.
      throw errorDependencia(
        'ESB_INALCANZABLE',
        'El bus de servicios no respondió.',
        { ruta: peticion.ruta, error: causa instanceof Error ? causa.message : String(causa) },
      );
    }

    const cuerpo = (await leer(respuesta)) as Envelope<T> | null;

    return {
      estado: respuesta.status,
      datos: cuerpo?.datos ?? null,
      error: cuerpo?.error ?? null,
    };
  }
}

async function leer(respuesta: Response): Promise<unknown> {
  const tipo = respuesta.headers.get('content-type') ?? '';
  if (!tipo.includes('application/json')) return null;

  try {
    return await respuesta.json();
  } catch {
    // Un cuerpo ilegible es tan informativo como uno vacío: lo relevante es el
    // estado HTTP, que el llamante ya tiene.
    return null;
  }
}

/**
 * Convierte una respuesta de error del bus en excepción, conservando el código
 * del servicio de origen. Sin eso, el orquestador perdería la razón del fallo y
 * solo sabría "algo salió mal".
 */
export function exigirExito<T>(
  respuesta: RespuestaEsb<T>,
  contexto: string,
): T {
  if (respuesta.estado >= 200 && respuesta.estado < 300 && respuesta.datos !== null) {
    return respuesta.datos;
  }

  const codigo = respuesta.error?.codigo ?? 'RESPUESTA_INESPERADA';
  const mensaje = respuesta.error?.mensaje ?? `Estado HTTP ${respuesta.estado}.`;

  throw new ErrorServicio(
    respuesta.estado >= 500 ? 'DEPENDENCIA' : 'REGLA_NEGOCIO',
    codigo,
    `${contexto}: ${mensaje}`,
    respuesta.error?.detalles,
  );
}
