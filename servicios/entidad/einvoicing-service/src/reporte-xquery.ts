/**
 * Reporte consolidado de comprobantes, resuelto con **XQuery 3.1**.
 *
 * Es el caso que nombra [`CLAUDE.md` §5](../../../../CLAUDE.md): *"consulta sobre documentos
 * XML (ej. reportes de comprobantes)"*. No es XQuery puesto para cumplir el
 * temario: agrupar, contar y sumar recorriendo un documento XML es
 * literalmente para lo que existe el lenguaje, y aquí el dominio ya es XML —
 * los comprobantes viven como UBL 2.1 de cabo a rabo.
 *
 * El documento intermedio se construye desde el modelo y se consulta con
 * `fontoxpath`. Escribir el mismo agrupado a mano en TypeScript sería más
 * código y menos declarativo.
 */
import { ConsultaXml } from '@pos/xml-kit';

import type { Comprobante } from './comprobante.js';

/** Namespace del reporte. Sigue la convención `urn:pos:{servicio}:v{n}` (§7). */
export const NS_REPORTE = 'urn:pos:einvoicing:v1';

export interface LineaReporte {
  serie: string;
  emitidos: number;
  aceptados: number;
  rechazados: number;
  pendientes: number;
  montoTotal: number;
}

export interface ReporteComprobantes {
  desde?: string | undefined;
  hasta?: string | undefined;
  totalComprobantes: number;
  montoTotal: number;
  porSerie: LineaReporte[];
}

/** Escapa lo que va a texto XML. Nunca se concatena entrada sin pasar por aquí. */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Proyecta los comprobantes a un documento XML consultable.
 *
 * Se emiten solo los campos que el reporte necesita: un documento con todo el
 * comprobante haría la consulta más lenta sin aportar nada.
 */
export function aDocumentoXml(comprobantes: Comprobante[]): string {
  const filas = comprobantes
    .map(
      (c) =>
        `<comprobante serie="${escapar(c.serie)}" correlativo="${c.correlativo}" ` +
        `tipo="${escapar(c.tipoComprobante)}" estado="${escapar(c.estadoTributario)}" ` +
        `fecha="${escapar(c.fechaEmision)}" total="${c.total}"/>`,
    )
    .join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<comprobantes xmlns="${NS_REPORTE}">
  ${filas}
</comprobantes>`;
}

/**
 * Consulta XQuery 3.1 que agrupa por serie y consolida los totales.
 *
 * Se agrupa con `distinct-values()` + filtro por grupo, la forma clasica de
 * XQuery, y no con la clausula `group by` de XQuery 3.0: `fontoxpath` todavia
 * no la implementa (lanza `Not implemented: groupByClause`). El resultado es el
 * mismo y funciona en cualquier motor, incluidos los que se quedaron en 1.0.
 *
 * El resultado sale como XML y se parsea despues: el reporte es un documento,
 * no un objeto de JavaScript que casualmente viaja en XML.
 */
const CONSULTA_POR_SERIE = `
declare default element namespace "${NS_REPORTE}";

<resumen>{
  for $serie in distinct-values(//comprobante/@serie)
  let $g := //comprobante[@serie = $serie]
  order by $serie
  return
    <serie
      nombre="{$serie}"
      emitidos="{count($g)}"
      aceptados="{count($g[@estado = 'ACEPTADO'])}"
      rechazados="{count($g[@estado = 'RECHAZADO'])}"
      pendientes="{count($g[@estado = 'PENDIENTE_ENVIO' or @estado = 'ENVIADO'])}"
      monto="{sum($g/@total)}"/>
}</resumen>`;

/**
 * Consolida los comprobantes por serie.
 *
 * El filtro por fechas se aplica **antes** de proyectar a XML: filtrar sobre
 * el documento obligaría a construirlo entero para descartar la mayor parte.
 */
export function consolidarPorSerie(
  comprobantes: Comprobante[],
  rango: { desde?: string | undefined; hasta?: string | undefined } = {},
): ReporteComprobantes {
  const enRango = comprobantes.filter((c) => {
    if (rango.desde && c.fechaEmision < rango.desde) return false;
    if (rango.hasta && c.fechaEmision > rango.hasta) return false;
    return true;
  });

  const consulta = new ConsultaXml(aDocumentoXml(enRango));
  const resumen = consulta.xqueryCrudo(CONSULTA_POR_SERIE);

  const porSerie = leerSeries(resumen);

  return {
    ...(rango.desde ? { desde: rango.desde } : {}),
    ...(rango.hasta ? { hasta: rango.hasta } : {}),
    totalComprobantes: enRango.length,
    montoTotal: redondear(porSerie.reduce((suma, s) => suma + s.montoTotal, 0)),
    porSerie,
  };
}

/** Los importes vienen de `sum()`, que puede arrastrar error de coma flotante. */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

interface NodoConAtributos {
  getAttribute?(nombre: string): string | null;
  childNodes?: ArrayLike<unknown>;
}

/** Lee el XML que devolvió la consulta. Un `<resumen>` vacío es válido. */
function leerSeries(resumen: unknown): LineaReporte[] {
  const hijos = (resumen as NodoConAtributos)?.childNodes;
  if (!hijos) return [];

  const lineas: LineaReporte[] = [];

  for (let i = 0; i < hijos.length; i += 1) {
    const nodo = hijos[i] as NodoConAtributos;
    const nombre = nodo?.getAttribute?.('nombre');
    if (!nombre) continue;

    lineas.push({
      serie: nombre,
      emitidos: entero(nodo, 'emitidos'),
      aceptados: entero(nodo, 'aceptados'),
      rechazados: entero(nodo, 'rechazados'),
      pendientes: entero(nodo, 'pendientes'),
      montoTotal: redondear(Number(nodo.getAttribute?.('monto') ?? 0)),
    });
  }

  return lineas;
}

function entero(nodo: NodoConAtributos, atributo: string): number {
  return Number.parseInt(nodo.getAttribute?.(atributo) ?? '0', 10);
}
