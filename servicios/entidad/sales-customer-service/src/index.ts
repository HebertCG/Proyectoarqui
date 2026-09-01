/**
 * Arranque de `Sales & Customer Service`.
 *
 * Servicio de entidad COMPUESTO: Caja, Venta/POS, Cliente/CRM y Catalogo son
 * sub-dominios internos que comparten una misma base (CLAUDE.md 3 y 4.5).
 *
 * De momento solo esta cableado el sub-dominio Catalogo, que es lo que necesita
 * el esqueleto vertical.
 */
import { crearServicio, cargarConfig, AuditoriaHttp } from '@pos/service-kit';

import { registrarRutasCatalogo } from './catalogo/rutas.js';
import { RepositorioCatalogoMemoria } from './catalogo/repositorio-memoria.js';
import { CATALOGO_SEMILLA } from './datos-semilla.js';

const config = cargarConfig({
  nombre: 'Sales.Customer.Entity',
  puertoPorDefecto: 3001,
});

// La auditoria viaja por HTTP hacia Auditoria.Utility. Si no responde, el
// cliente encola y reintenta: nunca tumba la operacion de negocio.
const auditoria = new AuditoriaHttp(
  config.urlAuditoria ?? 'http://localhost:3012',
);

const app = await crearServicio({ config, auditoria });

const catalogo = new RepositorioCatalogoMemoria(CATALOGO_SEMILLA);
registrarRutasCatalogo(app, catalogo);

app.log.info(
  { subdominios: ['catalogo'], items: CATALOGO_SEMILLA.length },
  'sub-dominios cableados',
);

await app.listen({ port: config.puerto, host: '0.0.0.0' });
