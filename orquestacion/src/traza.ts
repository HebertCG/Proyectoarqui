/**
 * Traza de ejecución de un proceso orquestado.
 *
 * Es la evidencia de la sesión 29 ("integridad de procesos"): qué pasos se
 * ejecutaron, en qué orden, cuáles fallaron y cuáles se compensaron. Sin esto,
 * una compensación es una afirmación; con esto, es un hecho verificable.
 */

/** Resultado de un paso individual del proceso. */
export type ResultadoPaso = 'OK' | 'ERROR' | 'COMPENSADO';

export interface PasoTraza {
  /** Id de la actividad en el `.bpmn`. Coincide con lo que se ve en el diagrama. */
  actividad: string;
  resultado: ResultadoPaso;
  /** Milisegundos que tardó el paso. Sirve para ver dónde está el cuello real. */
  duracionMs: number;
  salida?: Record<string, unknown>;
  error?: string;
}

/**
 * Cómo terminó el proceso. Cada valor corresponde a un evento de fin del
 * modelo BPMN: el diagrama y el resultado no pueden divergir.
 */
export type Desenlace =
  | 'FinAceptado'
  | 'FinPendiente'
  | 'FinCompensado'
  | 'FinIncompatible';

export interface TrazaProceso {
  proceso: string;
  correlationId: string;
  /** Evento de fin alcanzado. `undefined` si el proceso abortó por excepción. */
  desenlace?: Desenlace;
  /** Ids de actividades y eventos recorridos, en orden real de ejecución. */
  recorrido: string[];
  pasos: PasoTraza[];
  variables: Record<string, unknown>;
  /** `true` si se ejecutó al menos una actividad de compensación. */
  compensado: boolean;
  iniciadoEn: string;
  duracionMs: number;
  error?: string;
}

/** Acumulador mutable que el motor va llenando durante la ejecución. */
export class ConstructorTraza {
  readonly #pasos: PasoTraza[] = [];
  readonly #recorrido: string[] = [];
  readonly #inicio = Date.now();
  readonly #iniciadoEn = new Date().toISOString();

  registrarPaso(paso: PasoTraza): void {
    this.#pasos.push(paso);
  }

  registrarVisita(actividad: string): void {
    this.#recorrido.push(actividad);
  }

  /**
   * Marca un paso ya ejecutado como compensado. Se busca el último con ese
   * nombre: un mismo paso puede repetirse si el proceso tiene un bucle.
   */
  marcarCompensado(actividad: string): void {
    for (let i = this.#pasos.length - 1; i >= 0; i -= 1) {
      const paso = this.#pasos[i];
      if (paso && paso.actividad === actividad) {
        paso.resultado = 'COMPENSADO';
        return;
      }
    }
  }

  cerrar(datos: {
    proceso: string;
    correlationId: string;
    variables: Record<string, unknown>;
    desenlace?: Desenlace;
    error?: string;
  }): TrazaProceso {
    return {
      proceso: datos.proceso,
      correlationId: datos.correlationId,
      ...(datos.desenlace ? { desenlace: datos.desenlace } : {}),
      recorrido: [...this.#recorrido],
      pasos: [...this.#pasos],
      variables: datos.variables,
      compensado: this.#pasos.some((p) => p.resultado === 'COMPENSADO'),
      iniciadoEn: this.#iniciadoEn,
      duracionMs: Date.now() - this.#inicio,
      ...(datos.error ? { error: datos.error } : {}),
    };
  }
}
