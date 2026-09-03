/**
 * @pos/orquestacion — motor BPMN y trazabilidad de procesos de negocio.
 *
 * Base común de los servicios de tarea (CLAUDE.md §4.3). No contiene lógica de
 * negocio: los procesos viven en `definiciones/*.bpmn` y las actividades las
 * aporta cada servicio de tarea.
 */

export { MotorBpmn, type Actividad, type ContextoActividad, type OpcionesEjecucion } from './motor.js';

export {
  ConstructorTraza,
  type Desenlace,
  type PasoTraza,
  type ResultadoPaso,
  type TrazaProceso,
} from './traza.js';

export {
  cargarDefinicion,
  limpiarCache,
  PROCESOS,
  type NombreProceso,
} from './definiciones.js';
