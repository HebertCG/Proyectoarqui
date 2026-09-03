/**
 * Rutas de `CierreCaja.Task`.
 *
 * Segundo consumidor de `@pos/orquestacion`. Que el motor sirva a dos procesos
 * distintos sin tocarlo es la evidencia de reutilización que pide P4 — no una
 * afirmación en un documento.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { exito, fallo, type Esb } from '@pos/service-kit';
import {
  cargarDefinicion,
  MotorBpmn,
  PROCESOS,
  type TrazaProceso,
} from '@pos/orquestacion';

import { construirActividades } from './actividades.js';

const EsquemaCerrar = Type.Object({
  cajaId: Type.String({ minLength: 1, maxLength: 60 }),
  // CIEGO: el cajero cuenta sin ver el monto esperado (RF-CAJA-06).
  modo: Type.Union([Type.Literal('CIEGO'), Type.Literal('ASISTIDO')]),
  montoContado: Type.Number({ minimum: 0 }),
  codigoAutorizacion: Type.String({ minLength: 1, maxLength: 60 }),
  observacion: Type.Optional(Type.String({ maxLength: 1000 })),
});

/** Los eventos de fin que `cierre-caja.bpmn` declara. */
export type DesenlaceCierre = 'FinCuadrado' | 'FinDescuadre';

/**
 * Los dos desenlaces devuelven **200**: en ambos el turno quedó cerrado. Un
 * descuadre no es un fallo de la operación, es un hecho del arqueo que hay que
 * informar — devolver un error haría pensar al terminal que el cierre no
 * ocurrió, y el cajero lo reintentaría.
 */
const DESENLACES: Record<DesenlaceCierre, { estado: number; codigo: string }> = {
  FinCuadrado: { estado: 200, codigo: 'CAJA_CUADRADA' },
  FinDescuadre: { estado: 200, codigo: 'CAJA_CERRADA_CON_DESCUADRE' },
};

function interpretar(
  traza: TrazaProceso,
): { desenlace: DesenlaceCierre; estado: number; codigo: string } | null {
  if (!traza.desenlace) return null;

  const conocido = Object.hasOwn(DESENLACES, traza.desenlace)
    ? DESENLACES[traza.desenlace as DesenlaceCierre]
    : undefined;

  if (!conocido) return null;
  return { desenlace: traza.desenlace as DesenlaceCierre, ...conocido };
}

export interface DependenciasCierre {
  esb: Esb;
  motor?: MotorBpmn | undefined;
}

export function registrarRutas(app: FastifyInstance, deps: DependenciasCierre): void {
  const motor = deps.motor ?? new MotorBpmn();
  const actividades = construirActividades(deps.esb);

  // ── EjecutarCierreCaja ──────────────────────────────────────────
  app.post(
    '/procesos/cierre-caja',
    { schema: { body: EsquemaCerrar } },
    async (peticion, respuesta) => {
      const entrada = peticion.body as Record<string, unknown>;

      const traza = await motor.ejecutar({
        proceso: 'CierreCaja',
        fuente: await cargarDefinicion(PROCESOS.CIERRE_CAJA),
        actividades,
        correlationId: peticion.correlationId,
        variables: { ...entrada },
      });

      await auditar(app, peticion.correlationId, traza);

      const desenlace = interpretar(traza);
      const meta = app.meta(peticion);

      if (!desenlace) {
        return respuesta.code(502).send(
          fallo(
            {
              codigo: 'PROCESO_INTERRUMPIDO',
              mensaje: traza.error ?? 'El cierre no alcanzó un desenlace conocido.',
              detalles: { traza },
            },
            meta,
          ),
        );
      }

      return respuesta.code(desenlace.estado).send(
        exito(
          {
            desenlace: desenlace.desenlace,
            codigo: desenlace.codigo,
            arqueo: traza.variables['arqueo'] ?? null,
            diferencia: traza.variables['diferencia'] ?? null,
            cuadrado: traza.variables['cuadrado'] === true,
            // Lo que quedó sin enviar a SUNAT al cerrar el turno. `null`
            // significa que ni siquiera se pudo consultar: no es cero.
            comprobantesPendientes: traza.variables['pendientesAlCerrar'] ?? null,
            reenviadosAlCerrar: traza.variables['reenviados'] ?? 0,
            traza,
          },
          meta,
        ),
      );
    },
  );

  // ── ConsultarDefinicionProceso ──────────────────────────────────
  app.get('/procesos/cierre-caja/definicion', async (peticion, respuesta) => {
    const fuente = await cargarDefinicion(PROCESOS.CIERRE_CAJA);

    respuesta.header('content-type', 'application/xml; charset=utf-8');
    return fuente;
  });
}

async function auditar(
  app: FastifyInstance,
  correlationId: string,
  traza: TrazaProceso,
): Promise<void> {
  await app.auditoria.registrar({
    correlationId,
    servicio: app.config.nombre,
    accion: `CIERRE_CAJA_${traza.desenlace ?? 'INTERRUMPIDO'}`,
    recurso: 'proceso',
    recursoId: String(traza.variables['turnoUuid'] ?? traza.variables['cajaId'] ?? 'desconocido'),
    usuario: 'orquestador',
    timestamp: new Date().toISOString(),
    detalle: {
      pasos: traza.pasos.map((p) => ({ actividad: p.actividad, resultado: p.resultado })),
      diferencia: traza.variables['diferencia'] ?? null,
      duracionMs: traza.duracionMs,
      ...(traza.error ? { error: traza.error } : {}),
    },
  });
}
