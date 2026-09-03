/**
 * Sub-dominio Cliente / CRM.
 *
 * Lo que más importa aquí no es el CRUD: es que un documento mal escrito no
 * llegue nunca a un comprobante (RF-CRM-02 → RF-POS-18).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';

import { registrarRutasCliente } from '../src/cliente/rutas.js';
import { RepositorioClienteMemoria } from '../src/cliente/repositorio-memoria.js';
import type { Cliente } from '../src/cliente/repositorio.js';

const AHORA = '2026-01-01T10:00:00.000Z';

function clienteDe(parcial: Partial<Cliente> & Pick<Cliente, 'uuid' | 'razonSocial'>): Cliente {
  return {
    tipoDocumento: 'DNI',
    segmento: 'REGULAR',
    activo: true,
    trazabilidad: { creadoPor: 'semilla', creadoEn: AHORA },
    ...parcial,
  };
}

const SEMILLA: Cliente[] = [
  clienteDe({
    uuid: 'aaaaaaaa-1111-4111-8111-111111111111',
    tipoDocumento: 'RUC',
    numeroDocumento: '20512345678',
    razonSocial: 'Distribuidora Andina SAC',
    nombreComercial: 'Andina',
    segmento: 'MAYORISTA',
    contacto: { telefono: '987654321', correo: 'ventas@andina.pe' },
  }),
  clienteDe({
    uuid: 'bbbbbbbb-2222-4222-8222-222222222222',
    tipoDocumento: 'DNI',
    numeroDocumento: '45678912',
    razonSocial: 'María Pérez Quispe',
  }),
];

async function montar(): Promise<{ app: FastifyInstance; repo: RepositorioClienteMemoria }> {
  const app = await crearServicio({
    config: cargarConfig({
      nombre: 'Sales.Customer.Entity',
      puertoPorDefecto: 3001,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria: new AuditoriaConsola(),
  });

  const repo = new RepositorioClienteMemoria(SEMILLA.map((c) => ({ ...c })));
  registrarRutasCliente(app, repo);
  await app.ready();

  return { app, repo };
}

describe('BuscarClientes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await montar());
  });

  it('encuentra por razón social parcial', async () => {
    const r = await app.inject({ method: 'GET', url: '/clientes?q=andina' });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].razonSocial).toBe('Distribuidora Andina SAC');
  });

  it('encuentra por número de documento', async () => {
    const r = await app.inject({ method: 'GET', url: '/clientes?q=20512345678' });

    expect(r.json().datos[0].uuid).toBe('aaaaaaaa-1111-4111-8111-111111111111');
  });

  it('encuentra por teléfono y por correo', async () => {
    const porTelefono = await app.inject({ method: 'GET', url: '/clientes?q=987654321' });
    const porCorreo = await app.inject({ method: 'GET', url: '/clientes?q=ventas@andina' });

    expect(porTelefono.json().datos).toHaveLength(1);
    expect(porCorreo.json().datos).toHaveLength(1);
  });

  it('ignora acentos: "perez" encuentra a "Pérez"', async () => {
    const r = await app.inject({ method: 'GET', url: '/clientes?q=perez' });

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].razonSocial).toContain('Pérez');
  });

  it('devuelve lista vacía cuando nada coincide, no un error', async () => {
    const r = await app.inject({ method: 'GET', url: '/clientes?q=zzzzz' });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual([]);
    expect(r.json().meta.total).toBe(0);
  });

  it('exige el término de búsqueda', async () => {
    const r = await app.inject({ method: 'GET', url: '/clientes' });

    expect(r.statusCode).toBe(400);
  });

  it('pagina los resultados', async () => {
    const r = await app.inject({ method: 'GET', url: '/clientes?q=a&limite=1&pagina=1' });

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().meta.limite).toBe(1);
  });
});

describe('RegistrarCliente', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await montar());
  });

  it('da de alta una persona natural con DNI', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: {
        tipoDocumento: 'DNI',
        numeroDocumento: '12345678',
        razonSocial: 'Juan Ramos',
      },
    });

    expect(r.statusCode).toBe(201);
    expect(r.json().datos).toMatchObject({
      tipoDocumento: 'DNI',
      numeroDocumento: '12345678',
      segmento: 'REGULAR',
      activo: true,
    });
  });

  it('rechaza un DNI que no tiene 8 dígitos (RF-CRM-02)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: { tipoDocumento: 'DNI', numeroDocumento: '123', razonSocial: 'Corto' },
    });

    expect(r.statusCode).toBe(422);
    expect(r.json().error.codigo).toBe('DOCUMENTO_INVALIDO');
  });

  it('rechaza un RUC con prefijo inexistente', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: {
        tipoDocumento: 'RUC',
        numeroDocumento: '99512345678',
        razonSocial: 'Prefijo inválido',
      },
    });

    expect(r.statusCode).toBe(422);
  });

  it('exige número de documento cuando el tipo no es GENERICO', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: { tipoDocumento: 'RUC', razonSocial: 'Sin RUC' },
    });

    expect(r.statusCode).toBe(422);
  });

  it('acepta un cliente GENERICO sin documento y le asigna código interno', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: { tipoDocumento: 'GENERICO', razonSocial: 'Cliente de mostrador' },
    });

    expect(r.statusCode).toBe(201);
    expect(r.json().datos.codigoInterno).toMatch(/^GEN-/);
    expect(r.json().datos.numeroDocumento).toBeUndefined();
  });

  it('impide dos clientes con el mismo documento', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: {
        tipoDocumento: 'RUC',
        numeroDocumento: '20512345678',
        razonSocial: 'Duplicado',
      },
    });

    expect(r.statusCode).toBe(409);
    expect(r.json().error.codigo).toBe('CLIENTE_DUPLICADO');
  });

  it('deriva la lista de precios del segmento (ADR-003)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: {
        tipoDocumento: 'RUC',
        numeroDocumento: '20987654321',
        razonSocial: 'Mayorista Nuevo',
        segmento: 'MAYORISTA',
      },
    });

    expect(r.json().datos.listaPrecios).toBe('MAYORISTA');
  });

  it('una lista de precios explícita gana sobre la del segmento', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: {
        tipoDocumento: 'DNI',
        numeroDocumento: '87654321',
        razonSocial: 'Caso especial',
        segmento: 'REGULAR',
        listaPrecios: 'VIP',
      },
    });

    expect(r.json().datos.listaPrecios).toBe('VIP');
  });

  it('arranca la fidelización en cero', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: { tipoDocumento: 'GENERICO', razonSocial: 'Nuevo' },
    });

    expect(r.json().datos.fidelizacion).toEqual({
      puntosAcumulados: 0,
      puntosRedimidos: 0,
    });
  });
});

describe('ConsultarCliente', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await montar());
  });

  it('devuelve la ficha completa', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/clientes/aaaaaaaa-1111-4111-8111-111111111111',
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.razonSocial).toBe('Distribuidora Andina SAC');
  });

  it('devuelve 404 cuando no existe', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/clientes/99999999-9999-4999-8999-999999999999',
    });

    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe('CLIENTE_NO_ENCONTRADO');
  });
});

describe('ActualizarCliente', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await montar());
  });

  it('modifica solo los campos enviados', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/clientes/bbbbbbbb-2222-4222-8222-222222222222',
      payload: { segmento: 'VIP' },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().datos.segmento).toBe('VIP');
    expect(r.json().datos.razonSocial).toBe('María Pérez Quispe');
  });

  it('desactiva sin borrar: el historial de compras debe seguir apuntando (RNF-08)', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/clientes/bbbbbbbb-2222-4222-8222-222222222222',
      payload: { activo: false },
    });

    const consulta = await app.inject({
      method: 'GET',
      url: '/clientes/bbbbbbbb-2222-4222-8222-222222222222',
    });

    expect(consulta.statusCode).toBe(200);
    expect(consulta.json().datos.activo).toBe(false);
  });

  it('no deja cambiar el tipo de documento: eso cambiaría qué comprobante procede', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/clientes/bbbbbbbb-2222-4222-8222-222222222222',
      payload: { tipoDocumento: 'RUC' },
    });

    expect(r.json().datos.tipoDocumento).toBe('DNI');
  });

  it('registra quién y cuándo modificó', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/clientes/bbbbbbbb-2222-4222-8222-222222222222',
      payload: { nombreComercial: 'Mari' },
    });

    expect(r.json().datos.trazabilidad.modificadoPor).toBe('cajero');
    expect(r.json().datos.trazabilidad.modificadoEn).toBeTruthy();
    expect(r.json().datos.trazabilidad.creadoEn).toBe(AHORA);
  });

  it('devuelve 404 al actualizar uno inexistente', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/clientes/99999999-9999-4999-8999-999999999999',
      payload: { segmento: 'VIP' },
    });

    expect(r.statusCode).toBe(404);
  });
});
