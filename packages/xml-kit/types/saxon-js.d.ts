/**
 * Declaraciones de tipo para saxon-js.
 *
 * Saxon-JS 2 no publica tipos propios y no existe @types/saxon-js. Se declara
 * aqui solo la superficie que el proyecto usa: la transformacion XSLT 3.0.
 * Ampliar solo cuando haga falta otra operacion.
 */
declare module 'saxon-js' {
  export interface OpcionesTransform {
    /** Stylesheet ya compilado a SEF (objeto JSON). */
    stylesheetInternal?: unknown;
    /** Ruta a un .sef.json en disco. */
    stylesheetLocation?: string;
    /** Documento de entrada como texto XML. */
    sourceText?: string;
    /** Documento de entrada ya parseado. */
    sourceNode?: unknown;
    /** `serialized` devuelve texto en principalResult. */
    destination?: 'serialized' | 'document' | 'application' | 'raw';
    /** Parametros globales del stylesheet (xsl:param). */
    stylesheetParams?: Record<string, unknown>;
  }

  export interface ResultadoTransform {
    principalResult?: string;
    principalResultDocument?: unknown;
  }

  export function transform(
    opciones: OpcionesTransform,
    modo?: 'sync' | 'async',
  ): ResultadoTransform;

  const SaxonJS: {
    transform: typeof transform;
  };

  export default SaxonJS;
}
