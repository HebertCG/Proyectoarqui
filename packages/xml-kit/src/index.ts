/**
 * @pos/xml-kit — las cuatro tecnologias XML que exige el silabo (sesiones 5-6).
 *
 *   XSD    -> ValidadorXsd
 *   XSLT   -> TransformadorXslt
 *   XPath  -> ConsultaXml / extraer
 *   XQuery -> ConsultaXml.xquery
 *
 * Ver CLAUDE.md §5 y el spike S-01.
 */

export {
  ValidadorXsd,
  ErrorEsquemaXml,
  ErrorCompilacionEsquema,
  type ResultadoValidacion,
  type ErrorValidacionXsd,
  type ArchivoEsquema,
  type OpcionesValidador,
} from './validador-xsd.js';

export {
  TransformadorXslt,
  ErrorTransformacionXslt,
  type OpcionesTransformacion,
} from './transformador-xslt.js';

export {
  ConsultaXml,
  parsear,
  extraer,
  type DocumentoXml,
} from './consulta-xml.js';
