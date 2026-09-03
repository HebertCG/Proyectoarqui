/**
 * Arranque de `Sales & Customer Service`.
 *
 * Servicio de entidad COMPUESTO. Los cuatro sub-dominios —Caja, Venta/POS,
 * Cliente/CRM y Catalogo— comparten una misma base de datos porque el cajero
 * los necesita en el mismo instante del ticket (CLAUDE.md 3 y 4.5).
 *
 * Aqui se ve por que: `registrarRutasVenta` recibe los repositorios de catalogo
 * y de caja. Si fueran servicios separados, cada linea del ticket seria una
 * llamada de red en el peor momento posible.
 */
import { crearServicio, cargarConfig, AuditoriaHttp } from '@pos/service-kit';

import { registrarRutasCatalogo } from './catalogo/rutas.js';
import { registrarRutasCaja } from './caja/rutas.js';
import { registrarRutasCliente } from './cliente/rutas.js';
import { registrarRutasVenta } from './venta/rutas.js';
import { RepositorioCatalogoMemoria } from './catalogo/repositorio-memoria.js';
import { RepositorioCajaMemoria } from './caja/repositorio-memoria.js';
import { RepositorioClienteMemoria } from './cliente/repositorio-memoria.js';
import { RepositorioVentaMemoria } from './venta/repositorio-memoria.js';
import { CATALOGO_SEMILLA, CLIENTES_SEMILLA } from './datos-semilla.js';

const config = cargarConfig({
  nombre: 'Sales.Customer.Entity',
  puertoPorDefecto: 3001,
});

// La auditoria viaja por HTTP. Si no responde, el cliente encola y reintenta:
// nunca tumba la operacion de negocio.
const auditoria = new AuditoriaHttp(
  config.urlAuditoria ?? 'http://localhost:3012',
);

const app = await crearServicio({ config, auditoria });

const catalogo = new RepositorioCatalogoMemoria(CATALOGO_SEMILLA);
const caja = new RepositorioCajaMemoria();
const clientes = new RepositorioClienteMemoria(CLIENTES_SEMILLA);
const ventas = new RepositorioVentaMemoria();

registrarRutasCatalogo(app, catalogo);
registrarRutasCaja(app, caja);
registrarRutasCliente(app, clientes);
registrarRutasVenta(app, {
  ventas,
  caja,
  catalogo,
  // Venta no accede al repositorio de clientes: pide solo lo que necesita para
  // decidir el comprobante. Los sub-dominios comparten base, no acoplamiento.
  buscarCliente: async (uuid) => {
    const cliente = await clientes.porUuid(uuid);
    if (!cliente) return null;
    return {
      tipoDocumento: cliente.tipoDocumento,
      numeroDocumento: cliente.numeroDocumento,
    };
  },
});

app.log.info(
  {
    subdominios: ['catalogo', 'caja', 'cliente', 'venta'],
    items: CATALOGO_SEMILLA.length,
    clientes: CLIENTES_SEMILLA.length,
  },
  'sub-dominios cableados',
);

await app.listen({ port: config.puerto, host: '0.0.0.0' });
