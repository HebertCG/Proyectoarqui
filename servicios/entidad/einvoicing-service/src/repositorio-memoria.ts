/**
 * Repositorio de comprobantes en memoria.
 *
 * Guarda copias: sin ellas, quien tiene la referencia podria cambiar el estado
 * tributario sin pasar por la maquina de estados.
 */
import type { Comprobante, EstadoTributario } from './comprobante.js';
import type { RepositorioComprobantes } from './repositorio.js';

const copiar = (c: Comprobante): Comprobante => ({
  ...c,
  cliente: { ...c.cliente },
  lineas: c.lineas.map((l) => ({ ...l })),
  documentoReferencia: c.documentoReferencia ? { ...c.documentoReferencia } : undefined,
  respuestaSunat: c.respuestaSunat ? { ...c.respuestaSunat } : undefined,
});

export class RepositorioComprobantesMemoria implements RepositorioComprobantes {
  readonly #porUuid = new Map<string, Comprobante>();

  async porUuid(uuid: string): Promise<Comprobante | null> {
    const c = this.#porUuid.get(uuid);
    return c ? copiar(c) : null;
  }

  async porSerie(serie: string, correlativo: number): Promise<Comprobante | null> {
    for (const c of this.#porUuid.values()) {
      if (c.serie === serie && c.correlativo === correlativo) return copiar(c);
    }
    return null;
  }

  async registrar(comprobante: Comprobante): Promise<boolean> {
    if (this.#porUuid.has(comprobante.uuid)) return false;
    this.#porUuid.set(comprobante.uuid, copiar(comprobante));
    return true;
  }

  async guardar(comprobante: Comprobante): Promise<void> {
    this.#porUuid.set(comprobante.uuid, copiar(comprobante));
  }

  async pendientes(limite: number): Promise<Comprobante[]> {
    return [...this.#porUuid.values()]
      .filter((c) => c.estadoTributario === 'PENDIENTE_ENVIO')
      .sort((a, b) => a.correlativo - b.correlativo)
      .slice(0, limite)
      .map(copiar);
  }

  async buscar(filtro: {
    estado?: EstadoTributario | undefined;
    serie?: string | undefined;
    desde?: string | undefined;
    hasta?: string | undefined;
    pagina: number;
    limite: number;
  }): Promise<{ comprobantes: Comprobante[]; total: number }> {
    const coincidencias = [...this.#porUuid.values()]
      .filter((c) => {
        if (filtro.estado && c.estadoTributario !== filtro.estado) return false;
        if (filtro.serie && c.serie !== filtro.serie) return false;
        if (filtro.desde && c.fechaEmision < filtro.desde) return false;
        if (filtro.hasta && c.fechaEmision > filtro.hasta) return false;
        return true;
      })
      .sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision) || b.correlativo - a.correlativo);

    const desde = (filtro.pagina - 1) * filtro.limite;
    return {
      comprobantes: coincidencias.slice(desde, desde + filtro.limite).map(copiar),
      total: coincidencias.length,
    };
  }

  get tamano(): number {
    return this.#porUuid.size;
  }
}
