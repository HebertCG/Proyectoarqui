/**
 * Repositorio sobre PostgreSQL (`svc_auditoria`), con Drizzle.
 *
 * La idempotencia se delega a la base con `ON CONFLICT DO NOTHING` sobre la clave
 * primaria: es atómico y no requiere leer antes de escribir, así que dos peticiones
 * simultáneas con el mismo `uuid` no pueden ambas insertar.
 */
import { and, asc, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { entradasAuditoria, type EntradaFila } from './esquema.js';
import type {
  EntradaAuditoria,
  FiltroBusqueda,
  RepositorioAuditoria,
  ResultadoBusqueda,
} from './repositorio.js';

export class RepositorioPostgres implements RepositorioAuditoria {
  readonly #db: PostgresJsDatabase;
  readonly #cliente: postgres.Sql;

  constructor(urlBaseDatos: string) {
    this.#cliente = postgres(urlBaseDatos);
    this.#db = drizzle(this.#cliente);
  }

  async registrar(entrada: EntradaAuditoria): Promise<boolean> {
    const insertadas = await this.#db
      .insert(entradasAuditoria)
      .values(aFila(entrada))
      .onConflictDoNothing({ target: entradasAuditoria.uuid })
      .returning({ uuid: entradasAuditoria.uuid });

    return insertadas.length > 0;
  }

  async registrarLote(
    entradas: EntradaAuditoria[],
  ): Promise<{ insertadas: number; duplicadas: number }> {
    if (entradas.length === 0) return { insertadas: 0, duplicadas: 0 };

    const resultado = await this.#db
      .insert(entradasAuditoria)
      .values(entradas.map(aFila))
      .onConflictDoNothing({ target: entradasAuditoria.uuid })
      .returning({ uuid: entradasAuditoria.uuid });

    return {
      insertadas: resultado.length,
      duplicadas: entradas.length - resultado.length,
    };
  }

  async buscar(filtro: FiltroBusqueda): Promise<ResultadoBusqueda> {
    const condiciones = construirCondiciones(filtro);
    const donde = condiciones.length > 0 ? and(...condiciones) : undefined;

    const [filas, [total]] = await Promise.all([
      this.#db
        .select()
        .from(entradasAuditoria)
        .where(donde)
        .orderBy(desc(entradasAuditoria.timestamp))
        .limit(filtro.limite)
        .offset((filtro.pagina - 1) * filtro.limite),
      this.#db.select({ valor: count() }).from(entradasAuditoria).where(donde),
    ]);

    return {
      entradas: filas.map(aEntrada),
      total: total?.valor ?? 0,
    };
  }

  async traza(correlationId: string): Promise<EntradaAuditoria[]> {
    const filas = await this.#db
      .select()
      .from(entradasAuditoria)
      .where(eq(entradasAuditoria.correlationId, correlationId))
      .orderBy(asc(entradasAuditoria.timestamp));

    return filas.map(aEntrada);
  }

  async cerrar(): Promise<void> {
    await this.#cliente.end();
  }
}

function construirCondiciones(filtro: FiltroBusqueda): SQL[] {
  const condiciones: SQL[] = [];
  const { servicio, usuario, accion, recurso, desde, hasta } = filtro;

  if (servicio) condiciones.push(eq(entradasAuditoria.servicio, servicio));
  if (usuario) condiciones.push(eq(entradasAuditoria.usuario, usuario));
  if (accion) condiciones.push(eq(entradasAuditoria.accion, accion));
  if (recurso) condiciones.push(eq(entradasAuditoria.recurso, recurso));
  if (desde) condiciones.push(gte(entradasAuditoria.timestamp, desde));
  if (hasta) condiciones.push(lte(entradasAuditoria.timestamp, hasta));

  return condiciones;
}

function aFila(entrada: EntradaAuditoria) {
  return {
    uuid: entrada.uuid,
    correlationId: entrada.correlationId,
    servicio: entrada.servicio,
    accion: entrada.accion,
    recurso: entrada.recurso,
    recursoId: entrada.recursoId ?? null,
    usuario: entrada.usuario,
    timestamp: entrada.timestamp,
    detalle: entrada.detalle ?? null,
  };
}

function aEntrada(fila: EntradaFila): EntradaAuditoria {
  return {
    uuid: fila.uuid,
    correlationId: fila.correlationId,
    servicio: fila.servicio,
    accion: fila.accion,
    recurso: fila.recurso,
    recursoId: fila.recursoId ?? undefined,
    usuario: fila.usuario,
    timestamp: fila.timestamp,
    recibidoEn: fila.recibidoEn,
    detalle: (fila.detalle as Record<string, unknown> | null) ?? undefined,
  };
}
