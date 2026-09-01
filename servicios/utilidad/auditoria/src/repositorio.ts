/**
 * Contrato de persistencia de `Auditoria.Utility`.
 *
 * La lógica del servicio depende de esta interfaz, nunca de PostgreSQL. Es la
 * misma idea que el `RepositoryFactory` del terminal (RF-ARQ-01): permite probar
 * sin base de datos y cambiar el motor sin tocar las rutas.
 *
 * **No existe `actualizar` ni `eliminar`, y no es un olvido**: el registro es
 * append-only por diseño (RNF-08). Que la interfaz no los ofrezca hace imposible
 * violarlo desde el código.
 */

export interface EntradaAuditoria {
  uuid: string;
  correlationId: string;
  servicio: string;
  accion: string;
  recurso: string;
  recursoId?: string | undefined;
  usuario: string;
  timestamp: Date;
  recibidoEn?: Date | undefined;
  detalle?: Record<string, unknown> | undefined;
}

export interface FiltroBusqueda {
  servicio?: string | undefined;
  usuario?: string | undefined;
  accion?: string | undefined;
  recurso?: string | undefined;
  desde?: Date | undefined;
  hasta?: Date | undefined;
  pagina: number;
  limite: number;
}

export interface ResultadoBusqueda {
  entradas: EntradaAuditoria[];
  total: number;
}

export interface RepositorioAuditoria {
  /**
   * Registra una entrada. Idempotente por `uuid`: reintentar el mismo evento
   * no crea un duplicado (RF-SYNC-07).
   *
   * @returns `true` si se insertó, `false` si ya existía.
   */
  registrar(entrada: EntradaAuditoria): Promise<boolean>;

  /** Registra un lote. Devuelve cuántas se insertaron y cuántas ya existían. */
  registrarLote(
    entradas: EntradaAuditoria[],
  ): Promise<{ insertadas: number; duplicadas: number }>;

  buscar(filtro: FiltroBusqueda): Promise<ResultadoBusqueda>;

  /** Todas las entradas de una operación, en orden cronológico. */
  traza(correlationId: string): Promise<EntradaAuditoria[]>;
}
