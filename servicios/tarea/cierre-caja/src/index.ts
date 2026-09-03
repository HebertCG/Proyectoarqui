/**
 * Arranque de `CierreCaja.Task`.
 *
 * Servicio de TAREA, sin base de datos propia. Igual que `ProcesoVenta.Task`,
 * su unica dependencia es el ESB.
 */
import { crearServicio, cargarConfig, AuditoriaHttp, EsbHttp } from '@pos/service-kit';

import { registrarRutas } from './rutas.js';

const config = cargarConfig({
  nombre: 'CierreCaja.Task',
  puertoPorDefecto: 3023,
});

const urlEsb = process.env['ESB_URL'] ?? 'http://localhost:3000';

const auditoria = new AuditoriaHttp(config.urlAuditoria ?? 'http://localhost:3012');

const app = await crearServicio({ config, auditoria });

registrarRutas(app, { esb: new EsbHttp(urlEsb) });

app.log.info({ esb: urlEsb }, 'orquestador de cierre listo');

await app.listen({ port: config.puerto, host: '0.0.0.0' });
