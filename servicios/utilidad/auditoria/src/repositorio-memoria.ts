/**
 * Repositorio en memoria. Para pruebas y para el arranque del esqueleto vertical
 * mientras PostgreSQL no esté disponible.
 *
 * Respeta las mismas garantías que el de PostgreSQL: append-only e idempotencia
 * por `uuid`. Si no las respetara, las pruebas pasarían y producción fallaría.
 */
import type {
  EntradaAuditoria,
  FiltroBusqueda,
  RepositorioAuditoria,
  ResultadoBusqueda,
} from './repositorio.js';

export class RepositorioMemoria implements RepositorioAuditoria {
  readonly #porUuid = new Map<string, EntradaAuditoria>();

  async registrar(entrada: EntradaAuditoria): Promise<boolean> {
    if (this.#porUuid.has(entrada.uuid)) return false;

    this.#porUuid.set(entrada.uuid, {
      ...entrada,
      recibidoEn: entrada.recibidoEn ?? new Date(),
    });
    return true;
  }

  async registrarLote(
    entradas: EntradaAuditoria[],
  ): Promise<{ insertadas: number; duplicadas: number }> {
    let insertadas = 0;
    for (const entrada of entradas) {
      if (await this.registrar(entrada)) insertadas += 1;
    }
    return { insertadas, duplicadas: entradas.length - insertadas };
  }

  async buscar(filtro: FiltroBusqueda): Promise<ResultadoBusqueda> {
    const coincidencias = [...this.#porUuid.values()]
      .filter((e) => cumple(e, filtro))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const desde = (filtro.pagina - 1) * filtro.limite;
    return {
      entradas: coincidencias.slice(desde, desde + filtro.limite),
      total: coincidencias.length,
    };
  }

  async traza(correlationId: string): Promise<EntradaAuditoria[]> {
    return [...this.#porUuid.values()]
      .filter((e) => e.correlationId === correlationId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /** Solo para pruebas. */
  get tamano(): number {
    return this.#porUuid.size;
  }
}

function cumple(entrada: EntradaAuditoria, filtro: FiltroBusqueda): boolean {
  if (filtro.servicio && entrada.servicio !== filtro.servicio) return false;
  if (filtro.usuario && entrada.usuario !== filtro.usuario) return false;
  if (filtro.accion && entrada.accion !== filtro.accion) return false;
  if (filtro.recurso && entrada.recurso !== filtro.recurso) return false;
  if (filtro.desde && entrada.timestamp < filtro.desde) return false;
  if (filtro.hasta && entrada.timestamp > filtro.hasta) return false;
  return true;
}
