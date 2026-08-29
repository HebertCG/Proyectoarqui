/**
 * Transformacion XSLT 3.0.
 *
 * Es el mecanismo de transformacion del ESB (CLAUDE.md §5.3). El caso central
 * del proyecto: comprobante interno -> UBL 2.1 para SUNAT.
 *
 * Saxon-JS no interpreta el .xsl directamente: necesita el stylesheet compilado
 * a SEF (formato JSON). La compilacion la hace `xslt3` en tiempo de build, no
 * en caliente. Fuente de verdad = el .xsl; el .sef.json es artefacto derivado.
 *
 *   pnpm --filter @pos/xml-kit compilar-xslt
 */
import SaxonJS from 'saxon-js';

export interface OpcionesTransformacion {
  /** Parametros globales del stylesheet (xsl:param). */
  parametros?: Record<string, unknown>;
}

/**
 * Aplica un stylesheet compilado a documentos XML.
 *
 * Se construye una vez por stylesheet y se reutiliza.
 */
export class TransformadorXslt {
  readonly #sef: unknown;
  readonly #nombre: string;

  /**
   * @param sef Contenido del .sef.json ya parseado, o su texto.
   */
  constructor(sef: unknown, nombre = 'transformacion') {
    this.#sef = typeof sef === 'string' ? JSON.parse(sef) : sef;
    this.#nombre = nombre;
  }

  /** Transforma y devuelve el resultado serializado como texto. */
  transformar(xml: string, opciones: OpcionesTransformacion = {}): string {
    try {
      const salida = SaxonJS.transform(
        {
          stylesheetInternal: this.#sef,
          sourceText: xml,
          destination: 'serialized',
          ...(opciones.parametros ? { stylesheetParams: opciones.parametros } : {}),
        },
        'sync',
      ) as { principalResult?: string };

      return salida.principalResult ?? '';
    } catch (causa) {
      throw new ErrorTransformacionXslt(this.#nombre, causa);
    }
  }
}

export class ErrorTransformacionXslt extends Error {
  readonly transformacion: string;

  constructor(transformacion: string, causa: unknown) {
    const detalle = causa instanceof Error ? causa.message : String(causa);
    super(`Fallo la transformacion "${transformacion}": ${detalle}`);
    this.name = 'ErrorTransformacionXslt';
    this.transformacion = transformacion;
    this.cause = causa;
  }
}
