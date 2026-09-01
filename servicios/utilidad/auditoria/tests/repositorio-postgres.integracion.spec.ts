/**
 * Pruebas de INTEGRACIÓN contra PostgreSQL real.
 *
 * Requieren la infraestructura levantada (`pnpm infra:up`) y la migración
 * aplicada. Si la base no responde, las pruebas se **saltan** en vez de fallar:
 * un desarrollador sin Docker no debe ver rojo por eso.
 *
 * Prueban lo que el repositorio en memoria no puede garantizar:
 * que la idempotencia funcione de verdad a nivel de base, con `ON CONFLICT`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';

import { RepositorioPostgres } from '../src/repositorio-postgres.js';
import type { EntradaAuditoria } from '../src/repositorio.js';

const URL =
  process.env['DATABASE_URL'] ??
  `postgres://${process.env['POSTGRES_USER'] ?? 'pos'}:` +
    `${process.env['POSTGRES_PASSWORD'] ?? 'pos_dev_local'}@` +
    `${process.env['POSTGRES_HOST'] ?? 'localhost'}:` +
    `${process.env['POSTGRES_PORT'] ?? '5433'}/svc_auditoria`;

let hayBase = false;
let repositorio: RepositorioPostgres;
let sql: postgres.Sql;

beforeAll(async () => {
  try {
    sql = postgres(URL, { connect_timeout: 3 });
    await sql`SELECT 1 FROM entradas_auditoria LIMIT 1`;
    hayBase = true;
    repositorio = new RepositorioPostgres(URL);
  } catch {
    // Sin base disponible: las pruebas se saltan, no fallan.
    hayBase = false;
  }
});

afterAll(async () => {
  if (hayBase) {
    await repositorio.cerrar();
    await sql.end();
  }
});

beforeEach(async () => {
  if (hayBase) await sql`TRUNCATE entradas_auditoria`;
});

const uuid = (n: number) =>
  `3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a${String(n).padStart(2, '0')}`;

const entrada = (n: number, parcial: Partial<EntradaAuditoria> = {}): EntradaAuditoria => ({
  uuid: uuid(n),
  correlationId: 'corr-integracion',
  servicio: 'Sales.Customer.Entity',
  accion: 'VENTA_REGISTRADA',
  recurso: 'ticket',
  recursoId: `tk-${n}`,
  usuario: 'cajero01',
  timestamp: new Date('2026-08-29T10:00:00.000Z'),
  ...parcial,
});

describe.runIf(process.env['SALTAR_INTEGRACION'] !== 'true')(
  'RepositorioPostgres (integración)',
  () => {
    it('persiste una entrada y la recupera', async () => {
      if (!hayBase) return;

      expect(await repositorio.registrar(entrada(1))).toBe(true);

      const traza = await repositorio.traza('corr-integracion');
      expect(traza).toHaveLength(1);
      expect(traza[0]?.accion).toBe('VENTA_REGISTRADA');
      expect(traza[0]?.usuario).toBe('cajero01');
    });

    it('la idempotencia la hace cumplir la BASE, no el código', async () => {
      if (!hayBase) return;

      // ON CONFLICT DO NOTHING sobre la clave primaria: es atómico y no
      // requiere leer antes de escribir.
      expect(await repositorio.registrar(entrada(1))).toBe(true);
      expect(await repositorio.registrar(entrada(1))).toBe(false);
      expect(await repositorio.registrar(entrada(1))).toBe(false);

      const [{ total }] = await sql<{ total: number }[]>`
        SELECT count(*)::int AS total FROM entradas_auditoria
      `;
      expect(total).toBe(1);
    });

    it('dos escrituras SIMULTÁNEAS del mismo uuid insertan una sola vez', async () => {
      if (!hayBase) return;

      // Este es el caso que el repositorio en memoria no puede demostrar:
      // sin atomicidad en la base, ambas podrían insertar.
      const resultados = await Promise.all([
        repositorio.registrar(entrada(7)),
        repositorio.registrar(entrada(7)),
        repositorio.registrar(entrada(7)),
      ]);

      expect(resultados.filter(Boolean)).toHaveLength(1);

      const [{ total }] = await sql<{ total: number }[]>`
        SELECT count(*)::int AS total FROM entradas_auditoria
      `;
      expect(total).toBe(1);
    });

    it('el lote distingue insertadas de duplicadas', async () => {
      if (!hayBase) return;

      await repositorio.registrar(entrada(1));

      const r = await repositorio.registrarLote([entrada(1), entrada(2), entrada(3)]);
      expect(r).toEqual({ insertadas: 2, duplicadas: 1 });
    });

    it('un lote vacío no toca la base', async () => {
      if (!hayBase) return;
      expect(await repositorio.registrarLote([])).toEqual({
        insertadas: 0,
        duplicadas: 0,
      });
    });

    it('guarda y recupera el detalle como JSONB', async () => {
      if (!hayBase) return;

      await repositorio.registrar(
        entrada(1, { detalle: { total: 120.5, comprobante: 'F001-128', lineas: 2 } }),
      );

      const traza = await repositorio.traza('corr-integracion');
      expect(traza[0]?.detalle).toEqual({
        total: 120.5,
        comprobante: 'F001-128',
        lineas: 2,
      });
    });

    it('pone recibidoEn aunque el emisor no lo mande', async () => {
      if (!hayBase) return;

      await repositorio.registrar(entrada(1));

      const traza = await repositorio.traza('corr-integracion');
      expect(traza[0]?.recibidoEn).toBeInstanceOf(Date);
    });

    it('la traza sale en orden cronológico, no de inserción', async () => {
      if (!hayBase) return;

      // Se insertan desordenadas a propósito.
      await repositorio.registrarLote([
        entrada(3, { accion: 'COMPROBANTE_ACEPTADO', timestamp: new Date('2026-08-29T10:00:09Z') }),
        entrada(1, { accion: 'VENTA_REGISTRADA', timestamp: new Date('2026-08-29T10:00:00Z') }),
        entrada(2, { accion: 'MENSAJE_RUTEADO', timestamp: new Date('2026-08-29T10:00:01Z') }),
      ]);

      const traza = await repositorio.traza('corr-integracion');
      expect(traza.map((e) => e.accion)).toEqual([
        'VENTA_REGISTRADA',
        'MENSAJE_RUTEADO',
        'COMPROBANTE_ACEPTADO',
      ]);
    });

    describe('búsqueda', () => {
      beforeEach(async () => {
        if (!hayBase) return;
        await repositorio.registrarLote([
          entrada(1, { servicio: 'Sales.Customer.Entity', usuario: 'cajero01' }),
          entrada(2, {
            servicio: 'EInvoicing.Entity',
            accion: 'COMPROBANTE_ACEPTADO',
            usuario: 'sistema',
            timestamp: new Date('2026-08-29T12:00:00Z'),
          }),
          entrada(3, {
            servicio: 'Sales.Customer.Entity',
            accion: 'VENTA_ANULADA',
            usuario: 'supervisor01',
            timestamp: new Date('2026-08-29T18:00:00Z'),
          }),
        ]);
      });

      it('filtra por servicio', async () => {
        if (!hayBase) return;
        const r = await repositorio.buscar({
          servicio: 'EInvoicing.Entity',
          pagina: 1,
          limite: 50,
        });
        expect(r.total).toBe(1);
        expect(r.entradas[0]?.accion).toBe('COMPROBANTE_ACEPTADO');
      });

      it('filtra por usuario: quién autorizó', async () => {
        if (!hayBase) return;
        const r = await repositorio.buscar({
          usuario: 'supervisor01',
          pagina: 1,
          limite: 50,
        });
        expect(r.entradas[0]?.accion).toBe('VENTA_ANULADA');
      });

      it('filtra por rango de fechas', async () => {
        if (!hayBase) return;
        const r = await repositorio.buscar({
          desde: new Date('2026-08-29T11:00:00Z'),
          hasta: new Date('2026-08-29T13:00:00Z'),
          pagina: 1,
          limite: 50,
        });
        expect(r.total).toBe(1);
        expect(r.entradas[0]?.servicio).toBe('EInvoicing.Entity');
      });

      it('combina varios filtros', async () => {
        if (!hayBase) return;
        const r = await repositorio.buscar({
          servicio: 'Sales.Customer.Entity',
          accion: 'VENTA_ANULADA',
          pagina: 1,
          limite: 50,
        });
        expect(r.total).toBe(1);
      });

      it('pagina reportando el total real, no el de la página', async () => {
        if (!hayBase) return;
        const r = await repositorio.buscar({ pagina: 1, limite: 2 });

        expect(r.entradas).toHaveLength(2);
        expect(r.total).toBe(3);
      });

      it('devuelve las más recientes primero', async () => {
        if (!hayBase) return;
        const r = await repositorio.buscar({ pagina: 1, limite: 50 });
        expect(r.entradas[0]?.accion).toBe('VENTA_ANULADA');
      });
    });
  },
);
