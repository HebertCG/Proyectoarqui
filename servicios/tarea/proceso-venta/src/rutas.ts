/**
 * Rutas de `ProcesoVenta.Task`.
 *
 * Un servicio de tarea expone **el proceso**, no las operaciones de los
 * servicios que coordina. Por eso hay una sola operación de negocio: ejecutar
 * la venta de principio a fin. Quien quiera cerrar un ticket suelto llama a
 * `Sales & Customer Service`; quien quiera el proceso completo con su
 * compensación, llama aquí.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { exito, fallo } from '@pos/service-kit';
import { cargarDefinicion, MotorBpmn, PROCESOS, type TrazaProceso } from '@pos/orquestacion';

import { construirActividades } from './actividades.js';
import type { Esb } from './cliente-esb.js';

const EsquemaPago = Type.Object({
  formaPago: Type.Union([
    Type.Literal('EFECTIVO'),
    Type.Literal('TARJETA'),
    Type.Literal('YAPE'),
    Type.Literal('PLIN'),
    Type.Literal('TRANSFERENCIA'),
    Type.Literal('CREDITO'),
  ]),
  monto: Type.Number({ exclusiveMinimum: 0 }),
  montoRecibido: Type.Optional(Type.Number({ minimum: 0 })),
  referencia: Type.Optional(Type.String({ maxLength: 60 })),
});

const EsquemaEjecutar = Type.Object({
  ticketUuid: Type.String({ format: 'uuid' }),
  tipoComprobante: Type.Union([
    Type.Literal('BOLETA'),
    Type.Literal('FACTURA'),
    Type.Literal('NOTA_VENTA'),
  ]),
  pagos: Type.Array(EsquemaPago, { minItems: 1 }),
  codigoAutorizacion: Type.String({ minLength: 1, maxLength: 60 }),
});

/** Los eventos de fin que `proceso-venta.bpmn` declara. */
export type DesenlaceVenta =
  | 'FinAceptado'
  | 'FinPendiente'
  | 'FinCompensado'
  | 'FinIncompatible';

/**
 * Cada evento de fin del modelo BPMN tiene una respuesta HTTP.
 *
 * La correspondencia es explícita a propósito: el diagrama define los
 * desenlaces posibles y esta tabla los traduce al protocolo. Si alguien añade
 * un fin al `.bpmn` sin decidir qué significa para el llamante, `interpretar`
 * lo detecta en el borde en vez de responder un estado inventado.
 */
const DESENLACES: Record<DesenlaceVenta, { estado: number; codigo: string }> = {
  FinAceptado: { estado: 200, codigo: 'VENTA_FACTURADA' },
  // La venta se cobró y el comprobante quedó en cola: es un éxito operativo.
  FinPendiente: { estado: 202, codigo: 'COMPROBANTE_PENDIENTE_DE_ENVIO' },
  // Se cobró y se revirtió: el llamante tiene que saber que no hay venta.
  FinCompensado: { estado: 409, codigo: 'VENTA_REVERTIDA' },
  // Nunca se cobró: el comprobante pedido no correspondía al documento.
  FinIncompatible: { estado: 422, codigo: 'COMPROBANTE_INCOMPATIBLE' },
};

/** `null` cuando el proceso abortó o alcanzó un fin que nadie mapeó. */
function interpretar(
  traza: TrazaProceso,
): { desenlace: DesenlaceVenta; estado: number; codigo: string } | null {
  if (!traza.desenlace) return null;

  const conocido = Object.hasOwn(DESENLACES, traza.desenlace)
    ? DESENLACES[traza.desenlace as DesenlaceVenta]
    : undefined;

  if (!conocido) return null;
  return { desenlace: traza.desenlace as DesenlaceVenta, ...conocido };
}

export interface DependenciasProceso {
  esb: Esb;
  motor?: MotorBpmn | undefined;
}

