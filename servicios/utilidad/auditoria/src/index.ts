/**
 * Arranque de `Auditoria.Utility`.
 *
 * Elige el repositorio segun el entorno: PostgreSQL si hay DATABASE_URL,
 * memoria si no. Eso permite levantar el esqueleto vertical sin infraestructura
 * y cambiar a la base real sin tocar una linea de la logica.
 */
import { crearServicio, cargarConfig, urlPostgres } from '@pos/service-kit';

import { registrarRutas } from './rutas.js';
import { RepositorioMemoria } from './repositorio-memoria.js';
import { RepositorioPostgres } from './repositorio-postgres.js';
import type { RepositorioAuditoria } from './repositorio.js';

const config = cargarConfig({
  nombre: 'Auditoria.Utility',
  puertoPorDefecto: 3012,
});

// Base propia: svc_auditoria. Ningun otro servicio la lee (P5).
const url = config.urlBaseDatos ?? urlPostgres('svc_auditoria');
const usarPostgres = process.env['AUDITORIA_EN_MEMORIA'] !== 'true';

const repositorio: RepositorioAuditoria = usarPostgres
  ? new RepositorioPostgres(url)
  : new RepositorioMemoria();

const app = await crearServicio({ config });
registrarRutas(app, repositorio);

app.log.info(
  { persistencia: usarPostgres ? 'postgres' : 'memoria' },
  'repositorio de auditoria',
);

await app.listen({ port: config.puerto, host: '0.0.0.0' });
