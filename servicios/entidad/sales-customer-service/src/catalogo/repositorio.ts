/**
 * Sub-dominio **Catálogo** — contrato de persistencia.
 *
 * Es un sub-dominio *interno* del servicio, no un servicio aparte. Comparte la
 * base con Caja, Venta y CRM porque el cajero los necesita en el mismo instante
 * del ticket (CLAUDE.md §3 y §4.5).
 *
 * La interfaz existe por Clean Architecture (RF-ARQ-01): la lógica no conoce si
 * detrás hay SQLite local o la réplica PostgreSQL. Es lo que permite compartir el
 * mismo código entre Desktop, Tablet y Web.
 */

export type TipoItem = 'PRODUCTO' | 'SERVICIO' | 'COMBO';

export interface DatosServicio {
  duracionMinutos: number;
  especialistas?: string[] | undefined;
  recursos?: string[] | undefined;
}

export interface PrecioLista {
  lista: string;
  precio: number;
  vigenteDesde: string;
  vigenteHasta?: string | undefined;
}

export interface ItemCatalogo {
  uuid: string;
  sku: string;
  tipoItem: TipoItem;
  nombre: string;
  descripcion?: string | undefined;
  categoria: string;
  precioBase: number;
  afectoIgv: boolean;
  precios?: PrecioLista[] | undefined;
  /** Presente solo cuando `tipoItem` es SERVICIO. */
  datosServicio?: DatosServicio | undefined;
  activo: boolean;
}

export interface FiltroCatalogo {
  /** Texto libre: busca en nombre, SKU y categoría. */
  q?: string | undefined;
  tipoItem?: TipoItem | undefined;
  categoria?: string | undefined;
  soloActivos: boolean;
  pagina: number;
  limite: number;
}

export interface ResultadoCatalogo {
  items: ItemCatalogo[];
  total: number;
}

export interface RepositorioCatalogo {
  /**
   * Búsqueda del cajero durante la venta (RF-POS-01).
   * **Debe responder en menos de 300ms sobre 50.000 items** (RNF-03, RNF-15).
   */
  buscar(filtro: FiltroCatalogo): Promise<ResultadoCatalogo>;

  /** Devuelve un item por SKU, o `null` si no existe. */
  porSku(sku: string): Promise<ItemCatalogo | null>;
}
