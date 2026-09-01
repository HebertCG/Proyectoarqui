/**
 * Mediación de protocolos del ESB.
 *
 * Es **la razón de ser del bus** en este proyecto (CLAUDE.md §5.3): traducir
 * entre servicios que hablan idiomas distintos sin que ninguno conozca al otro.
 *
 *     Sales & Customer Service          E-Invoicing / SUNAT
 *         REST / JSON        ⇄  ESB  ⇄      SOAP / XML
 *
 * El caso concreto: el POS registra una venta en JSON y SUNAT exige el
 * comprobante en XML/UBL dentro de un sobre SOAP. Sin mediación, el POS tendría
 * que hablar SOAP —acoplándose a un detalle del otro extremo— o SUNAT tendría
 * que aceptar JSON, que no va a pasar.
 *
 * **La mediación no interpreta negocio.** Convierte formato y protocolo; qué
 * significan los campos es asunto de los servicios (§12).
 */
import { TransformadorXslt, ConsultaXml } from '@pos/xml-kit';

export type Protocolo = 'REST' | 'SOAP';

export interface MensajeMediado {
  /** Cuerpo ya en el formato del destino. */
  cuerpo: string;
  contentType: string;
  /** Cabecera SOAPAction, cuando el destino es SOAP. */
  soapAction?: string | undefined;
}

/**
 * Envuelve un documento XML en un sobre SOAP 1.1.
 *
 * Se construye a mano y no con una librería porque el sobre es trivial y una
 * dependencia más solo añadiría superficie: lo que tiene sustancia es el
 * contenido, y de eso se encarga el XSLT.
 */
