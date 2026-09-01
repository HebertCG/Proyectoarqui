/**
 * XPath 3.1 y XQuery 3.1 sobre documentos XML.
 *
 * XPath es el mecanismo de ruteo por contenido del ESB: el bus mira dentro del
 * mensaje para decidir a que servicio enviarlo, sin conocer su implementacion
 * (CLAUDE.md §5.3).
 *
 * XQuery se usa para consultas sobre documentos, por ejemplo reportes sobre
 * comprobantes emitidos.
 *
 * Ambos los resuelve `fontoxpath`, que implementa las dos especificaciones.
 */
// fontoxpath es CommonJS y no declara `exports` ni `type: module`. Node ESM no
// detecta sus exports nombrados —aunque Vitest sí los resuelva—, así que el
// servicio compilaba y fallaba al arrancar. Import por defecto funciona en ambos.
import fontoxpath from 'fontoxpath';
import { parseXmlDocument } from 'slimdom';

const {
  evaluateXPath,
  evaluateXPathToString,
  evaluateXPathToStrings,
  evaluateXPathToNumber,
  evaluateXPathToBoolean,
  evaluateXPathToFirstNode,
  evaluateXPathToNodes,
} = fontoxpath;

export type DocumentoXml = ReturnType<typeof parseXmlDocument>;

/** Parsea texto XML a un documento consultable. */
export function parsear(xml: string): DocumentoXml {
  return parseXmlDocument(xml);
}

const opcionesXQuery = {
  language: evaluateXPath.XQUERY_3_1_LANGUAGE,
};

/**
 * Consultas XPath sobre un documento.
 *
 * Los metodos van tipados por lo que devuelven, para no andar convirtiendo
 * a mano en cada punto de uso.
 */
export class ConsultaXml {
  readonly #doc: DocumentoXml;

  constructor(origen: string | DocumentoXml) {
    this.#doc = typeof origen === 'string' ? parsear(origen) : origen;
  }

  get documento(): DocumentoXml {
    return this.#doc;
  }

  texto(xpath: string): string {
    return evaluateXPathToString(xpath, this.#doc, null);
  }

  textos(xpath: string): string[] {
    return evaluateXPathToStrings(xpath, this.#doc, null);
  }

  numero(xpath: string): number {
    return evaluateXPathToNumber(xpath, this.#doc, null);
  }

  booleano(xpath: string): boolean {
    return evaluateXPathToBoolean(xpath, this.#doc, null);
  }

  nodo(xpath: string): unknown {
    return evaluateXPathToFirstNode(xpath, this.#doc, null);
  }

  nodos(xpath: string): unknown[] {
    return evaluateXPathToNodes(xpath, this.#doc, null);
  }

  /** Ejecuta una consulta XQuery 3.1 y devuelve los resultados como texto. */
  xquery(consulta: string): string[] {
    return evaluateXPathToStrings(consulta, this.#doc, null, {}, opcionesXQuery);
  }

  /** Ejecuta XQuery y devuelve el valor crudo (secuencia, mapa, array...). */
  xqueryCrudo(consulta: string): unknown {
    return evaluateXPath(
      consulta,
      this.#doc,
      null,
      {},
      evaluateXPath.ANY_TYPE,
      opcionesXQuery,
    );
  }
}

/**
 * Atajo para ruteo por contenido en el ESB.
 * Devuelve el texto del primer nodo que case, o cadena vacia.
 */
export function extraer(xml: string | DocumentoXml, xpath: string): string {
  return new ConsultaXml(xml).texto(xpath);
}
