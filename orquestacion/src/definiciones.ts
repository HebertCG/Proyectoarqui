/**
 * Carga de los modelos BPMN desde disco.
 *
 * Los `.bpmn` viven en `orquestacion/definiciones/` y se tratan como
 * **contratos**: se versionan, se revisan y no se editan a mano en producción.
 * Se leen una vez y se cachean — son inmutables durante la vida del proceso.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** `dist/` está un nivel bajo la raíz del paquete, igual que `src/`. */
const CARPETA_DEFINICIONES = join(AQUI, '..', 'definiciones');

/** Procesos disponibles. Añadir uno exige añadir su `.bpmn`. */
export const PROCESOS = {
  PROCESO_VENTA: 'proceso-venta',
} as const;

export type NombreProceso = (typeof PROCESOS)[keyof typeof PROCESOS];

const cache = new Map<string, string>();

/**
 * Devuelve el XML de un proceso. Falla ruidosamente si el archivo no está: un
 * proceso de negocio ausente no es algo que deba degradarse en silencio.
 */
export async function cargarDefinicion(nombre: NombreProceso): Promise<string> {
  const enCache = cache.get(nombre);
  if (enCache !== undefined) return enCache;

  const ruta = join(CARPETA_DEFINICIONES, `${nombre}.bpmn`);

  try {
    const fuente = await readFile(ruta, 'utf8');
    cache.set(nombre, fuente);
    return fuente;
  } catch (causa) {
    throw new Error(
      `No se pudo cargar el modelo BPMN "${nombre}" desde ${ruta}: ` +
        (causa instanceof Error ? causa.message : String(causa)),
    );
  }
}

/** Solo para pruebas: obliga a releer del disco. */
export function limpiarCache(): void {
  cache.clear();
}
