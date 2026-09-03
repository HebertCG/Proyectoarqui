/**
 * @pos/service-kit — base común de todos los servicios del inventario.
 *
 * Ver CLAUDE.md §5.2 (stack) y §9.3 (reglas de código).
 */

export {
  crearServicio,
  CABECERA_CORRELACION,
  type OpcionesServicio,
} from './servicio.js';

export {
  cargarConfig,
  urlPostgres,
  urlRabbitmq,
  type ConfigServicio,
  type OpcionesConfig,
} from './config.js';

export {
  exito,
  fallo,
  type Envelope,
  type ErrorEnvelope,
  type MetaRespuesta,
  type MetaPaginacion,
} from './envelope.js';

export {
  ErrorServicio,
  esErrorServicio,
  errorValidacion,
  errorNoAutorizado,
  errorProhibido,
  errorNoEncontrado,
  errorConflicto,
  errorReglaNegocio,
  errorDependencia,
  type CodigoError,
  type SoapFault,
} from './errores.js';

export {
  AlmacenMemoria,
  esUuidV4,
  CABECERA_IDEMPOTENCIA,
  claveDeOperacion,
  METODOS_PROTEGIDOS,
  type AlmacenIdempotencia,
  type RespuestaGuardada,
} from './idempotencia.js';

export {
  AuditoriaConsola,
  AuditoriaHttp,
  nuevaEntrada,
  type ClienteAuditoria,
  type EntradaAuditoria,
} from './auditoria.js';