export function registrarRutas(app: FastifyInstance, deps: DependenciasProceso): void {
  const motor = deps.motor ?? new MotorBpmn();
  const actividades = construirActividades(deps.esb);

  // ── EjecutarProcesoVenta ────────────────────────────────────────
  app.post(
    '/procesos/venta',
    { schema: { body: EsquemaEjecutar } },
    async (peticion, respuesta) => {
      const entrada = peticion.body as {
        ticketUuid: string;
        tipoComprobante: string;
        pagos: unknown[];
        codigoAutorizacion: string;
      };

      const traza = await motor.ejecutar({
        proceso: 'ProcesoVenta',
        fuente: await cargarDefinicion(PROCESOS.PROCESO_VENTA),
        actividades,
        compensaciones: { RevertirVenta: 'CerrarVenta' },
        correlationId: peticion.correlationId,
        variables: { ...entrada },
      });

      await auditar(app, peticion.correlationId, traza);

      const desenlace = interpretar(traza);
      const meta = app.meta(peticion);

      // Sin desenlace conocido el proceso abortó a mitad de camino: es un fallo
      // de dependencia, no del llamante. La traza dice hasta dónde llegó.
      if (!desenlace) {
        return respuesta.code(502).send(
          fallo(
            {
              codigo: 'PROCESO_INTERRUMPIDO',
              mensaje: traza.error ?? 'El proceso no alcanzó un desenlace conocido.',
              detalles: { traza },
            },
            meta,
          ),
        );
      }

      const resultado = {
        desenlace: desenlace.desenlace,
        codigo: desenlace.codigo,
        documento: traza.variables['documento'] ?? null,
        comprobanteUuid: traza.variables['comprobanteUuid'] ?? null,
        estadoTributario: traza.variables['estadoTributario'] ?? null,
        vuelto: traza.variables['vuelto'] ?? null,
        compensado: traza.compensado,
        traza,
      };

      // Los desenlaces que no dejan venta válida se devuelven como error aunque
      // el proceso haya terminado bien: el llamante necesita distinguirlos.
      const sinVenta =
        desenlace.desenlace === 'FinCompensado' ||
        desenlace.desenlace === 'FinIncompatible';

      return respuesta
        .code(desenlace.estado)
        .send(
          sinVenta
            ? fallo(
                {
                  codigo: desenlace.codigo,
                  mensaje: mensajeDe(traza, desenlace.desenlace),
                  detalles: resultado,
                },
                meta,
              )
            : exito(resultado, meta),
        );
    },
  );

  // ── ConsultarDefinicionProceso ──────────────────────────────────
  // El modelo es un artefacto consultable: quien integra puede ver el proceso
  // que va a ejecutar antes de invocarlo (P7 — descubribilidad).
  app.get('/procesos/venta/definicion', async (peticion, respuesta) => {
    const fuente = await cargarDefinicion(PROCESOS.PROCESO_VENTA);

    respuesta.header('content-type', 'application/xml; charset=utf-8');
    respuesta.header(CABECERA_CORRELACION_SALIENTE, peticion.correlationId);
    return fuente;
  });
}

const CABECERA_CORRELACION_SALIENTE = 'x-correlation-id';

function mensajeDe(traza: TrazaProceso, desenlace: DesenlaceVenta): string {
  if (desenlace === 'FinIncompatible') {
    return (
      (traza.variables['motivoIncompatibilidad'] as string | null) ??
      'El comprobante no corresponde al documento del cliente.'
    );
  }

  return (
    'SUNAT rechazó el comprobante de forma definitiva y la venta fue revertida: ' +
    ((traza.variables['motivoSunat'] as string | null) ?? 'sin detalle')
  );
}

/**
 * La traza del proceso entra a la auditoría como una sola entrada. Los pasos
 * individuales ya se auditaron en cada servicio; lo que falta registrar es la
 * decisión del orquestador.
 */
async function auditar(
  app: FastifyInstance,
  correlationId: string,
  traza: TrazaProceso,
): Promise<void> {
  await app.auditoria.registrar({
    correlationId,
    servicio: app.config.nombre,
    accion: `PROCESO_VENTA_${traza.desenlace ?? 'INTERRUMPIDO'}`,
    recurso: 'proceso',
    recursoId: String(traza.variables['ticketUuid'] ?? 'desconocido'),
    usuario: 'orquestador',
    timestamp: new Date().toISOString(),
    detalle: {
      pasos: traza.pasos.map((p) => ({ actividad: p.actividad, resultado: p.resultado })),
      compensado: traza.compensado,
      duracionMs: traza.duracionMs,
      ...(traza.error ? { error: traza.error } : {}),
    },
  });
}
