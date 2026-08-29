/**
 * Validación contra XML Schema (XSD).
 *
 * Todo mensaje XML que entra a un servicio se valida contra su esquema antes
 * de tocar lógica de negocio (CLAUDE.md §9.3: nunca confiar en el mensaje
 * entrante). Es la aplicación directa del principio P1 — contrato estandarizado.
 *
 * Usa `xmllint-wasm`: libxml2 compilado a WebAssembly. No requiere node-gyp,
 * Visual Studio Build Tools ni Python, lo que lo hace viable en Windows.
 * Verificado en el spike S-01 (docs/03-implementacion/spikes-fase0.md).
 */
import { validateXML } from 'xmllint-wasm';

/**
 * Esquema importado por el principal vía `xs:import` o `xs:include`.
 * `nombre` debe coincidir exactamente con el `schemaLocation` declarado.
 */
export interface ArchivoEsquema {
  nombre: string;
  contenido: string;
}

export interface ErrorValidacionXsd {
  mensaje: string;
  linea?: number;
}

export interface ResultadoValidacion {
  valido: boolean;
  errores: ErrorValidacionXsd[];
}

export interface OpcionesValidador {
  /** Esquemas que el principal importa. Se resuelven por nombre de archivo. */
  importados?: ArchivoEsquema[];
  /** Identificador para los mensajes de error. */
  nombre?: string;
}

/**
 * Valida documentos contra un esquema fijo.
 *
 * Se construye una vez por esquema y se reutiliza: el coste de arrancar el
 * módulo WASM no se paga en cada mensaje.
 */
export class ValidadorXsd {
  readonly #principal: string;
  readonly #importados: ArchivoEsquema[];
  readonly #nombre: string;

  constructor(esquemaPrincipal: string, opciones: OpcionesValidador = {}) {
    this.#principal = esquemaPrincipal;
    this.#importados = opciones.importados ?? [];
    this.#nombre = opciones.nombre ?? 'esquema';
  }

  async validar(
    xml: string,
    nombreArchivo = 'documento.xml',
  ): Promise<ResultadoValidacion> {
    let resultado;
    try {
      resultado = await validateXML({
        xml: [{ fileName: nombreArchivo, contents: xml }],
        schema: [this.#principal],
        // xmllint resuelve los `xs:import` contra estos archivos en memoria.
        preload: this.#importados.map((e) => ({
          fileName: e.nombre,
          contents: e.contenido,
        })),
      });
    } catch (causa) {
      // Si el XSD no compila, xmllint lanza en vez de devolver `valid: false`.
      // Es un error del contrato, no del documento: distinguirlos evita
      // reportar "mensaje inválido" cuando lo roto es el esquema.
      throw new ErrorCompilacionEsquema(this.#nombre, causa);
    }

    return {
      valido: resultado.valid,
      errores: (resultado.errors ?? []).map(normalizarError),
    };
  }

  /** Valida y lanza si no cumple. Para usar en el borde de un servicio. */
  async exigir(xml: string, nombreArchivo = 'documento.xml'): Promise<void> {
    const r = await this.validar(xml, nombreArchivo);
    if (r.valido) return;

    const detalle = r.errores.map((e) => e.mensaje).join('; ');
    throw new ErrorEsquemaXml(this.#nombre, r.errores, detalle);
  }
}

/** Primera línea de un mensaje multilínea. xmllint devuelve trazas largas. */
function primeraLinea(texto: string): string {
  const corte = texto.indexOf('\n');
  return corte === -1 ? texto : texto.slice(0, corte).trimEnd();
}

function normalizarError(e: unknown): ErrorValidacionXsd {
  if (typeof e === 'string') return { mensaje: e };

  const obj = e as { message?: string; loc?: { lineNumber?: number } };
  const linea = obj.loc?.lineNumber;
  return linea === undefined
    ? { mensaje: String(obj.message ?? e) }
    : { mensaje: String(obj.message ?? e), linea };
}

/**
 * El XSD no se pudo compilar. Causa típica: un `xs:import` cuyo esquema no se
 * pasó en `importados`, o un `schemaLocation` que no coincide con el nombre.
 *
 * Es un error de programación, no de datos.
 */
export class ErrorCompilacionEsquema extends Error {
  readonly esquema: string;

  constructor(esquema: string, causa: unknown) {
    const detalle = causa instanceof Error ? causa.message : String(causa);
    const faltaImport = detalle.includes('failed to load external entity');
    const pista = faltaImport
      ? '. Falta suministrar un esquema importado en `importados`, o su nombre ' +
        'no coincide con el schemaLocation declarado'
      : '';

    super(
      `No se pudo compilar el esquema "${esquema}"${pista}. ` +
        `Detalle: ${primeraLinea(detalle)}`,
    );
    this.name = 'ErrorCompilacionEsquema';
    this.esquema = esquema;
    this.cause = causa;
  }
}

/** El documento no cumple el esquema. Error de datos, no de contrato. */
export class ErrorEsquemaXml extends Error {
  readonly esquema: string;
  readonly errores: ErrorValidacionXsd[];

  constructor(esquema: string, errores: ErrorValidacionXsd[], detalle: string) {
    super(`El documento no cumple el esquema "${esquema}": ${detalle}`);
    this.name = 'ErrorEsquemaXml';
    this.esquema = esquema;
    this.errores = errores;
  }
}
