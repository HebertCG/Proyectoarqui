/**
 * El cliente HTTP hacia el bus.
 *
 * Lo que importa aquí es que no invente nada: si el bus devuelve un error, el
 * orquestador tiene que conservar el código del servicio de origen. Perderlo
 * convierte cualquier diagnóstico en adivinanza.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esErrorServicio } from '@pos/service-kit';

import { EsbHttp, exigirExito, type RespuestaEsb } from '../src/cliente-esb.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

function respuestaJson(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: JSON_HEADERS });
}

describe('EsbHttp', () => {
  let fetchSimulado: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSimulado = vi.fn();
    vi.stubGlobal('fetch', fetchSimulado);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('desenvuelve el envelope y devuelve solo los datos', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson(200, { exito: true, datos: { total: 120 }, error: null, meta: {} }),
    );

    const r = await new EsbHttp('http://bus').llamar({
      metodo: 'GET',
      ruta: '/ventas/tickets/x',
      correlationId: 'c-1',
    });

    expect(r).toEqual({ estado: 200, datos: { total: 120 }, error: null });
  });

  it('propaga el correlationId como cabecera', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(200, { exito: true, datos: {}, error: null }));

    await new EsbHttp('http://bus').llamar({
      metodo: 'GET',
      ruta: '/x',
      correlationId: 'c-42',
    });

    const [, opciones] = fetchSimulado.mock.calls[0] as [string, RequestInit];
    expect((opciones.headers as Record<string, string>)['x-correlation-id']).toBe('c-42');
  });

  it('no declara content-type cuando no envía cuerpo', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(200, { exito: true, datos: {}, error: null }));

    await new EsbHttp('http://bus').llamar({
      metodo: 'POST',
      ruta: '/comprobantes/x/envio',
      correlationId: 'c-1',
    });

    const [, opciones] = fetchSimulado.mock.calls[0] as [string, RequestInit];
    expect((opciones.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(opciones.body).toBeUndefined();
  });

  it('serializa el cuerpo y declara JSON cuando sí lo hay', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(200, { exito: true, datos: {}, error: null }));

    await new EsbHttp('http://bus').llamar({
      metodo: 'POST',
      ruta: '/clientes',
      correlationId: 'c-1',
      cuerpo: { razonSocial: 'Andina' },
    });

    const [, opciones] = fetchSimulado.mock.calls[0] as [string, RequestInit];
    expect((opciones.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(opciones.body).toBe('{"razonSocial":"Andina"}');
  });

  it('envía la clave de idempotencia cuando se le da', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(200, { exito: true, datos: {}, error: null }));

    await new EsbHttp('http://bus').llamar({
      metodo: 'POST',
      ruta: '/x',
      correlationId: 'c-1',
      claveIdempotencia: 'k-1',
    });

    const [, opciones] = fetchSimulado.mock.calls[0] as [string, RequestInit];
    expect((opciones.headers as Record<string, string>)['idempotency-key']).toBe('k-1');
  });

  it('quita la barra final de la URL base para no producir rutas dobles', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(200, { exito: true, datos: {}, error: null }));

    await new EsbHttp('http://bus/').llamar({
      metodo: 'GET',
      ruta: '/clientes',
      correlationId: 'c-1',
    });

    expect(fetchSimulado.mock.calls[0]?.[0]).toBe('http://bus/clientes');
  });

  it('conserva el error del servicio de origen, no lo reemplaza', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson(422, {
        exito: false,
        datos: null,
        error: { codigo: 'PAGO_INSUFICIENTE', mensaje: 'Faltan S/ 20.' },
      }),
    );

    const r = await new EsbHttp('http://bus').llamar({
      metodo: 'POST',
      ruta: '/x',
      correlationId: 'c-1',
    });

    expect(r.estado).toBe(422);
    expect(r.error?.codigo).toBe('PAGO_INSUFICIENTE');
  });

  it('convierte un bus caído en error de dependencia, no del llamante', async () => {
    fetchSimulado.mockRejectedValue(new Error('ECONNREFUSED'));

    const promesa = new EsbHttp('http://bus').llamar({
      metodo: 'GET',
      ruta: '/x',
      correlationId: 'c-1',
    });

    await expect(promesa).rejects.toMatchObject({
      codigo: 'ESB_INALCANZABLE',
      tipo: 'DEPENDENCIA',
    });
  });

  it('tolera una respuesta que no es JSON sin reventar', async () => {
    fetchSimulado.mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const r = await new EsbHttp('http://bus').llamar({
      metodo: 'GET',
      ruta: '/x',
      correlationId: 'c-1',
    });

    expect(r).toEqual({ estado: 502, datos: null, error: null });
  });

  it('tolera un JSON mal formado: el estado HTTP sigue siendo informativo', async () => {
    fetchSimulado.mockResolvedValue(
      new Response('{roto', { status: 200, headers: JSON_HEADERS }),
    );

    const r = await new EsbHttp('http://bus').llamar({
      metodo: 'GET',
      ruta: '/x',
      correlationId: 'c-1',
    });

    expect(r.estado).toBe(200);
    expect(r.datos).toBeNull();
  });
});

describe('exigirExito', () => {
  const ok: RespuestaEsb<{ total: number }> = {
    estado: 200,
    datos: { total: 120 },
    error: null,
  };

  it('devuelve los datos cuando la respuesta es correcta', () => {
    expect(exigirExito(ok, 'contexto')).toEqual({ total: 120 });
  });

  it('acepta cualquier 2xx, no solo 200', () => {
    expect(exigirExito({ ...ok, estado: 202 }, 'contexto')).toEqual({ total: 120 });
  });

  it('clasifica un 4xx como regla de negocio: culpa del que pidió', () => {
    try {
      exigirExito(
        { estado: 422, datos: null, error: { codigo: 'TICKET_VACIO', mensaje: 'Sin líneas.' } },
        'Al cerrar la venta',
      );
      expect.unreachable('debía lanzar');
    } catch (causa) {
      expect(esErrorServicio(causa)).toBe(true);
      expect(causa).toMatchObject({ tipo: 'REGLA_NEGOCIO', codigo: 'TICKET_VACIO' });
    }
  });

  it('clasifica un 5xx como dependencia: culpa del servicio de abajo', () => {
    try {
      exigirExito(
        { estado: 503, datos: null, error: { codigo: 'CAIDO', mensaje: 'No responde.' } },
        'Al enviar',
      );
      expect.unreachable('debía lanzar');
    } catch (causa) {
      expect(causa).toMatchObject({ tipo: 'DEPENDENCIA' });
    }
  });

  it('antepone el contexto para que el mensaje diga en qué paso se rompió', () => {
    try {
      exigirExito(
        { estado: 404, datos: null, error: { codigo: 'NO_EXISTE', mensaje: 'Nada.' } },
        'Al resolver el cliente del ticket',
      );
      expect.unreachable('debía lanzar');
    } catch (causa) {
      expect((causa as Error).message).toBe('Al resolver el cliente del ticket: Nada.');
    }
  });

  it('un 2xx sin datos también es un fallo: el contrato prometía un cuerpo', () => {
    try {
      exigirExito({ estado: 200, datos: null, error: null }, 'ctx');
      expect.unreachable('debía lanzar');
    } catch (causa) {
      expect(causa).toMatchObject({ codigo: 'RESPUESTA_INESPERADA' });
    }
  });
});