export function envolverEnSoap(
  cuerpoXml: string,
  namespaceOperacion: string,
  operacion: string,
): string {
  // Se descarta la declaración XML del interior: solo puede haber una, la del sobre.
  const sinDeclaracion = cuerpoXml.replace(/^<\?xml[^>]*\?>\s*/, '');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<ns:${operacion} xmlns:ns="${namespaceOperacion}">` +
    sinDeclaracion +
    `</ns:${operacion}>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

/** Extrae el contenido del `soap:Body`, descartando el sobre. */
export function desenvolverSoap(sobre: string): string {
  const cuerpo = sobre.match(/<(?:\w+:)?Body[^>]*>([\s\S]*)<\/(?:\w+:)?Body>/);
  return cuerpo?.[1]?.trim() ?? sobre;
}

/** ¿El sobre trae un SOAP Fault? */
export function esSoapFault(sobre: string): boolean {
  return /<(?:\w+:)?Fault[\s>]/.test(sobre);
}

export interface DetalleFault {
  codigo: string;
  razon: string;
}

/**
 * Traduce un SOAP Fault a los campos del envelope de error REST.
 *
 * Sin esto, un rechazo de SUNAT llegaría al POS como un bloque de XML que
 * nadie sabría interpretar.
 */
export function traducirFault(sobre: string): DetalleFault {
  const q = new ConsultaXml(sobre);

  // SOAP 1.2 usa Code/Value y Reason/Text; SOAP 1.1 usa faultcode y faultstring.
  const codigo =
    q.texto('//*:Fault/*:Code/*:Subcode/*:Value') ||
    q.texto('//*:Fault/*:Code/*:Value') ||
    q.texto('//*:Fault/*:faultcode') ||
    'SOAP_FAULT';

  const razon =
    q.texto('//*:Fault/*:Reason/*:Text') ||
    q.texto('//*:Fault/*:faultstring') ||
    'El servicio SOAP devolvió un fallo sin descripción.';

  return { codigo, razon };
}

export interface OpcionesMediador {
  /** XSLT compilado que convierte el formato interno al del destino. */
  transformacion?: TransformadorXslt | undefined;
  namespaceOperacion: string;
  operacion: string;
}

/**
 * Media de REST/JSON a SOAP/XML.
 *
 * Tres pasos, en este orden:
 *
 *   1. JSON → XML canónico
 *   2. XML canónico → formato del destino (XSLT)
 *   3. Envolver en sobre SOAP
 *
 * El paso 2 es un XSLT y no código porque el mapeo cambia cuando el destino
 * publica una versión nueva de su formato, y cambiar un `.xsl` no obliga a
 * recompilar el bus.
 */
export class MediadorRestASoap {
  readonly #opciones: OpcionesMediador;

  constructor(opciones: OpcionesMediador) {
    this.#opciones = opciones;
  }

  mediar(cuerpoJson: unknown, raizXml: string, namespace: string): MensajeMediado {
    const canonico = jsonAXml(cuerpoJson, raizXml, namespace);

    const transformado = this.#opciones.transformacion
      ? this.#opciones.transformacion.transformar(canonico)
      : canonico;

    return {
      cuerpo: envolverEnSoap(
        transformado,
        this.#opciones.namespaceOperacion,
        this.#opciones.operacion,
      ),
      contentType: 'text/xml; charset=utf-8',
      soapAction: `urn:${this.#opciones.operacion}`,
    };
  }
}

/** Media de SOAP/XML de vuelta a REST/JSON. */
export class MediadorSoapARest {
  mediar(sobre: string): { estado: number; cuerpo: unknown } {
    if (esSoapFault(sobre)) {
      const fault = traducirFault(sobre);
      return {
        // Un fault de negocio no es un fallo del bus: es una respuesta del
        // destino que hay que entregar en el formato que el llamante entiende.
        estado: 422,
        cuerpo: {
          exito: false,
          datos: null,
          error: { codigo: fault.codigo, mensaje: fault.razon },
        },
      };
    }

    return {
      estado: 200,
      cuerpo: { exito: true, datos: xmlAJson(desenvolverSoap(sobre)), error: null },
    };
  }
}

// ── Conversión JSON ⇄ XML ─────────────────────────────────────────

const escapar = (texto: string): string =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Serializa un objeto JSON a XML.
 *
 * Convención: cada clave es un elemento; los arrays repiten el elemento padre en
 * singular. Es una convención del bus, no una inferencia: los formatos con
 * significado los define un XSLT.
 */
export function jsonAXml(valor: unknown, raiz: string, namespace: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${raiz} xmlns="${namespace}">${serializar(
    valor,
  )}</${raiz}>`;
}

function serializar(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (Array.isArray(valor)) return valor.map((v) => serializar(v)).join('');

  if (typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([clave, v]) =>
        Array.isArray(v)
          ? v.map((item) => `<${clave}>${serializar(item)}</${clave}>`).join('')
          : `<${clave}>${serializar(v)}</${clave}>`,
      )
      .join('');
  }

  return escapar(String(valor));
}

/** Convierte XML a JSON. Inversa aproximada de `jsonAXml`. */
export function xmlAJson(xml: string): Record<string, unknown> {
  const raiz = new ConsultaXml(xml).nodo('/*') as NodoXml | null;

  // El elemento raiz se descarta y sus hijos pasan a ser las claves del objeto:
  // el nombre de la raiz es del sobre, no del contenido.
  return raiz ? (nodoAJson(raiz) as Record<string, unknown>) : {};
}

interface NodoXml {
  nodeType?: number;
  nodeName?: string;
  textContent?: string;
  childNodes?: ArrayLike<NodoXml>;
}

function nodoAJson(nodo: NodoXml): unknown {
  const hijos = Array.from(nodo.childNodes ?? []).filter(
    (h) => h.nodeType === 1, // solo elementos
  );

  if (hijos.length === 0) return nodo.textContent ?? '';

  const resultado: Record<string, unknown> = {};

  for (const hijo of hijos) {
    const nombre = (hijo.nodeName ?? '').replace(/^\w+:/, '');
    const valor = nodoAJson(hijo);

    if (nombre in resultado) {
      const actual = resultado[nombre];
      resultado[nombre] = Array.isArray(actual) ? [...actual, valor] : [actual, valor];
    } else {
      resultado[nombre] = valor;
    }
  }

  return resultado;
}
