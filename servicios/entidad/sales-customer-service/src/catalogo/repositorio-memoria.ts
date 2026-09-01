/**
 * Repositorio de catalogo en memoria.
 *
 * Sirve al esqueleto vertical y a las pruebas. La busqueda replica la semantica
 * que despues implementara FTS5 en SQLite: coincidencia parcial sobre nombre,
 * SKU y categoria, sin distinguir mayusculas ni acentos.
 */
import type {
  FiltroCatalogo,
  ItemCatalogo,
  RepositorioCatalogo,
  ResultadoCatalogo,
} from './repositorio.js';

/** Quita acentos y pasa a minusculas: "Cafe" y "café" deben coincidir. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export class RepositorioCatalogoMemoria implements RepositorioCatalogo {
  readonly #porSku = new Map<string, ItemCatalogo>();

  constructor(items: ItemCatalogo[] = []) {
    for (const item of items) this.#porSku.set(item.sku, item);
  }

  async buscar(filtro: FiltroCatalogo): Promise<ResultadoCatalogo> {
    const coincidencias = [...this.#porSku.values()]
      .filter((item) => cumple(item, filtro))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const desde = (filtro.pagina - 1) * filtro.limite;
    return {
      items: coincidencias.slice(desde, desde + filtro.limite),
      total: coincidencias.length,
    };
  }

  async porSku(sku: string): Promise<ItemCatalogo | null> {
    return this.#porSku.get(sku) ?? null;
  }

  /** Solo para pruebas y carga inicial del esqueleto. */
  agregar(item: ItemCatalogo): void {
    this.#porSku.set(item.sku, item);
  }
}

function cumple(item: ItemCatalogo, filtro: FiltroCatalogo): boolean {
  if (filtro.soloActivos && !item.activo) return false;
  if (filtro.tipoItem && item.tipoItem !== filtro.tipoItem) return false;
  if (filtro.categoria && item.categoria !== filtro.categoria) return false;

  if (filtro.q) {
    const busqueda = normalizar(filtro.q);
    const campos = normalizar(`${item.nombre} ${item.sku} ${item.categoria}`);
    if (!campos.includes(busqueda)) return false;
  }

  return true;
}
