import { describe, it, expect, beforeEach } from 'vitest';
import { AuditoriaConsola } from '@pos/service-kit';

import { Bus, type RespuestaDestino, type Transporte } from '../src/bus.js';
import {
  ErrorSinRuta,
  TablaRuteo,
  type MensajeEntrante,
  type Ruta,
} from '../src/ruteo.js';

/** Transporte falso: registra lo que recibió y devuelve lo que se le indique. */
class TransporteEspia implements Transporte {
  readonly entregas: Array<{ ruta: Ruta; mensaje: MensajeEntrante; cuerpo: unknown }> = [];
  respuesta: RespuestaDestino = { estado: 200, cuerpo: { ok: true }, cabeceras: {} };
  fallar: Error | null = null;

  async entregar(
    ruta: Ruta,
    mensaje: MensajeEntrante,
    cuerpo: unknown,
  ): Promise<RespuestaDestino> {
    this.entregas.push({ ruta, mensaje, cuerpo });
    if (this.fallar) throw this.fallar;
    return this.respuesta;
  }
}

let tabla: TablaRuteo;
let transporte: TransporteEspia;
let auditoria: AuditoriaConsola;
let bus: Bus;

const rutaCatalogo: Ruta = {
  id: 'catalogo-lectura',
  metodos: ['GET'],
  prefijo: '/catalogo',
  servicio: 'Sales.Customer.Entity',
  destino: 'http://localhost:3001',
};

beforeEach(() => {
  tabla = new TablaRuteo([rutaCatalogo]);
  transporte = new TransporteEspia();
  auditoria = new AuditoriaConsola();
  bus = new Bus({ tabla, transporte, auditoria });
});

const mensaje = (parcial: Partial<MensajeEntrante> = {}): MensajeEntrante => ({
  metodo: 'GET',
  ruta: '/catalogo/items/SH-500ML',
  correlationId: 'corr-001',
  ...parcial,
});

const acciones = () => auditoria.entradas.map((e) => e.accion);

describe('ruteo por tabla declarativa', () => {
  it('entrega al servicio que declara el prefijo', async () => {
    const r = await bus.procesar(mensaje(), undefined);

    expect(r.estado).toBe(200);
    expect(transporte.entregas).toHaveLength(1);
    expect(transporte.entregas[0]?.ruta.servicio).toBe('Sales.Customer.Entity');
  });

  it('rechaza un método que la ruta no declara', async () => {
    await expect(
      bus.procesar(mensaje({ metodo: 'DELETE' }), undefined),
    ).rejects.toThrow(ErrorSinRuta);
  });

  it('rechaza una ruta que nadie atiende', async () => {
    await expect(
      bus.procesar(mensaje({ ruta: '/inexistente' }), undefined),
    ).rejects.toThrow(ErrorSinRuta);
  });

  it('el error explica que falta declarar la ruta, no que el destino no exista', async () => {
    await expect(bus.procesar(mensaje({ ruta: '/x' }), undefined)).rejects.toThrow(
      /tabla de ruteo/i,
    );
  });
});

describe('ruteo por contenido con XPath', () => {
  const comprobante = (tipo: string) =>
    `<?xml version="1.0"?><Comprobante xmlns="urn:pos:einvoicing:v1">` +
    `<tipoComprobante>${tipo}</tipoComprobante></Comprobante>`;

  beforeEach(() => {
    tabla = new TablaRuteo([
      {
        id: 'facturas-a-sunat',
        metodos: ['POST'],
        prefijo: '/comprobantes',
        servicio: 'EInvoicing.Entity',
        destino: 'http://localhost:3005',
        condicionXPath: "/*:Comprobante/*:tipoComprobante = 'FACTURA'",
      },
      {
        id: 'notas-de-venta-local',
        metodos: ['POST'],
        prefijo: '/comprobantes',
        servicio: 'Sales.Customer.Entity',
        destino: 'http://localhost:3001',
      },
    ]);
    bus = new Bus({ tabla, transporte, auditoria });
  });

  it('manda la FACTURA al servicio de facturación mirando dentro del mensaje', async () => {
    await bus.procesar(
      mensaje({ metodo: 'POST', ruta: '/comprobantes', cuerpoXml: comprobante('FACTURA') }),
      {},
    );

    expect(transporte.entregas[0]?.ruta.servicio).toBe('EInvoicing.Entity');
  });

  it('manda la NOTA_VENTA por la ruta sin condición', async () => {
    await bus.procesar(
      mensaje({ metodo: 'POST', ruta: '/comprobantes', cuerpoXml: comprobante('NOTA_VENTA') }),
      {},
    );

    expect(transporte.entregas[0]?.ruta.servicio).toBe('Sales.Customer.Entity');
  });

  it('sin cuerpo XML la condición no se cumple y cae a la ruta general', async () => {
    await bus.procesar(mensaje({ metodo: 'POST', ruta: '/comprobantes' }), {});

    expect(transporte.entregas[0]?.ruta.id).toBe('notas-de-venta-local');
  });

  it('un XML mal formado no rompe el bus: no casa la condición', async () => {
    await bus.procesar(
      mensaje({ metodo: 'POST', ruta: '/comprobantes', cuerpoXml: '<roto' }),
      {},
    );

    expect(transporte.entregas[0]?.ruta.id).toBe('notas-de-venta-local');
  });

  it('registra que el ruteo fue por contenido', async () => {
    await bus.procesar(
      mensaje({ metodo: 'POST', ruta: '/comprobantes', cuerpoXml: comprobante('FACTURA') }),
      {},
    );

    const ruteado = auditoria.entradas.find((e) => e.accion === 'MENSAJE_RUTEADO');
    expect(ruteado?.detalle?.['porContenido']).toBe(true);
  });
});

