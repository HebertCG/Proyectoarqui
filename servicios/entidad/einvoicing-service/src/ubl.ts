/**
 * Generación de UBL 2.1 para SUNAT.
 *
 * El comprobante interno se serializa a XML canónico y se transforma a UBL con
 * el XSLT de `contratos/xslt/comprobante-a-ubl-v1.xsl`.
 *
 * **La transformación no vive en código TypeScript a propósito.** Es un XSLT,
 * que es lo que exige el temario (sesiones 5–6) y además lo correcto: el mapeo a
 * UBL cambia cuando SUNAT publica una versión nueva del catálogo, y cambiar un
 * `.xsl` no obliga a recompilar el servicio.
 */
import { TransformadorXslt, ValidadorXsd } from '@pos/xml-kit';

import type { Comprobante } from './comprobante.js';

const NS_COMPROBANTE = 'urn:pos:einvoicing:v1';

/** Escapa lo que va como texto dentro de un elemento XML. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const dec = (valor: number): string => valor.toFixed(2);

/**
 * Serializa el comprobante al XML canónico del servicio.
 *
 * Es el formato que valida `contratos/xsd/einvoicing-v1.xsd` y la entrada del
 * XSLT. Que exista un formato canónico intermedio es lo que permite cambiar el
 * mapeo a UBL sin tocar el modelo de dominio.
 */
export function aXmlCanonico(c: Comprobante): string {
  const cliente = c.cliente;
  const documento =
    cliente.numeroDocumento === undefined
      ? ''
      : `\n    <numeroDocumento>${escapar(cliente.numeroDocumento)}</numeroDocumento>`;

  const lineas = c.lineas
    .map(
      (l) => `
    <linea>
      <sku>${escapar(l.sku)}</sku>
      <descripcion>${escapar(l.descripcion)}</descripcion>
      <cantidad>${l.cantidad}</cantidad>
      <precioUnitario>${dec(l.precioUnitario)}</precioUnitario>
      <importe>${dec(l.importe)}</importe>
    </linea>`,
    )
    .join('');

  const respuesta = c.respuestaSunat
    ? `
  <respuestaSunat>
    <codigo>${escapar(c.respuestaSunat.codigo)}</codigo>
    <descripcion>${escapar(c.respuestaSunat.descripcion)}</descripcion>
    <recibidoEn>${c.respuestaSunat.recibidoEn.toISOString()}</recibidoEn>
  </respuestaSunat>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Comprobante xmlns="${NS_COMPROBANTE}">
  <uuid>${escapar(c.uuid)}</uuid>
  <tipoComprobante>${c.tipoComprobante}</tipoComprobante>
  <serie>${escapar(c.serie)}</serie>
  <correlativo>${c.correlativo}</correlativo>
  <fechaEmision>${c.fechaEmision}</fechaEmision>
  <cliente>
    <tipoDocumento>${cliente.tipoDocumento}</tipoDocumento>${documento}
    <razonSocial>${escapar(cliente.razonSocial)}</razonSocial>
  </cliente>
  <lineas>${lineas}
  </lineas>
  <totalGravado>${dec(c.totalGravado)}</totalGravado>
  <totalIgv>${dec(c.totalIgv)}</totalIgv>
  <total>${dec(c.total)}</total>
  <estadoTributario>${c.estadoTributario}</estadoTributario>${respuesta}
</Comprobante>
`;
}

/**
 * Convierte comprobantes internos a UBL 2.1.
 *
 * Se construye una vez con el XSLT compilado y el XSD, y se reutiliza: cargar
 * ambos en cada comprobante sería un desperdicio.
 */
export class GeneradorUbl {
  readonly #transformador: TransformadorXslt;
  readonly #validador: ValidadorXsd;

  constructor(sefXslt: string, xsdComprobante: string, xsdComunes: string) {
    this.#transformador = new TransformadorXslt(sefXslt, 'comprobante-a-ubl-v1');
    this.#validador = new ValidadorXsd(xsdComprobante, {
      nombre: 'einvoicing-v1',
      importados: [{ nombre: 'tipos-comunes-v1.xsd', contenido: xsdComunes }],
    });
  }

  /**
   * Valida el comprobante contra su XSD y lo transforma a UBL.
   *
   * La validación va **antes** de transformar: mandar a SUNAT un documento mal
   * formado consume un correlativo y obliga a una nota de crédito para
   * corregirlo. Es más barato fallar aquí.
   */
  async generar(comprobante: Comprobante): Promise<string> {
    const canonico = aXmlCanonico(comprobante);
    await this.#validador.exigir(canonico, `${comprobante.serie}-${comprobante.correlativo}.xml`);
    return this.#transformador.transformar(canonico);
  }

  /** Solo valida, sin transformar. Útil para diagnóstico. */
  async validar(comprobante: Comprobante) {
    return this.#validador.validar(aXmlCanonico(comprobante));
  }
}
