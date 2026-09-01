/**
 * Rutas del sub-dominio **Caja**.
 *
 * Contract-first: cada operación corresponde a un `operationId` de
 * `contratos/openapi/sales-customer-v1.yaml`.
 *
 * Las operaciones sensibles —abrir y cerrar turno— exigen `codigoAutorizacion`
 * de supervisor (ADR-001, RNF-06). La auditoría registra **quién autorizó**, que
 * puede no ser quien opera.
 */
import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  exito,
  errorConflicto,
  errorNoEncontrado,
  errorReglaNegocio,
} from '@pos/service-kit';

import {
  calcularDesglose,
  calcularDiferencia,
  calcularMontoActual,
  calcularMontoEsperado,
  normalizarMonto,
} from './calculos.js';
import type { FormaPago, RepositorioCaja, TurnoCaja } from './repositorio.js';

const FORMAS_PAGO = [
  Type.Literal('EFECTIVO'),
  Type.Literal('TARJETA_DEBITO'),
  Type.Literal('TARJETA_CREDITO'),
  Type.Literal('YAPE'),
  Type.Literal('PLIN'),
  Type.Literal('TRANSFERENCIA'),
  Type.Literal('PUNTOS'),
];

const EsquemaAbrir = Type.Object({
  cajaId: Type.String({ minLength: 1, maxLength: 60 }),
  fondoInicial: Type.Number({ minimum: 0 }),
  codigoAutorizacion: Type.String({ minLength: 1 }),
});

const EsquemaMovimiento = Type.Object({
  tipo: Type.Union([Type.Literal('INGRESO'), Type.Literal('EGRESO')]),
  formaPago: Type.Union(FORMAS_PAGO),
  monto: Type.Number({ exclusiveMinimum: 0 }),
  // RF-CAJA-03: el motivo es obligatorio en movimientos manuales.
  motivo: Type.String({ minLength: 1, maxLength: 1000 }),
});

const EsquemaCierre = Type.Object({
  modo: Type.Union([Type.Literal('CIEGO'), Type.Literal('ASISTIDO')]),
  montoContado: Type.Number({ minimum: 0 }),
  observacion: Type.Optional(Type.String({ maxLength: 1000 })),
  codigoAutorizacion: Type.String({ minLength: 1 }),
});

/** Usuario que autorizó, resuelto a partir del código de un solo uso. */
function autorizante(codigo: string): string {
  // El canje real del código lo hará Seguridad (ADR-001). Mientras tanto el
  // código lo transporta, para que la auditoría ya registre al supervisor.
  return codigo.startsWith('sup:') ? codigo.slice(4) : 'supervisor';
}