describe('auditoría del bus (sesiones 31-34)', () => {
  it('registra el ruteo y la entrega de todo mensaje', async () => {
    await bus.procesar(mensaje(), undefined);

    expect(acciones()).toEqual(['MENSAJE_RUTEADO', 'MENSAJE_ENTREGADO']);
  });

  it('propaga el correlationId a las entradas, que es lo que permite la traza', async () => {
    await bus.procesar(mensaje({ correlationId: 'corr-venta-e2e' }), undefined);

    expect(auditoria.entradas.every((e) => e.correlationId === 'corr-venta-e2e')).toBe(true);
  });

  it('registra el mensaje que no encontró ruta', async () => {
    await expect(bus.procesar(mensaje({ ruta: '/x' }), undefined)).rejects.toThrow();

    expect(acciones()).toEqual(['MENSAJE_SIN_RUTA']);
  });

  it('registra la entrega fallida cuando el destino cae', async () => {
    transporte.fallar = new Error('destino caído');

    await expect(bus.procesar(mensaje(), undefined)).rejects.toThrow('destino caído');

    expect(acciones()).toEqual(['MENSAJE_RUTEADO', 'ENTREGA_FALLIDA']);
    const fallo = auditoria.entradas.at(-1);
    expect(fallo?.detalle?.['error']).toBe('destino caído');
  });

  it('mide cuánto tardó la entrega', async () => {
    await bus.procesar(mensaje(), undefined);

    const entregado = auditoria.entradas.find((e) => e.accion === 'MENSAJE_ENTREGADO');
    expect(entregado?.detalle?.['duracionMs']).toBeTypeOf('number');
  });

  it('el bus se identifica como emisor de sus propias entradas', async () => {
    await bus.procesar(mensaje(), undefined);

    expect(auditoria.entradas.every((e) => e.servicio === 'ESB')).toBe(true);
    expect(auditoria.entradas.every((e) => e.usuario === 'sistema')).toBe(true);
  });
});

describe('el bus no lleva lógica de negocio (CLAUDE.md §12)', () => {
  it('entrega el cuerpo sin modificarlo', async () => {
    const cuerpo = { sku: 'SH-500ML', cantidad: 3, total: 75.0 };

    await bus.procesar(mensaje({ metodo: 'GET' }), cuerpo);

    expect(transporte.entregas[0]?.cuerpo).toEqual(cuerpo);
  });

  it('devuelve la respuesta del destino tal cual', async () => {
    transporte.respuesta = {
      estado: 404,
      cuerpo: { exito: false, error: { codigo: 'NO_ENCONTRADO' } },
      cabeceras: {},
    };

    const r = await bus.procesar(mensaje(), undefined);

    // El bus no reinterpreta el 404 del servicio: lo transporta.
    expect(r.estado).toBe(404);
    expect(r.cuerpo).toEqual({ exito: false, error: { codigo: 'NO_ENCONTRADO' } });
  });
});

describe('TablaRuteo', () => {
  it('permite añadir rutas sin tocar la lógica del bus', () => {
    const t = new TablaRuteo();
    expect(t.rutas).toHaveLength(0);

    t.agregar(rutaCatalogo);
    expect(t.rutas).toHaveLength(1);
  });

  it('evalúa las rutas en orden de declaración', () => {
    const t = new TablaRuteo([
      { ...rutaCatalogo, id: 'primera' },
      { ...rutaCatalogo, id: 'segunda' },
    ]);

    expect(t.resolver(mensaje()).id).toBe('primera');
  });

  it('el método se compara sin distinguir mayúsculas', () => {
    const t = new TablaRuteo([rutaCatalogo]);
    expect(t.resolver(mensaje({ metodo: 'get' })).id).toBe('catalogo-lectura');
  });
});
