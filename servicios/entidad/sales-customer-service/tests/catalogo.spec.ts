import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';

import { registrarRutasCatalogo } from '../src/catalogo/rutas.js';
import { RepositorioCatalogoMemoria } from '../src/catalogo/repositorio-memoria.js';
import { CATALOGO_SEMILLA } from '../src/datos-semilla.js';

let app: FastifyInstance;
let auditoria: AuditoriaConsola;
let repositorio: RepositorioCatalogoMemoria;

beforeEach(async () => {
  auditoria = new AuditoriaConsola();
  repositorio = new RepositorioCatalogoMemoria(CATALOGO_SEMILLA);
  app = await crearServicio({
    config: cargarConfig({
      nombre: 'Sales.Customer.Entity',
      puertoPorDefecto: 3001,
      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    }),
    auditoria,
  });
  registrarRutasCatalogo(app, repositorio);
  await app.ready();
});

const buscar = (query = '') =>
  app.inject({ method: 'GET', url: `/catalogo/items${query}` });

describe('BuscarItemsCatalogo', () => {
  it('devuelve solo los activos por defecto (RF-CAT-07)', async () => {
    const r = await buscar();
    const skus = r.json().datos.map((i: { sku: string }) => i.sku);

    expect(r.statusCode).toBe(200);
    // AC-DESCONT está desactivado: no se elimina del histórico, pero no se vende.
    expect(skus).not.toContain('AC-DESCONT');
    expect(r.json().meta.total).toBe(3);
  });

  it('incluye los inactivos si se piden explícitamente', async () => {
    const r = await buscar('?soloActivos=false');
    const skus = r.json().datos.map((i: { sku: string }) => i.sku);

    expect(skus).toContain('AC-DESCONT');
    expect(r.json().meta.total).toBe(4);
  });

  it('busca por texto en el nombre', async () => {
    const r = await buscar('?q=shampoo');

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].sku).toBe('SH-500ML');
  });

  it('busca por SKU', async () => {
    const r = await buscar('?q=SRV-CORTE');

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].nombre).toBe('Corte de cabello');
  });

  it('ignora acentos y mayúsculas: el cajero no debería tener que acertarlos', async () => {
    const conAcento = await buscar('?q=peluquer%C3%ADa');
    const sinAcento = await buscar('?q=PELUQUERIA');

    expect(conAcento.json().datos).toHaveLength(1);
    expect(sinAcento.json().datos).toHaveLength(1);
    expect(sinAcento.json().datos[0].sku).toBe('SRV-CORTE');
  });

  it('filtra por tipo: productos y servicios se venden distinto', async () => {
    const productos = await buscar('?tipoItem=PRODUCTO');
    const servicios = await buscar('?tipoItem=SERVICIO');

    expect(productos.json().datos).toHaveLength(1);
    expect(servicios.json().datos).toHaveLength(1);
    expect(servicios.json().datos[0].datosServicio.duracionMinutos).toBe(45);
  });

  it('filtra por categoría', async () => {
    const r = await buscar('?categoria=Combos');

    expect(r.json().datos).toHaveLength(1);
    expect(r.json().datos[0].sku).toBe('CMB-CUIDADO');
  });

  it('pagina y reporta el total real', async () => {
    const r = await buscar('?limite=2&pagina=1');

    expect(r.json().datos).toHaveLength(2);
    expect(r.json().meta.total).toBe(3);
    expect(r.json().meta.limite).toBe(2);
  });

  it('devuelve lista vacía, no error, cuando nada coincide', async () => {
    const r = await buscar('?q=noexisteestoenelcatalogo');

    expect(r.statusCode).toBe(200);
    expect(r.json().exito).toBe(true);
    expect(r.json().datos).toEqual([]);
  });

  it('rechaza un tipoItem que no existe en el contrato', async () => {
    const r = await buscar('?tipoItem=INVENTADO');

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe('VALIDACION_ESQUEMA');
  });

  it('rechaza un límite por encima del máximo del contrato', async () => {
    const r = await buscar('?limite=9999');
    expect(r.statusCode).toBe(400);
  });
});

describe('ConsultarItemCatalogo — lo consumen otros servicios del inventario', () => {
  it('devuelve el item con sus listas de precios', async () => {
    const r = await app.inject({ method: 'GET', url: '/catalogo/items/SH-500ML' });
    const item = r.json().datos;

    expect(r.statusCode).toBe(200);
    expect(item.sku).toBe('SH-500ML');
    expect(item.precios).toHaveLength(3);
    expect(item.precios.find((p: { lista: string }) => p.lista === 'VIP').precio).toBe(21.5);
  });

  it('un SERVICIO trae duración, especialistas y recursos, no stock', async () => {
    const r = await app.inject({ method: 'GET', url: '/catalogo/items/SRV-CORTE' });
    const item = r.json().datos;

    expect(item.tipoItem).toBe('SERVICIO');
    expect(item.datosServicio.duracionMinutos).toBe(45);
    expect(item.datosServicio.especialistas).toHaveLength(1);
    expect(item.datosServicio.recursos).toHaveLength(1);
  });

  it('un PRODUCTO no trae datos de servicio', async () => {
    const r = await app.inject({ method: 'GET', url: '/catalogo/items/SH-500ML' });

    expect(r.json().datos.datosServicio).toBeUndefined();
  });

  it('devuelve 404 con envelope cuando el SKU no existe', async () => {
    const r = await app.inject({ method: 'GET', url: '/catalogo/items/NO-EXISTE' });

    expect(r.statusCode).toBe(404);
    expect(r.json().exito).toBe(false);
    expect(r.json().error.codigo).toBe('ITEM_CATALOGO_NO_ENCONTRADO');
  });

  it('rechaza un SKU con formato inválido antes de tocar el repositorio', async () => {
    const r = await app.inject({ method: 'GET', url: '/catalogo/items/sku-en-minusculas' });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe('VALIDACION_ESQUEMA');
  });

  it('audita la consulta con su correlationId (RNF-11)', async () => {
    await app.inject({
      method: 'GET',
      url: '/catalogo/items/SH-500ML',
      headers: { 'x-correlation-id': 'corr-venta-e2e' },
    });

    expect(auditoria.entradas).toHaveLength(1);
    const entrada = auditoria.entradas[0]!;
    expect(entrada.accion).toBe('ITEM_CATALOGO_CONSULTADO');
    expect(entrada.correlationId).toBe('corr-venta-e2e');
    expect(entrada.recursoId).toBe('SH-500ML');
  });

  it('no audita una consulta fallida: no ocurrió nada que registrar', async () => {
    await app.inject({ method: 'GET', url: '/catalogo/items/NO-EXISTE' });

    expect(auditoria.entradas).toHaveLength(0);
  });
});

describe('RepositorioCatalogoMemoria', () => {
  it('permite añadir items en caliente', async () => {
    repositorio.agregar({
      uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      sku: 'NUEVO-01',
      tipoItem: 'PRODUCTO',
      nombre: 'Item nuevo',
      categoria: 'Pruebas',
      precioBase: 10,
      afectoIgv: true,
      activo: true,
    });

    expect(await repositorio.porSku('NUEVO-01')).not.toBeNull();
  });

  it('devuelve null para un SKU inexistente, no lanza', async () => {
    expect(await repositorio.porSku('NADA')).toBeNull();
  });

  it('ordena alfabéticamente por nombre', async () => {
    const { items } = await repositorio.buscar({ soloActivos: true, pagina: 1, limite: 50 });

    const nombres = items.map((i) => i.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es')));
  });
});
