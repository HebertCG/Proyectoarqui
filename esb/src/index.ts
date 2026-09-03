/**
 * Arranque del Enterprise Service Bus.
 *
 * Punto único de integración del inventario: nada se llama punto a punto entre
 * servicios (CLAUDE.md §9.1 regla 8). Todo entra por aquí, se rutea, se
 * transforma si hace falta, se media entre protocolos y se audita.
 *
 * El bus **no lleva lógica de negocio** (§12). Si algo aquí decide qué significa
 * un campo del mensaje en vez de solo mirarlo para rutear, está mal ubicado.
 */
import { crearServicio, cargarConfig, AuditoriaHttp, exito } from '@pos/service-kit';

import { Bus } from './bus.js';
import { TablaRuteo, type Ruta } from './ruteo.js';
import { TransporteHttp } from './transporte-http.js';

const config = cargarConfig({ nombre: 'ESB', puertoPorDefecto: 3000 });

const urlAuditoria = process.env['AUDITORIA_URL'] ?? 'http://localhost:3012';
const urlSalesCustomer = process.env['SALES_CUSTOMER_URL'] ?? 'http://localhost:3001';
const urlEInvoicing = process.env['EINVOICING_URL'] ?? 'http://localhost:3005';
const urlRegistro = process.env['REGISTRO_URL'] ?? 'http://localhost:3010';
const urlProcesoVenta = process.env['PROCESO_VENTA_URL'] ?? 'http://localhost:3020';

/**
 * Tabla de ruteo declarativa. Añadir un servicio al inventario no debe exigir
 * tocar la lógica del bus: se declara aquí y ya.
 */
const RUTAS: Ruta[] = [
  {
    id: 'sales-customer-catalogo',
    metodos: ['GET'],
    prefijo: '/catalogo',
    servicio: 'Sales.Customer.Entity',
    destino: urlSalesCustomer,
  },
  {
    id: 'sales-customer-clientes',
    metodos: ['GET', 'POST', 'PATCH'],
    prefijo: '/clientes',
    servicio: 'Sales.Customer.Entity',
    destino: urlSalesCustomer,
  },
  {
    id: 'sales-customer-caja',
    metodos: ['GET', 'POST'],
    prefijo: '/caja',
    servicio: 'Sales.Customer.Entity',
    destino: urlSalesCustomer,
  },
  {
    id: 'sales-customer-ventas',
    metodos: ['GET', 'POST'],
    prefijo: '/ventas',
    servicio: 'Sales.Customer.Entity',
    destino: urlSalesCustomer,
  },
  // Mediación de protocolos: entra REST/JSON, sale SOAP/XML hacia SUNAT.
  // Es el caso que justifica el bus (CLAUDE.md §5.3).
  {
    id: 'einvoicing-comprobantes',
    metodos: ['GET', 'POST'],
    prefijo: '/comprobantes',
    servicio: 'EInvoicing.Entity',
    destino: urlEInvoicing,
  },
  // Orquestacion. El servicio de tarea entra al bus como uno mas: el proceso
  // de negocio se invoca igual que cualquier operacion del inventario.
  {
    id: 'proceso-venta',
    metodos: ['GET', 'POST'],
    prefijo: '/procesos/venta',
    servicio: 'ProcesoVenta.Task',
    destino: urlProcesoVenta,
  },
  // Descubrimiento de servicios. El bus lo rutea como cualquier otro servicio:
  // el registro no es un caso especial del inventario.
  {
    id: 'registro-uddi',
    metodos: ['GET', 'POST', 'PUT', 'DELETE'],
    prefijo: '/uddi',
    servicio: 'Registro.UDDI',
    destino: urlRegistro,
  },
  // Trazabilidad: consultar que le paso a una operacion.
  {
    id: 'auditoria-trazas',
    metodos: ['GET'],
    prefijo: '/trazas',
    servicio: 'Auditoria.Utility',
    destino: urlAuditoria,
  },
];

const app = await crearServicio({ config });

/**
 * El bus es un proxy generico: transporta lo que venga. Fastify rechaza por
 * defecto un POST con content-type JSON y cuerpo vacio, pero eso es un requisito
 * del servicio DESTINO, no del bus. Una accion sin payload —por ejemplo
 * `POST /comprobantes/{uuid}/envio`— es perfectamente legitima.
 */
app.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (_peticion, cuerpo: string, hecho) => {
    if (cuerpo === '' || cuerpo === undefined) return hecho(null, undefined);
    try {
      hecho(null, JSON.parse(cuerpo));
    } catch (causa) {
      hecho(causa as Error, undefined);
    }
  },
);

const bus = new Bus({
  tabla: new TablaRuteo(RUTAS),
  transporte: new TransporteHttp(),
  auditoria: new AuditoriaHttp(urlAuditoria),
});

/** Tabla de ruteo consultable: sirve para diagnóstico y para el registro UDDI. */
app.get('/_bus/rutas', async (peticion) =>
  exito(
    RUTAS.map(({ id, metodos, prefijo, servicio }) => ({
      id,
      metodos,
      prefijo,
      servicio,
    })),
    app.meta(peticion),
  ),
);

/**
 * Todo lo demás entra al bus. Es deliberado que sea un comodín: el bus no
 * conoce las rutas de los servicios, solo su tabla de ruteo.
 */
app.all('/*', async (peticion, respuesta) => {
  const resultado = await bus.procesar(
    {
      metodo: peticion.method,
      ruta: peticion.url,
      correlationId: peticion.correlationId,
      cuerpoXml: typeof peticion.body === 'string' ? peticion.body : undefined,
    },
    peticion.body,
    peticion.headers as Record<string, string>,
  );

  return respuesta.code(resultado.estado).send(resultado.cuerpo);
});

app.log.info({ rutas: RUTAS.length }, 'tabla de ruteo cargada');

await app.listen({ port: config.puerto, host: '0.0.0.0' });