export function registrarRutasCaja(
  app: FastifyInstance,
  repositorio: RepositorioCaja,
): void {
  // ── AbrirTurno ──────────────────────────────────────────────────
  app.post(
    '/caja/turnos',
    { schema: { body: EsquemaAbrir } },
    async (peticion, respuesta) => {
      const { cajaId, fondoInicial, codigoAutorizacion } = peticion.body as {
        cajaId: string;
        fondoInicial: number;
        codigoAutorizacion: string;
      };

      if (await repositorio.turnoAbierto(cajaId)) {
        throw errorConflicto(
          'TURNO_YA_ABIERTO',
          `La caja ${cajaId} ya tiene un turno abierto. Ciérralo antes de abrir otro.`,
        );
      }

      const autorizadoPor = autorizante(codigoAutorizacion);
      const ahora = new Date();

      const turno: TurnoCaja = {
        uuid: randomUUID(),
        cajaId,
        estado: 'ABIERTO',
        fondoInicial,
        abiertoPor: autorizadoPor,
        abiertoEn: ahora,
        // El fondo inicial entra como movimiento para que el arqueo cuadre
        // sumando, sin tratarlo como caso especial.
        movimientos: [
          {
            uuid: randomUUID(),
            tipo: 'FONDO_INICIAL',
            formaPago: 'EFECTIVO',
            monto: fondoInicial,
            motivo: 'Fondo inicial de apertura',
            registradoPor: autorizadoPor,
            registradoEn: ahora,
          },
        ],
      };

      await repositorio.abrir(turno);

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: 'CAJA_ABIERTA',
        recurso: 'turno-caja',
        recursoId: turno.uuid,
        usuario: autorizadoPor,
        timestamp: ahora.toISOString(),
        detalle: { cajaId, fondoInicial },
      });

      return respuesta.code(201).send(exito(conMonto(turno), app.meta(peticion)));
    },
  );

  // ── ConsultarTurnoActual ────────────────────────────────────────
  app.get(
    '/caja/turnos/actual',
    { schema: { querystring: Type.Object({ cajaId: Type.String({ minLength: 1 }) }) } },
    async (peticion) => {
      const { cajaId } = peticion.query as { cajaId: string };
      const turno = await repositorio.turnoAbierto(cajaId);

      if (!turno) {
        throw errorNoEncontrado(
          'TURNO_NO_ABIERTO',
          `La caja ${cajaId} no tiene ningún turno abierto.`,
        );
      }

      return exito(conMonto(turno), app.meta(peticion));
    },
  );

  // ── RegistrarMovimientoCaja ─────────────────────────────────────
  app.post(
    '/caja/turnos/:uuid/movimientos',
    {
      schema: {
        params: Type.Object({ uuid: Type.String({ format: 'uuid' }) }),
        body: EsquemaMovimiento,
      },
    },
    async (peticion, respuesta) => {
      const { uuid } = peticion.params as { uuid: string };
      const cuerpo = peticion.body as {
        tipo: 'INGRESO' | 'EGRESO';
        formaPago: FormaPago;
        monto: number;
        motivo: string;
      };

      const turno = await exigirTurnoAbierto(repositorio, uuid);

      const movimiento = {
        uuid: randomUUID(),
        tipo: cuerpo.tipo,
        formaPago: cuerpo.formaPago,
        // Los egresos se guardan negativos: así el arqueo suma sin condicionales.
        monto: normalizarMonto(cuerpo.tipo, cuerpo.monto),
        motivo: cuerpo.motivo,
        registradoPor: 'cajero',
        registradoEn: new Date(),
      };

      await repositorio.agregarMovimiento(turno.uuid, movimiento);

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: cuerpo.tipo === 'INGRESO' ? 'CAJA_INGRESO' : 'CAJA_EGRESO',
        recurso: 'movimiento-caja',
        recursoId: movimiento.uuid,
        usuario: movimiento.registradoPor,
        timestamp: movimiento.registradoEn.toISOString(),
        detalle: { monto: cuerpo.monto, motivo: cuerpo.motivo, turnoUuid: turno.uuid },
      });

      return respuesta.code(201).send(exito(movimiento, app.meta(peticion)));
    },
  );

  // ── CerrarTurno ─────────────────────────────────────────────────
  app.post(
    '/caja/turnos/:uuid/cierre',
    {
      schema: {
        params: Type.Object({ uuid: Type.String({ format: 'uuid' }) }),
        body: EsquemaCierre,
      },
    },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      const cuerpo = peticion.body as {
        modo: 'CIEGO' | 'ASISTIDO';
        montoContado: number;
        observacion?: string;
        codigoAutorizacion: string;
      };

      const turno = await exigirTurnoAbierto(repositorio, uuid);
      const autorizadoPor = autorizante(cuerpo.codigoAutorizacion);

      const montoEsperado = calcularMontoEsperado(turno);
      const arqueo = {
        turnoUuid: turno.uuid,
        modo: cuerpo.modo,
        montoEsperado,
        montoContado: cuerpo.montoContado,
        diferencia: calcularDiferencia(montoEsperado, cuerpo.montoContado),
        observacion: cuerpo.observacion,
        desglose: calcularDesglose(turno),
      };

      await repositorio.cerrar(turno.uuid, arqueo, autorizadoPor);

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: 'CAJA_CERRADA',
        recurso: 'turno-caja',
        recursoId: turno.uuid,
        usuario: autorizadoPor,
        timestamp: new Date().toISOString(),
        detalle: {
          modo: arqueo.modo,
          montoEsperado: arqueo.montoEsperado,
          montoContado: arqueo.montoContado,
          diferencia: arqueo.diferencia,
        },
      });

      return exito(arqueo, app.meta(peticion));
    },
  );

  // ── ConsultarCierres ────────────────────────────────────────────
  app.get(
    '/caja/cierres',
    {
      schema: {
        querystring: Type.Object({
          desde: Type.Optional(Type.String({ format: 'date' })),
          hasta: Type.Optional(Type.String({ format: 'date' })),
        }),
      },
    },
    async (peticion) => {
      const { desde, hasta } = peticion.query as { desde?: string; hasta?: string };

      const cierres = await repositorio.cierres(
        desde ? new Date(desde) : undefined,
        hasta ? new Date(hasta) : undefined,
      );

      return exito(cierres, app.meta(peticion), {
        total: cierres.length,
        pagina: 1,
        limite: cierres.length,
      });
    },
  );
}

/** El monto actual se calcula, no se guarda: guardarlo invita a desincronizarse. */
function conMonto(turno: TurnoCaja): TurnoCaja & { montoActual: number } {
  return { ...turno, montoActual: calcularMontoActual(turno) };
}

async function exigirTurnoAbierto(
  repositorio: RepositorioCaja,
  uuid: string,
): Promise<TurnoCaja> {
  const turno = await repositorio.porUuid(uuid);

  if (!turno) {
    throw errorNoEncontrado('TURNO_NO_ENCONTRADO', `No existe el turno ${uuid}.`);
  }

  if (turno.estado === 'CERRADO') {
    throw errorReglaNegocio(
      'TURNO_CERRADO',
      'El turno ya fue cerrado. Los movimientos de caja son append-only y no se ' +
        'pueden añadir a un turno cerrado.',
    );
  }

  return turno;
}
