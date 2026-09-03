/**
 * Las actividades del modelo `cierre-caja.bpmn`.
 *
 * Cada clave es el id de una `serviceTask` del diagrama. Todas las salidas van
 * por el ESB (CLAUDE.md §9.1 regla 8).
 */
import type { Actividad, ContextoActividad } from '@pos/orquestacion';
import { exigirExito, type Esb } from '@pos/service-kit';

/** Modos de arqueo. CIEGO: el cajero cuenta sin ver el esperado (RF-CAJA-06). */
export type ModoArqueo = 'CIEGO' | 'ASISTIDO';

export interface EntradaCierre {
  cajaId: string;
  modo: ModoArqueo;
  montoContado: number;
  codigoAutorizacion: string;
  observacion?: string | undefined;
}

interface Arqueo {
  turnoUuid: string;
  modo: ModoArqueo;
  montoEsperado: number;
  montoContado: number;
  diferencia: number;
  desglose: unknown;
}

/**
 * Tolerancia de arqueo, en soles.
 *
 * Cero: una caja cuadra o no cuadra. Un margen "razonable" es exactamente el
 * hueco por donde se escapan los faltantes pequeños y repetidos, que es la
 * forma más común de merma en caja. Si el negocio quiere tolerancia, se declara
 * aquí de forma explícita y queda a la vista.
 */
export const TOLERANCIA_ARQUEO = 0;

function exigirVariable<T>(ctx: ContextoActividad, nombre: string): T {
  const valor = ctx.variables[nombre];
  if (valor === undefined || valor === null) {
    throw new Error(
      `El proceso llegó a este paso sin "${nombre}". Revisa el orden del modelo BPMN.`,
    );
  }
  return valor as T;
}

export function construirActividades(esb: Esb): Record<string, Actividad> {
  return {
    /** El turno vigente de esta caja. Sin turno abierto no hay nada que cerrar. */
    ConsultarTurno: async (ctx) => {
      const cajaId = exigirVariable<string>(ctx, 'cajaId');

      const respuesta = await esb.llamar<{ uuid: string; estado: string }>({
        metodo: 'GET',
        ruta: `/caja/turnos/actual?cajaId=${encodeURIComponent(cajaId)}`,
        correlationId: ctx.correlationId,
      });

      const turno = exigirExito(respuesta, 'Al consultar el turno abierto');

      return { turnoUuid: turno.uuid, estadoTurno: turno.estado };
    },

    /**
     * Último intento de vaciar la cola de comprobantes antes de cerrar.
     *
     * **Best-effort a propósito.** Si SUNAT no responde, el turno se cierra
     * igual: bloquear el cierre del día por un problema de red sería lo
     * contrario del diseño local-first (RNF-01). Lo que sí hace es dejar
     * contado cuántos quedaron, para que el cierre lo informe.
     */
    DrenarPendientes: async (ctx) => {
      const pendientes = await esb.llamar<Array<{ uuid: string }>>({
        metodo: 'GET',
        ruta: '/comprobantes/pendientes?limite=50',
        correlationId: ctx.correlationId,
      });

      // Ni siquiera poder preguntar es un caso normal estando sin conexión.
      if (pendientes.estado >= 300 || pendientes.datos === null) {
        return { pendientesAlCerrar: null, reenviados: 0, drenajeOmitido: true };
      }

      let reenviados = 0;

      for (const comprobante of pendientes.datos) {
        const envio = await esb.llamar<{ comprobante: { estadoTributario: string } }>({
          metodo: 'POST',
          ruta: `/comprobantes/${comprobante.uuid}/envio`,
          correlationId: ctx.correlationId,
        });

        if (
          envio.estado < 300 &&
          envio.datos?.comprobante.estadoTributario === 'ACEPTADO'
        ) {
          reenviados += 1;
        }
      }

      return {
        pendientesAlCerrar: pendientes.datos.length - reenviados,
        reenviados,
        drenajeOmitido: false,
      };
    },

    /** Arqueo y cierre. A partir de aquí el turno ya no admite movimientos. */
    CerrarTurno: async (ctx) => {
      const turnoUuid = exigirVariable<string>(ctx, 'turnoUuid');
      const modo = exigirVariable<ModoArqueo>(ctx, 'modo');
      const montoContado = exigirVariable<number>(ctx, 'montoContado');
      const codigoAutorizacion = exigirVariable<string>(ctx, 'codigoAutorizacion');
      const observacion = ctx.variables['observacion'] as string | undefined;

      const respuesta = await esb.llamar<Arqueo>({
        metodo: 'POST',
        ruta: `/caja/turnos/${turnoUuid}/cierre`,
        correlationId: ctx.correlationId,
        cuerpo: {
          modo,
          montoContado,
          codigoAutorizacion,
          ...(observacion ? { observacion } : {}),
        },
        // El uuid del turno: UUIDv4 y estable. Reenviar el cierre no vuelve a
        // cerrar ni produce un segundo arqueo.
        claveIdempotencia: turnoUuid,
      });

      const arqueo = exigirExito(respuesta, 'Al cerrar el turno');

      return {
        arqueo,
        montoEsperado: arqueo.montoEsperado,
        diferencia: arqueo.diferencia,
        cuadrado: Math.abs(arqueo.diferencia) <= TOLERANCIA_ARQUEO,
      };
    },
  };
}
