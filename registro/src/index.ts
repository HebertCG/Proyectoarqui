/**
 * Arranque del Registro de Servicios (UDDI).
 *
 * Nace poblado con el inventario canonico: los ocho servicios de entidad, los
 * de utilidad, los de tarea y la infraestructura. Los stubs de Nivel 3 quedan
 * marcados como simulados.
 */
import { crearServicio, cargarConfig, AuditoriaHttp } from '@pos/service-kit';

import { registrarRutas } from './rutas.js';
import { RegistroUddi } from './repositorio.js';
import { publicarInventario } from './inventario-semilla.js';

const config = cargarConfig({ nombre: 'Registro.UDDI', puertoPorDefecto: 3010 });

const auditoria = new AuditoriaHttp(config.urlAuditoria ?? 'http://localhost:3012');
const registro = new RegistroUddi();

publicarInventario(registro);

const app = await crearServicio({ config, auditoria });
registrarRutas(app, registro);

app.log.info({ servicios: registro.totalServicios }, 'inventario publicado');

await app.listen({ port: config.puerto, host: '0.0.0.0' });
