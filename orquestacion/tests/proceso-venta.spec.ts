/**
 * Estas pruebas corren el `.bpmn` REAL de `ProcesoVenta`, no una maqueta.
 *
 * Es lo que impide que el diagrama y el comportamiento se separen: si alguien
 * mueve una flecha en Camunda Modeler y rompe una ruta, aquí se cae.
 */
import { describe, expect, it } from 'vitest';

import { cargarDefinicion, MotorBpmn, PROCESOS, type Actividad } from '../src/index.js';

const COMPENSACIONES = { RevertirVenta: 'CerrarVenta' };

/** Actividades que siempre funcionan. Cada prueba sustituye las que le importan. */
function actividadesBase(): Record<string, Actividad> {
  return {
    VerificarComprobante: async () => ({ compatible: true }),
    CerrarVenta: async () => ({
      comprobanteUuid: 'c-1',
      documento: 'F001-1',
      total: 120,
    }),
    RegistrarComprobante: async () => ({ registrado: true }),
    EnviarASunat: async () => ({ aceptado: true, reintentable: false }),
    RevertirVenta: async () => ({ revertido: true }),
  };
}

async function ejecutar(
  sobrescribe: Partial<Record<string, Actividad>> = {},
): ReturnType<MotorBpmn['ejecutar']> {
  return new MotorBpmn().ejecutar({
    proceso: 'ProcesoVenta',
    fuente: await cargarDefinicion(PROCESOS.PROCESO_VENTA),
    actividades: { ...actividadesBase(), ...sobrescribe },
    compensaciones: COMPENSACIONES,
    correlationId: 'corr-prueba',
    variables: { ticketUuid: 't-1' },
  });
}

describe('ProcesoVenta — camino feliz', () => {
  it('termina en FinAceptado cuando SUNAT acepta el comprobante', async () => {
    const traza = await ejecutar();

    expect(traza.desenlace).toBe('FinAceptado');
    expect(traza.error).toBeUndefined();
    expect(traza.compensado).toBe(false);
  });

  it('ejecuta los cuatro pasos del proceso en el orden del modelo', async () => {
    const traza = await ejecutar();

    expect(traza.pasos.map((p) => p.actividad)).toEqual([
      'VerificarComprobante',
      'CerrarVenta',
      'RegistrarComprobante',
      'EnviarASunat',
    ]);
  });

  it('acumula en las variables lo que aporta cada actividad', async () => {
    const traza = await ejecutar();

    expect(traza.variables).toMatchObject({
      ticketUuid: 't-1',
      compatible: true,
      documento: 'F001-1',
      registrado: true,
      aceptado: true,
    });
  });

  it('propaga el correlationId a cada actividad', async () => {
    const vistos: string[] = [];
    await ejecutar({
      VerificarComprobante: async (ctx) => {
        vistos.push(ctx.correlationId);
        return { compatible: true };
      },
      EnviarASunat: async (ctx) => {
        vistos.push(ctx.correlationId);
        return { aceptado: true, reintentable: false };
      },
    });

    expect(vistos).toEqual(['corr-prueba', 'corr-prueba']);
  });
});

describe('ProcesoVenta — el comprobante no corresponde al documento', () => {
  it('termina en FinIncompatible', async () => {
    const traza = await ejecutar({
      VerificarComprobante: async () => ({ compatible: false }),
    });

    expect(traza.desenlace).toBe('FinIncompatible');
  });

  it('NO cobra: corta antes de cerrar la venta (RF-POS-18)', async () => {
    let cobrado = false;
    const traza = await ejecutar({
      VerificarComprobante: async () => ({ compatible: false }),
      CerrarVenta: async () => {
        cobrado = true;
        return {};
      },
    });

    expect(cobrado).toBe(false);
    expect(traza.pasos.map((p) => p.actividad)).toEqual(['VerificarComprobante']);
  });
});

describe('ProcesoVenta — sin conexión con SUNAT', () => {
  it('termina en FinPendiente, no compensa (RNF-01: local-first)', async () => {
    const traza = await ejecutar({
      EnviarASunat: async () => ({ aceptado: false, reintentable: true }),
    });

    expect(traza.desenlace).toBe('FinPendiente');
    expect(traza.compensado).toBe(false);
  });

  it('la venta queda cerrada: un corte de red no revierte lo cobrado', async () => {
    let revertido = false;
    const traza = await ejecutar({
      EnviarASunat: async () => ({ aceptado: false, reintentable: true }),
      RevertirVenta: async () => {
        revertido = true;
        return {};
      },
    });

    expect(revertido).toBe(false);
    expect(traza.pasos.find((p) => p.actividad === 'CerrarVenta')?.resultado).toBe('OK');
  });
});

describe('ProcesoVenta — SUNAT rechaza de forma definitiva', () => {
  const rechazo = {
    EnviarASunat: async () => ({ aceptado: false, reintentable: false }),
  };

  it('termina en FinCompensado', async () => {
    const traza = await ejecutar(rechazo);
    expect(traza.desenlace).toBe('FinCompensado');
  });

  it('ejecuta la compensación de la venta', async () => {
    let revertido = false;
    await ejecutar({
      ...rechazo,
      RevertirVenta: async () => {
        revertido = true;
        return { revertido: true };
      },
    });

    expect(revertido).toBe(true);
  });

  it('marca en la traza que el cierre quedó revertido', async () => {
    const traza = await ejecutar(rechazo);

    expect(traza.compensado).toBe(true);
    expect(traza.pasos.find((p) => p.actividad === 'CerrarVenta')?.resultado).toBe(
      'COMPENSADO',
    );
  });

  it('compensa DESPUÉS de haber intentado el envío, no antes', async () => {
    const orden: string[] = [];
    await ejecutar({
      EnviarASunat: async () => {
        orden.push('envio');
        return { aceptado: false, reintentable: false };
      },
      RevertirVenta: async () => {
        orden.push('reversion');
        return {};
      },
    });

    expect(orden).toEqual(['envio', 'reversion']);
  });
});

describe('ProcesoVenta — una actividad falla', () => {
  it('devuelve la traza con el paso en ERROR en vez de lanzar', async () => {
    const traza = await ejecutar({
      RegistrarComprobante: async () => {
        throw new Error('E-Invoicing no responde');
      },
    });

    const paso = traza.pasos.find((p) => p.actividad === 'RegistrarComprobante');
    expect(paso?.resultado).toBe('ERROR');
    expect(paso?.error).toContain('E-Invoicing no responde');
  });

  it('deja constancia de hasta dónde llegó el proceso', async () => {
    const traza = await ejecutar({
      RegistrarComprobante: async () => {
        throw new Error('caido');
      },
    });

    expect(traza.pasos.map((p) => p.actividad)).toEqual([
      'VerificarComprobante',
      'CerrarVenta',
      'RegistrarComprobante',
    ]);
    expect(traza.desenlace).toBeUndefined();
  });
});

describe('ProcesoVenta — traza', () => {
  it('mide la duración de cada paso y del proceso completo', async () => {
    const traza = await ejecutar();

    expect(traza.duracionMs).toBeGreaterThanOrEqual(0);
    for (const paso of traza.pasos) {
      expect(paso.duracionMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('recorre los eventos y compuertas del modelo, no solo las tareas', async () => {
    const traza = await ejecutar();

    expect(traza.recorrido).toContain('Inicio');
    expect(traza.recorrido).toContain('PuertaCompatible');
    expect(traza.recorrido).toContain('PuertaResultado');
    expect(traza.recorrido).toContain('FinAceptado');
  });
});
