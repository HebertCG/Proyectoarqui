/**
 * Modelo de datos UDDI.
 *
 * UDDI como estándar está en desuso y sus implementaciones vivas son Java
 * (jUDDI). Se implementa un registro propio en Node/TS que **reproduce su
 * modelo de datos** y lo expone por REST (CLAUDE.md §5.4).
 *
 * La jerarquía es la del estándar:
 *
 *     businessEntity      quién publica  (la organización)
 *       └── businessService   qué ofrece  (el servicio)
 *             └── bindingTemplate  dónde y cómo se invoca (el endpoint)
 *                   └── tModel     con qué contrato  (la especificación técnica)
 *
 * La correspondencia con el estándar se documenta en APF3: **esa documentación
 * es la evidencia de la sesión 24** del sílabo.
 */

/**
 * `tModel` — Technical Model.
 *
 * En UDDI representa una especificación técnica reutilizable: un WSDL, un
 * esquema, un protocolo, una taxonomía. Varios servicios pueden apuntar al mismo
 * tModel, que es como UDDI expresa "estos hablan el mismo idioma".
 */
export interface TModel {
  tModelKey: string;
  nombre: string;
  descripcion: string;
  /** URL del contrato: WSDL, OpenAPI o XSD. */
  urlContrato: string;
  /** Categorías del estándar: `protocol:soap`, `protocol:rest`, `capa:entidad`… */
  categorias: string[];
}

/** `bindingTemplate` — dónde vive un servicio y cómo se le habla. */
export interface BindingTemplate {
  bindingKey: string;
  /** Endpoint invocable. */
  accessPoint: string;
  /** Protocolo de transporte. */
  tipoAcceso: 'REST' | 'SOAP' | 'AMQP';
  /** tModels que describen este binding: su contrato. */
  tModelKeys: string[];
  descripcion?: string | undefined;
}

/** `businessService` — un servicio del inventario. */
export interface BusinessService {
  serviceKey: string;
  businessKey: string;
  nombre: string;
  descripcion: string;
  /** Capa SOA a la que pertenece (CLAUDE.md §4.1). */
  capa: 'entidad' | 'tarea' | 'utilidad' | 'orquestacion' | 'infraestructura';
  /** Nivel de implementación (CLAUDE.md §4.6). */
  nivel: 'N1' | 'N2' | 'N3';
  categorias: string[];
  bindings: BindingTemplate[];
  /** Un stub N3 se declara como tal: presentarlo como real sería engañoso. */
  simulado: boolean;
}

/** `businessEntity` — la organización que publica los servicios. */
export interface BusinessEntity {
  businessKey: string;
  nombre: string;
  descripcion: string;
  contacto?: string | undefined;
}

/** Estado de salud, para que el descubrimiento no devuelva servicios caídos. */
export type EstadoSalud = 'ARRIBA' | 'ABAJO' | 'DESCONOCIDO';

export interface RegistroSalud {
  serviceKey: string;
  estado: EstadoSalud;
  verificadoEn: Date;
  detalle?: string | undefined;
}

/** Filtro de búsqueda — el `find_service` del estándar. */
export interface FiltroBusqueda {
  nombre?: string | undefined;
  capa?: BusinessService['capa'] | undefined;
  nivel?: BusinessService['nivel'] | undefined;
  categoria?: string | undefined;
  tModelKey?: string | undefined;
  tipoAcceso?: BindingTemplate['tipoAcceso'] | undefined;
  incluirSimulados?: boolean | undefined;
}

/** Genera una clave con el formato del estándar: `uddi:{dominio}:{tipo}:{nombre}`. */
export function clave(tipo: 'business' | 'service' | 'binding' | 'tmodel', nombre: string): string {
  return `uddi:pos-soa:${tipo}:${nombre}`;
}

/** ¿Un servicio casa con el filtro? */
export function casa(
  servicio: BusinessService,
  filtro: FiltroBusqueda,
): boolean {
  if (filtro.nombre && !servicio.nombre.toLowerCase().includes(filtro.nombre.toLowerCase())) {
    return false;
  }
  if (filtro.capa && servicio.capa !== filtro.capa) return false;
  if (filtro.nivel && servicio.nivel !== filtro.nivel) return false;
  if (filtro.categoria && !servicio.categorias.includes(filtro.categoria)) return false;

  if (filtro.tipoAcceso && !servicio.bindings.some((b) => b.tipoAcceso === filtro.tipoAcceso)) {
    return false;
  }

  if (
    filtro.tModelKey &&
    !servicio.bindings.some((b) => b.tModelKeys.includes(filtro.tModelKey as string))
  ) {
    return false;
  }

  // Por defecto los stubs se incluyen: ocultarlos daría una imagen falsa del
  // inventario. Quien quiera solo servicios reales lo pide explícitamente.
  if (filtro.incluirSimulados === false && servicio.simulado) return false;

  return true;
}
