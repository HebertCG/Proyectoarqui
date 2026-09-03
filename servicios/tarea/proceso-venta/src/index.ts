/**
 * Arranque de `ProcesoVenta.Task`.
 *
 * Servicio de TAREA: no tiene base de datos ni entidades propias. Su estado es
 * el del proceso en curso, y ese vive en el motor BPMN mientras dura la
 * ejecucion (CLAUDE.md §4.3, servicio sin estado — P6).
 *
 * Su unica dependencia es el ESB. Si el bus no esta, este servicio no sabe
 * hablar con nadie, y eso es deliberado.
 */
import { crearServicio, cargarConfig, AuditoriaHttp, EsbHttp } from '@pos/service-kit';

import { registrarRutas } from './rutas.js';

const config = cargarConfig({
  nombre: 'ProcesoVenta.Task',
  puertoPorDefecto: 3020,
});

const urlEsb = process.env['ESB_URL'] ?? 'http://localhost:3000';

const auditoria = new AuditoriaHttp(config.urlAuditoria ?? 'http://localhost:3012');

const app = await crearServicio({ config, auditoria });

registrarRutas(app, { esb: new EsbHttp(urlEsb) });

app.log.info({ esb: urlEsb }, 'orquestador listo — todas las salidas van por el bus');

await app.listen({ port: config.puerto, host: '0.0.0.0' });
