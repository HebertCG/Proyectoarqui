import { beforeEach, describe, expect, it } from 'vitest';

import {
  cargarDefinicion,
  limpiarCache,
  PROCESOS,
  type NombreProceso,
} from '../src/definiciones.js';

describe('cargarDefinicion', () => {
  beforeEach(() => {
    limpiarCache();
  });

  it('devuelve el XML del proceso pedido', async () => {
    const fuente = await cargarDefinicion(PROCESOS.PROCESO_VENTA);

    expect(fuente).toContain('<bpmn:process id="ProcesoVenta"');
    expect(fuente).toContain('isExecutable="true"');
  });

  it('el modelo declara todas las tareas que el motor tendrá que resolver', async () => {
    const fuente = await cargarDefinicion(PROCESOS.PROCESO_VENTA);

    for (const actividad of [
      'VerificarComprobante',
      'CerrarVenta',
      'RegistrarComprobante',
      'EnviarASunat',
      'RevertirVenta',
    ]) {
      expect(fuente).toContain(`environment.services.${actividad}`);
    }
  });

  it('el modelo trae su diagrama: se puede abrir en Camunda Modeler', async () => {
    const fuente = await cargarDefinicion(PROCESOS.PROCESO_VENTA);

    expect(fuente).toContain('<bpmndi:BPMNDiagram');
    expect(fuente).toContain('<bpmndi:BPMNPlane');
  });

  it('cachea: la segunda lectura devuelve exactamente lo mismo', async () => {
    const primera = await cargarDefinicion(PROCESOS.PROCESO_VENTA);
    const segunda = await cargarDefinicion(PROCESOS.PROCESO_VENTA);

    expect(segunda).toBe(primera);
  });

  it('falla con un mensaje que dice qué archivo faltaba', async () => {
    await expect(
      cargarDefinicion('proceso-inexistente' as NombreProceso),
    ).rejects.toThrow(/proceso-inexistente/);
  });
});

describe('el motor sirve a más de un proceso (P4 — reutilización)', () => {
  it('CierreCaja también está publicado y es ejecutable', async () => {
    const fuente = await cargarDefinicion(PROCESOS.CIERRE_CAJA);

    expect(fuente).toContain('<bpmn:process id="CierreCaja"');
    expect(fuente).toContain('isExecutable="true"');
  });

  it('los dos procesos son archivos distintos: no comparten definición', async () => {
    const venta = await cargarDefinicion(PROCESOS.PROCESO_VENTA);
    const cierre = await cargarDefinicion(PROCESOS.CIERRE_CAJA);

    expect(venta).not.toBe(cierre);
    expect(cierre).not.toContain('<bpmn:process id="ProcesoVenta"');
    expect(venta).not.toContain('<bpmn:process id="CierreCaja"');
  });

  it('CierreCaja NO declara compensación, y es deliberado', async () => {
    // Cerrar un turno no se deshace. Si alguien añade una compensación aquí,
    // tiene que justificarla — y este test se cae para obligar a hacerlo.
    const fuente = await cargarDefinicion(PROCESOS.CIERRE_CAJA);

    expect(fuente).not.toContain('compensateEventDefinition');
  });
});
