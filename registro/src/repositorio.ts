/**
 * Almacén del registro UDDI.
 *
 * Guarda las cuatro entidades del modelo y resuelve las dos preguntas que un
 * registro debe responder:
 *
 *   - **descubrimiento**: ¿qué servicios cumplen estos criterios?
 *   - **resolución**: ¿en qué dirección invoco a este servicio?
 */
import {
  casa,
  type BusinessEntity,
  type BusinessService,
  type EstadoSalud,
  type FiltroBusqueda,
  type RegistroSalud,
  type TModel,
} from './modelo-uddi.js';

export class RegistroUddi {
  readonly #entidades = new Map<string, BusinessEntity>();
  readonly #servicios = new Map<string, BusinessService>();
  readonly #tModels = new Map<string, TModel>();
  readonly #salud = new Map<string, RegistroSalud>();

  // ── Publicación ───────────────────────────────────────────────

  publicarEntidad(entidad: BusinessEntity): void {
    this.#entidades.set(entidad.businessKey, { ...entidad });
  }

  publicarTModel(tModel: TModel): void {
    this.#tModels.set(tModel.tModelKey, { ...tModel, categorias: [...tModel.categorias] });
  }

  /**
   * Publica o actualiza un servicio.
   *
   * @returns `true` si es nuevo, `false` si actualizó uno existente.
   * @throws Si referencia una entidad o un tModel que no existen: un registro
   *         con referencias rotas es peor que uno vacío, porque el consumidor
   *         cree haber descubierto algo invocable.
   */
  publicarServicio(servicio: BusinessService): boolean {
    if (!this.#entidades.has(servicio.businessKey)) {
      throw new ErrorReferenciaInvalida(
        `La entidad ${servicio.businessKey} no está publicada.`,
      );
    }

    for (const binding of servicio.bindings) {
      for (const tModelKey of binding.tModelKeys) {
        if (!this.#tModels.has(tModelKey)) {
          throw new ErrorReferenciaInvalida(
            `El tModel ${tModelKey} no está publicado. ` +
              'Publica primero la especificación técnica del servicio.',
          );
        }
      }
    }

    const nuevo = !this.#servicios.has(servicio.serviceKey);
    this.#servicios.set(servicio.serviceKey, {
      ...servicio,
      categorias: [...servicio.categorias],
      bindings: servicio.bindings.map((b) => ({ ...b, tModelKeys: [...b.tModelKeys] })),
    });

    return nuevo;
  }

  /** Retira un servicio del registro. Etapa de *retiro* del ciclo de vida. */
  retirarServicio(serviceKey: string): boolean {
    this.#salud.delete(serviceKey);
    return this.#servicios.delete(serviceKey);
  }

  // ── Descubrimiento ────────────────────────────────────────────

  /** `find_service` del estándar. */
  buscarServicios(filtro: FiltroBusqueda = {}): BusinessService[] {
    return [...this.#servicios.values()]
      .filter((s) => casa(s, filtro))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  /** `get_serviceDetail` del estándar. */
  servicio(serviceKey: string): BusinessService | null {
    return this.#servicios.get(serviceKey) ?? null;
  }

  entidad(businessKey: string): BusinessEntity | null {
    return this.#entidades.get(businessKey) ?? null;
  }

  tModel(tModelKey: string): TModel | null {
    return this.#tModels.get(tModelKey) ?? null;
  }

  tModels(): TModel[] {
    return [...this.#tModels.values()];
  }

  entidades(): BusinessEntity[] {
    return [...this.#entidades.values()];
  }

  // ── Resolución de endpoint ────────────────────────────────────

  /**
   * Dirección invocable de un servicio, por protocolo.
   *
   * Es lo que consume el ESB para no llevar endpoints cableados: pregunta al
   * registro dónde está el servicio en vez de saberlo de antemano.
   */
  resolverEndpoint(
    serviceKey: string,
    tipoAcceso?: 'REST' | 'SOAP' | 'AMQP',
  ): string | null {
    const servicio = this.#servicios.get(serviceKey);
    if (!servicio) return null;

    const binding = tipoAcceso
      ? servicio.bindings.find((b) => b.tipoAcceso === tipoAcceso)
      : servicio.bindings[0];

    return binding?.accessPoint ?? null;
  }

  // ── Salud ─────────────────────────────────────────────────────

  registrarSalud(serviceKey: string, estado: EstadoSalud, detalle?: string): void {
    this.#salud.set(serviceKey, {
      serviceKey,
      estado,
      verificadoEn: new Date(),
      ...(detalle === undefined ? {} : { detalle }),
    });
  }

  salud(serviceKey: string): RegistroSalud {
    return (
      this.#salud.get(serviceKey) ?? {
        serviceKey,
        estado: 'DESCONOCIDO',
        verificadoEn: new Date(0),
      }
    );
  }

  get totalServicios(): number {
    return this.#servicios.size;
  }
}

export class ErrorReferenciaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorReferenciaInvalida';
  }
}
