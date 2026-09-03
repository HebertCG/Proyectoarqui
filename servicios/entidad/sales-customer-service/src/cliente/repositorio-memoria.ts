/**
 * Repositorio de clientes en memoria.
 *
 * La búsqueda replica la semántica que después implementará FTS5 sobre
 * SQLCipher: coincidencia parcial, sin distinguir mayúsculas ni acentos, sobre
 * nombre, documento, teléfono y correo.
 */
import type {
  Cliente,
  FiltroCliente,
  RepositorioCliente,
  ResultadoClientes,
  TipoDocumento,
} from './repositorio.js';

/** Quita acentos y pasa a minúsculas: "Perez" y "Pérez" deben coincidir. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Clave del índice por documento. GENERICO no entra: no tiene documento único. */
function claveDocumento(tipo: TipoDocumento, numero: string): string {
  return `${tipo}:${numero}`;
}

export class RepositorioClienteMemoria implements RepositorioCliente {
  readonly #porUuid = new Map<string, Cliente>();
  readonly #porDocumento = new Map<string, string>();

  constructor(clientes: Cliente[] = []) {
    for (const cliente of clientes) this.#indexar(cliente);
  }

  async buscar(filtro: FiltroCliente): Promise<ResultadoClientes> {
    const busqueda = normalizar(filtro.q);

    const coincidencias = [...this.#porUuid.values()]
      .filter((cliente) => camposBuscables(cliente).includes(busqueda))
      .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es'));

    const desde = (filtro.pagina - 1) * filtro.limite;
    return {
      clientes: coincidencias.slice(desde, desde + filtro.limite),
      total: coincidencias.length,
    };
  }

  async porUuid(uuid: string): Promise<Cliente | null> {
    return this.#porUuid.get(uuid) ?? null;
  }

  async porDocumento(
    tipoDocumento: TipoDocumento,
    numeroDocumento: string,
  ): Promise<Cliente | null> {
    const uuid = this.#porDocumento.get(claveDocumento(tipoDocumento, numeroDocumento));
    return uuid ? (this.#porUuid.get(uuid) ?? null) : null;
  }

  async guardar(cliente: Cliente): Promise<void> {
    this.#indexar(cliente);
  }

  #indexar(cliente: Cliente): void {
    this.#porUuid.set(cliente.uuid, cliente);

    if (cliente.tipoDocumento !== 'GENERICO' && cliente.numeroDocumento) {
      this.#porDocumento.set(
        claveDocumento(cliente.tipoDocumento, cliente.numeroDocumento),
        cliente.uuid,
      );
    }
  }
}

function camposBuscables(cliente: Cliente): string {
  return normalizar(
    [
      cliente.razonSocial,
      cliente.nombreComercial ?? '',
      cliente.numeroDocumento ?? '',
      cliente.codigoInterno ?? '',
      cliente.contacto?.telefono ?? '',
      cliente.contacto?.correo ?? '',
    ].join(' '),
  );
}
