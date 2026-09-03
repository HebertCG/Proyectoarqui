/**
 * Motor de orquestación: ejecuta un modelo BPMN 2.0 real.
 *
 * El `.bpmn` que se abre en Camunda Modeler es el mismo que corre aquí. No hay
 * una "versión de código" del proceso que pueda desviarse del diagrama — que es
 * justamente el punto de BPM (sesiones 27-28).
 *
 * El motor **no sabe de negocio**: recibe las actividades ya construidas y las
 * invoca cuando el modelo lo indica. Quién llama a qué servicio es decisión del
 * servicio de tarea, no del motor.
 */
import { Engine } from 'bpmn-engine';
import { EventEmitter } from 'node:events';

import { ConstructorTraza, type Desenlace, type TrazaProceso } from './traza.js';

/** Lo que recibe una actividad al ejecutarse. */
export interface ContextoActividad {
  /** Estado del proceso hasta este punto. Solo lectura. */
  readonly variables: Readonly<Record<string, unknown>>;
  /** Se propaga a todos los servicios: es lo que cose la traza de auditoría. */
  readonly correlationId: string;
}

/**
 * Una actividad devuelve las variables que aporta al proceso. Esas variables
 * son las que evalúan las compuertas del modelo, así que su nombre forma parte
 * del contrato entre el código y el `.bpmn`.
 */
export type Actividad = (
  contexto: ContextoActividad,
) => Promise<Record<string, unknown>>;

export interface OpcionesEjecucion {
  /** Id del proceso dentro del `.bpmn`. */
  proceso: string;
  /** Contenido del `.bpmn`. */
  fuente: string;
  /**
   * Una entrada por cada `serviceTask` del modelo, **con la clave igual al id
   * de la actividad en el `.bpmn`** (`CerrarVenta`, no `cerrarVenta`). Que sea
   * el mismo nombre no es cosmético: es lo que hace que la traza se lea contra
   * el diagrama sin traducir nada.
   */
  actividades: Record<string, Actividad>;
  /** Variables iniciales del proceso. */
  variables?: Record<string, unknown>;
  correlationId: string;
  /**
   * Actividad compensadora → actividad que compensa. Permite marcar en la traza
   * qué paso quedó revertido, no solo que hubo compensación.
   */
  compensaciones?: Record<string, string>;
}

/** El motor solo conoce estos tipos de fin; el resto son actividades. */
const TIPO_EVENTO_FIN = 'bpmn:EndEvent';

export class MotorBpmn {
  /**
   * Ejecuta el proceso y devuelve su traza. **No lanza** por un fallo de
   * negocio: un proceso que termina compensando terminó correctamente. Solo
   * lanza si el modelo en sí es inválido.
   */
  async ejecutar(opciones: OpcionesEjecucion): Promise<TrazaProceso> {
    const traza = new ConstructorTraza();
    const compensaciones = opciones.compensaciones ?? {};

    // Estado autoritativo del proceso. El `environment` del motor mezcla el
    // sobre del mensaje con las variables, así que no sirve como fuente de
    // verdad: se usa solo para que las compuertas evalúen sus condiciones.
    const variables: Record<string, unknown> = { ...opciones.variables };

    let desenlace: Desenlace | undefined;

    const oyente = new EventEmitter();
    oyente.on('activity.end', (api: { id: string; type?: string }) => {
      traza.registrarVisita(api.id);
      if (api.type === TIPO_EVENTO_FIN) desenlace = api.id as Desenlace;
    });
    oyente.on('activity.error', (api: { id: string }) => {
      traza.registrarVisita(`!${api.id}`);
    });

    const servicios = Object.fromEntries(
      Object.entries(opciones.actividades).map(([id, actividad]) => [
        id,
        this.#adaptar(id, actividad, {
          traza,
          variables,
          correlationId: opciones.correlationId,
          compensa: compensaciones[id],
        }),
      ]),
    );

    const motor = new Engine({
      name: opciones.proceso,
      source: opciones.fuente,
      services: servicios,
      variables,
    });

    // `execute()` resuelve en cuanto la ejecución queda ociosa, y con
    // actividades asíncronas eso ocurre en el primer `await` de la primera
    // tarea: el proceso seguiría corriendo después de que creamos haber
    // terminado. Hay que esperar el evento de fin del propio motor. Ambas
    // esperas se registran ANTES de arrancar, o se pierde el evento.
    const finalizacion = motor.waitFor('end');
    const fallo = motor.waitFor('error');

    try {
      await motor.execute({ listener: oyente });
      await Promise.race([finalizacion, fallo]);
    } catch (causa) {
      // El modelo no pudo completarse: un error sin evento de borde que lo
      // recoja. Se devuelve la traza igual — saber hasta dónde llegó es
      // exactamente lo que hace falta para diagnosticar.
      return traza.cerrar({
        proceso: opciones.proceso,
        correlationId: opciones.correlationId,
        variables,
        error: causa instanceof Error ? causa.message : String(causa),
      });
    }

    return traza.cerrar({
      proceso: opciones.proceso,
      correlationId: opciones.correlationId,
      variables,
      ...(desenlace ? { desenlace } : {}),
    });
  }

  /**
   * Envuelve una actividad asíncrona en el formato de callback que espera
   * `bpmn-engine`, y de paso la instrumenta para la traza.
   */
  #adaptar(
    id: string,
    actividad: Actividad,
    ctx: {
      traza: ConstructorTraza;
      variables: Record<string, unknown>;
      correlationId: string;
      compensa?: string;
    },
  ) {
    return (
      entorno: { environment: { assignVariables(v: Record<string, unknown>): void } },
      callback: (error: Error | null, salida?: unknown) => void,
    ): void => {
      const inicio = Date.now();

      actividad({ variables: ctx.variables, correlationId: ctx.correlationId })
        .then((salida) => {
          Object.assign(ctx.variables, salida);
          // Sin esto las compuertas del modelo evalúan sobre las variables
          // iniciales y el proceso se va siempre por la rama por defecto.
          entorno.environment.assignVariables(salida);

          ctx.traza.registrarPaso({
            actividad: id,
            resultado: 'OK',
            duracionMs: Date.now() - inicio,
            salida,
          });

          // Una actividad de compensación no es un paso más: deja marcado el
          // paso original como revertido.
          if (ctx.compensa) ctx.traza.marcarCompensado(ctx.compensa);

          callback(null, salida);
        })
        .catch((causa: unknown) => {
          const mensaje = causa instanceof Error ? causa.message : String(causa);
          ctx.traza.registrarPaso({
            actividad: id,
            resultado: 'ERROR',
            duracionMs: Date.now() - inicio,
            error: mensaje,
          });
          callback(causa instanceof Error ? causa : new Error(mensaje));
        });
    };
  }
}
