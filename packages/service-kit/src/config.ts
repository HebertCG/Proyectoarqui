/**
 * Lectura y validación de configuración de entorno.
 *
 * Falla al arrancar si falta una variable requerida — nunca a mitad de una
 * operación (CLAUDE.md §9.3: validar en los bordes, fallar rápido).
 */

export interface ConfigServicio {
  nombre: string;
  version: string;
  puerto: number;
  entorno: 'development' | 'test' | 'production';
  nivelLog: string;
  urlBaseDatos?: string;
  urlAmqp?: string;
  urlAuditoria?: string;
}

class ErrorConfiguracion extends Error {
  constructor(faltantes: string[]) {
    super(
      `Faltan variables de entorno requeridas: ${faltantes.join(', ')}. ` +
        `Revisa tu archivo .env (ver .env.example).`,
    );
    this.name = 'ErrorConfiguracion';
  }
}

function requerir(claves: string[], env: NodeJS.ProcessEnv): void {
  const faltantes = claves.filter((c) => !env[c]);
  if (faltantes.length > 0) throw new ErrorConfiguracion(faltantes);
}

export interface OpcionesConfig {
  nombre: string;
  version?: string;
  puertoPorDefecto: number;
  /** Variables sin las cuales el servicio no debe arrancar. */
  requeridas?: string[];
  env?: NodeJS.ProcessEnv;
}

export function cargarConfig(opciones: OpcionesConfig): ConfigServicio {
  const env = opciones.env ?? process.env;
  requerir(opciones.requeridas ?? [], env);

  const entornoBruto = env['NODE_ENV'] ?? 'development';
  const entorno = (['development', 'test', 'production'] as const).includes(
    entornoBruto as never,
  )
    ? (entornoBruto as ConfigServicio['entorno'])
    : 'development';

  return {
    nombre: opciones.nombre,
    version: opciones.version ?? '0.1.0',
    puerto: Number(env['PORT'] ?? opciones.puertoPorDefecto),
    entorno,
    nivelLog: env['LOG_LEVEL'] ?? (entorno === 'production' ? 'info' : 'debug'),
    urlBaseDatos: env['DATABASE_URL'],
    urlAmqp: env['AMQP_URL'],
    urlAuditoria: env['AUDITORIA_URL'],
  };
}

/** Construye la URL de PostgreSQL de un servicio a partir de su base. */
export function urlPostgres(baseDatos: string, env = process.env): string {
  const usuario = env['POSTGRES_USER'] ?? 'pos';
  const clave = env['POSTGRES_PASSWORD'] ?? 'pos_dev_local';
  const host = env['POSTGRES_HOST'] ?? 'localhost';
  const puerto = env['POSTGRES_PORT'] ?? '5432';
  return `postgres://${usuario}:${clave}@${host}:${puerto}/${baseDatos}`;
}

/** Construye la URL de RabbitMQ. */
export function urlRabbitmq(env = process.env): string {
  const usuario = env['RABBITMQ_USER'] ?? 'pos';
  const clave = env['RABBITMQ_PASSWORD'] ?? 'pos_dev_local';
  const host = env['RABBITMQ_HOST'] ?? 'localhost';
  const puerto = env['RABBITMQ_PORT'] ?? '5672';
  return `amqp://${usuario}:${clave}@${host}:${puerto}`;
}
