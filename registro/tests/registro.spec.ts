import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';

import { registrarRutas } from '../src/rutas.js';
import { RegistroUddi, ErrorReferenciaInvalida } from '../src/repositorio.js';
import { publicarInventario } from '../src/inventario-semilla.js';
import { clave, casa } from '../src/modelo-uddi.js';
import type { BusinessService } from '../src/modelo-uddi.js';

let app: FastifyInstance;
let registro: RegistroUddi;
let auditoria: AuditoriaConsola;

const KEY_SALES = clave('service', 'Sales.Customer.Entity');
const KEY_EINVOICING = clave('service', 'EInvoicing.Entity');

beforeEach(async () => {
  auditoria = new AuditoriaConsola();
  registro = new RegistroUddi();
  publicarInventario(registro);

  app = await crearServicio({
    config: cargarConfig({
      nombre: 'Registro.UDDI',
      puertoPorDefecto: 3010,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria,
  });

  registrarRutas(app, registro);
  await app.ready();
});

const buscar = (query = '') =>
  app.inject({ method: 'GET', url: `/uddi/servicios${query}` });

// ══════════════════════════════════════════════════════════════════
//  Modelo de datos UDDI
// ══════════════════════════════════════════════════════════════════

describe('modelo de datos UDDI', () => {
  it('las claves siguen el formato del estándar', () => {
    expect(clave('service', 'Mi.Servicio')).toBe('uddi:pos-soa:service:Mi.Servicio');
    expect(clave('tmodel', 'openapi-3.1')).toBe('uddi:pos-soa:tmodel:openapi-3.1');
  });

  it('la jerarquía completa está poblada: entity → service → binding → tModel', async () => {
    const entidades = (await app.inject({ method: 'GET', url: '/uddi/entidades' })).json();
    const tModels = (await app.inject({ method: 'GET', url: '/uddi/tmodels' })).json();
    const servicio = (
      await app.inject({ method: 'GET', url: `/uddi/servicios/${KEY_SALES}` })
    ).json();

    expect(entidades.datos).toHaveLength(1);
    expect(tModels.datos.length).toBeGreaterThan(0);
    expect(servicio.datos.bindings[0].tModelKeys.length).toBeGreaterThan(0);
  });
});

describe('publicación', () => {
  const nuevoServicio = (parcial: Partial<BusinessService> = {}): BusinessService => ({
    serviceKey: clave('service', 'Prueba.Entity'),
    businessKey: clave('business', 'pos-multirubro'),
    nombre: 'Prueba.Entity',
    descripcion: 'Servicio de prueba',
    capa: 'entidad',
    nivel: 'N2',
    categorias: ['dominio:prueba'],
    bindings: [
      {
        bindingKey: clave('binding', 'Prueba-rest'),
        accessPoint: 'http://localhost:3099',
        tipoAcceso: 'REST',
        tModelKeys: [clave('tmodel', 'openapi-3.1')],
      },
    ],
    simulado: false,
    ...parcial,
  });

  it('publica un servicio nuevo con 201', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/uddi/servicios',
      payload: nuevoServicio(),
    });

    expect(r.statusCode).toBe(201);
    expect(registro.servicio(clave('service', 'Prueba.Entity'))).not.toBeNull();
  });

  it('republicar el mismo servicio lo actualiza con 200', async () => {
    await app.inject({ method: 'POST', url: '/uddi/servicios', payload: nuevoServicio() });

    const r = await app.inject({
      method: 'POST',
      url: '/uddi/servicios',
      payload: nuevoServicio({ descripcion: 'Descripción nueva' }),
    });

    expect(r.statusCode).toBe(200);
    expect(registro.servicio(clave('service', 'Prueba.Entity'))?.descripcion).toBe(
      'Descripción nueva',
    );
  });

  it('RECHAZA un servicio que referencia un tModel inexistente', async () => {
    // Un registro con referencias rotas es peor que uno vacío: el consumidor
    // cree haber descubierto algo invocable.
    const r = await app.inject({
      method: 'POST',
      url: '/uddi/servicios',
      payload: nuevoServicio({
        bindings: [
          {
            bindingKey: 'x',
            accessPoint: 'http://localhost:1',
            tipoAcceso: 'REST',
            tModelKeys: ['uddi:pos-soa:tmodel:inventado'],
          },
        ],
      }),
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe('REFERENCIA_INVALIDA');
  });

  it('RECHAZA un servicio de una entidad no publicada', () => {
    expect(() =>
      registro.publicarServicio(nuevoServicio({ businessKey: 'uddi:pos-soa:business:otra' })),
    ).toThrow(ErrorReferenciaInvalida);
  });

  it('audita la publicación', async () => {
    await app.inject({ method: 'POST', url: '/uddi/servicios', payload: nuevoServicio() });

    const entrada = auditoria.entradas.find((e) => e.accion === 'SERVICIO_PUBLICADO');
    expect(entrada?.detalle?.['nombre']).toBe('Prueba.Entity');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Descubrimiento (find_service)
// ══════════════════════════════════════════════════════════════════

describe('descubrimiento', () => {
  it('el inventario canónico está publicado', async () => {
    const r = await buscar();

    expect(r.statusCode).toBe(200);
    // 8 entidad + 3 utilidad + 3 tarea + ESB
    expect(r.json().meta.total).toBe(15);
  });

  it('filtra por capa SOA', async () => {
    const entidad = (await buscar('?capa=entidad')).json();
    const utilidad = (await buscar('?capa=utilidad')).json();
    const tarea = (await buscar('?capa=tarea')).json();

    expect(entidad.datos).toHaveLength(8);
    expect(utilidad.datos).toHaveLength(3);
    expect(tarea.datos).toHaveLength(3);
  });

  it('filtra por nivel de implementación', async () => {
    const n1 = (await buscar('?nivel=N1')).json();

    const nombres = n1.datos.map((s: { nombre: string }) => s.nombre);
    expect(nombres).toContain('Sales.Customer.Entity');
    expect(nombres).toContain('EInvoicing.Entity');
    expect(nombres).toContain('Auditoria.Utility');
    expect(nombres).toContain('ESB');
  });

  it('filtra por categoría', async () => {
    const r = await buscar('?categoria=b2b');

    const nombres = r.json().datos.map((s: { nombre: string }) => s.nombre);
    expect(nombres).toContain('EInvoicing.Entity');
    expect(nombres).toContain('PaymentGateway.Entity');
  });

  it('filtra por protocolo: solo EInvoicing expone SOAP', async () => {
    const r = await buscar('?tipoAcceso=SOAP');

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].nombre).toBe('EInvoicing.Entity');
  });

  it('filtra por tModel: qué servicios hablan el mismo contrato', async () => {
    const r = await buscar(`?tModelKey=${clave('tmodel', 'ubl-2.1-sunat')}`);

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].nombre).toBe('EInvoicing.Entity');
  });

  it('busca por nombre parcial', async () => {
    const r = await buscar('?nombre=utility');

    expect(r.json().datos).toHaveLength(3);
  });

  it('por defecto INCLUYE los simulados: ocultarlos daría una imagen falsa', async () => {
    const todos = (await buscar()).json();
    const simulados = todos.datos.filter((s: { simulado: boolean }) => s.simulado);

    expect(simulados.length).toBeGreaterThan(0);
  });

  it('se pueden excluir los simulados explícitamente', async () => {
    const reales = (await buscar('?incluirSimulados=false')).json();

    expect(reales.datos.every((s: { simulado: boolean }) => !s.simulado)).toBe(true);
    expect(reales.datos.length).toBeLessThan(15);
  });

  it('devuelve lista vacía, no error, cuando nada coincide', async () => {
    const r = await buscar('?categoria=no-existe');

    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual([]);
  });
});

describe('consulta de detalle', () => {
  it('devuelve el servicio con sus bindings y su salud', async () => {
    const r = await app.inject({ method: 'GET', url: `/uddi/servicios/${KEY_EINVOICING}` });
    const d = r.json().datos;

    expect(r.statusCode).toBe(200);
    expect(d.nombre).toBe('EInvoicing.Entity');
    // REST hacia dentro, SOAP hacia SUNAT.
    expect(d.bindings.map((b: { tipoAcceso: string }) => b.tipoAcceso)).toEqual([
      'REST',
      'SOAP',
    ]);
    expect(d.salud.estado).toBe('DESCONOCIDO');
  });

  it('404 con envelope si no está registrado', async () => {
    const r = await app.inject({ method: 'GET', url: '/uddi/servicios/uddi:x:service:nada' });

    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe('SERVICIO_NO_REGISTRADO');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Resolución de endpoint — lo consume el ESB
// ══════════════════════════════════════════════════════════════════

describe('resolución de endpoint', () => {
  it('devuelve la dirección REST del servicio', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/uddi/servicios/${KEY_SALES}/endpoint?tipoAcceso=REST`,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.endpoint).toBe('http://localhost:3001');
  });

  it('devuelve la dirección SOAP cuando se pide ese protocolo', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/uddi/servicios/${KEY_EINVOICING}/endpoint?tipoAcceso=SOAP`,
    });

    expect(r.json().datos.endpoint).toContain('/ol-ti-itcpe/billService');
  });

  it('404 si el servicio no expone ese protocolo', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/uddi/servicios/${KEY_SALES}/endpoint?tipoAcceso=SOAP`,
    });

    expect(r.statusCode).toBe(404);
    expect(r.json().error.mensaje).toMatch(/no expone una interfaz SOAP/);
  });

  it('sin protocolo devuelve el primer binding', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/uddi/servicios/${KEY_SALES}/endpoint`,
    });

    expect(r.json().datos.endpoint).toBe('http://localhost:3001');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Ciclo de vida y salud
// ══════════════════════════════════════════════════════════════════

describe('retiro — etapa del ciclo de vida (CLAUDE.md §2.2)', () => {
  it('retira un servicio del registro', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/uddi/servicios/${KEY_SALES}` });

    expect(r.statusCode).toBe(200);
    expect(registro.servicio(KEY_SALES)).toBeNull();
  });

  it('un servicio retirado ya no se descubre', async () => {
    await app.inject({ method: 'DELETE', url: `/uddi/servicios/${KEY_SALES}` });

    const r = await buscar();
    expect(r.json().meta.total).toBe(14);
  });

  it('404 al retirar algo que no existe', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/uddi/servicios/uddi:x:service:nada' });
    expect(r.statusCode).toBe(404);
  });

  it('audita el retiro', async () => {
    await app.inject({ method: 'DELETE', url: `/uddi/servicios/${KEY_SALES}` });

    expect(auditoria.entradas.some((e) => e.accion === 'SERVICIO_RETIRADO')).toBe(true);
  });
});

describe('salud', () => {
  it('registra que un servicio está arriba', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/uddi/servicios/${KEY_SALES}/salud`,
      payload: { estado: 'ARRIBA' },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.estado).toBe('ARRIBA');
  });

  it('registra la caída con su detalle', async () => {
    await app.inject({
      method: 'PUT',
      url: `/uddi/servicios/${KEY_SALES}/salud`,
      payload: { estado: 'ABAJO', detalle: 'timeout en /health' },
    });

    expect(registro.salud(KEY_SALES).detalle).toBe('timeout en /health');
  });

  it('404 al reportar salud de un servicio no registrado', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/uddi/servicios/uddi:x:service:nada/salud',
      payload: { estado: 'ARRIBA' },
    });

    expect(r.statusCode).toBe(404);
  });

  it('un servicio nunca verificado figura como DESCONOCIDO', () => {
    expect(registro.salud(KEY_EINVOICING).estado).toBe('DESCONOCIDO');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Vista consolidada — lo que se muestra en la demo
// ══════════════════════════════════════════════════════════════════

describe('inventario consolidado', () => {
  it('resume el inventario por capa, nivel y protocolo', async () => {
    const d = (await app.inject({ method: 'GET', url: '/uddi/inventario' })).json().datos;

    expect(d.total).toBe(15);
    expect(d.porCapa.entidad).toBe(8);
    expect(d.porNivel.N1).toBeGreaterThan(0);
    // Un solo servicio con SOAP, y por una razón concreta.
    expect(d.conSoap).toBe(1);
    expect(d.simulados).toBeGreaterThan(0);
  });

  it('cada servicio declara sus protocolos', async () => {
    const d = (await app.inject({ method: 'GET', url: '/uddi/inventario' })).json().datos;
    const einvoicing = d.servicios.find(
      (s: { nombre: string }) => s.nombre === 'EInvoicing.Entity',
    );

    expect(einvoicing.protocolos).toEqual(['REST', 'SOAP']);
  });
});

describe('función casa()', () => {
  const servicio: BusinessService = {
    serviceKey: 'k',
    businessKey: 'b',
    nombre: 'Uno.Entity',
    descripcion: '',
    capa: 'entidad',
    nivel: 'N1',
    categorias: ['a', 'b'],
    bindings: [
      { bindingKey: 'x', accessPoint: 'u', tipoAcceso: 'REST', tModelKeys: ['t1'] },
    ],
    simulado: false,
  };

  it('sin filtro, todo casa', () => {
    expect(casa(servicio, {})).toBe(true);
  });

  it('el nombre se compara sin distinguir mayúsculas', () => {
    expect(casa(servicio, { nombre: 'UNO' })).toBe(true);
  });

  it('descarta si la categoría no está', () => {
    expect(casa(servicio, { categoria: 'z' })).toBe(false);
  });
});
