/**
 * Verifica que TODOS los esquemas canónicos de `contratos/xsd/` compilan.
 *
 * Un XSD roto no falla al escribirlo: falla la primera vez que un servicio
 * intenta validar un mensaje contra él, en ejecución. Esta prueba lo adelanta
 * al momento de guardar el contrato.
 *
 * Es la red de seguridad del principio P1 (contrato estandarizado): si el
 * contrato no compila, no es un contrato.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { ValidadorXsd, ErrorCompilacionEsquema } from '../src/validador-xsd.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const dirXsd = resolve(aqui, '..', '..', '..', 'contratos', 'xsd');

/** Esquema base que todos los demás importan. */
const COMUNES = 'tipos-comunes-v1.xsd';

/** Documento cualquiera: solo sirve para forzar la compilación del esquema. */
const XML_SONDA = '<?xml version="1.0" encoding="UTF-8"?><sonda/>';

let archivos: string[];
let comunes: string;

beforeAll(async () => {
  archivos = (await readdir(dirXsd)).filter((f) => f.endsWith('.xsd')).sort();
  comunes = await readFile(join(dirXsd, COMUNES), 'utf-8');
});

describe('contratos/xsd — integridad de los esquemas canónicos', () => {
  it('hay esquemas que verificar', () => {
    expect(archivos.length).toBeGreaterThan(0);
    expect(archivos).toContain(COMUNES);
  });

  it('todos los esquemas compilan sin error', async () => {
    const rotos: string[] = [];

    for (const archivo of archivos) {
      const contenido = await readFile(join(dirXsd, archivo), 'utf-8');
      const validador = new ValidadorXsd(contenido, {
        nombre: archivo,
        // El propio tipos-comunes no se importa a sí mismo, pero pasarlo
        // siempre es inofensivo y simplifica el bucle.
        importados: [{ nombre: COMUNES, contenido: comunes }],
      });

      try {
        // Un documento que no cumple es lo esperado; lo que no puede pasar
        // es que el ESQUEMA no compile.
        await validador.validar(XML_SONDA);
      } catch (e) {
        if (e instanceof ErrorCompilacionEsquema) {
          rotos.push(`${archivo}: ${e.message}`);
        } else {
          throw e;
        }
      }
    }

    expect(rotos).toEqual([]);
  });

  it('cada esquema declara su propio targetNamespace bajo urn:pos:', async () => {
    const sinNamespace: string[] = [];

    for (const archivo of archivos) {
      const contenido = await readFile(join(dirXsd, archivo), 'utf-8');
      const coincidencia = contenido.match(/targetNamespace="([^"]+)"/);

      if (!coincidencia?.[1]?.startsWith('urn:pos:')) {
        sinNamespace.push(`${archivo}: ${coincidencia?.[1] ?? '(ninguno)'}`);
      }
    }

    // CLAUDE.md §7: urn:pos:{dominio}:{servicio}:v{n}
    expect(sinNamespace).toEqual([]);
  });

  it('los namespaces son únicos: dos esquemas no comparten uno', async () => {
    const porNamespace = new Map<string, string[]>();

    for (const archivo of archivos) {
      const contenido = await readFile(join(dirXsd, archivo), 'utf-8');
      const ns = contenido.match(/targetNamespace="([^"]+)"/)?.[1];
      if (!ns) continue;
      porNamespace.set(ns, [...(porNamespace.get(ns) ?? []), archivo]);
    }

    const duplicados = [...porNamespace.entries()]
      .filter(([, archivos]) => archivos.length > 1)
      .map(([ns, archivos]) => `${ns} -> ${archivos.join(', ')}`);

    expect(duplicados).toEqual([]);
  });

  it('todo esquema versionado declara la versión en su namespace', async () => {
    const malVersionados: string[] = [];

    for (const archivo of archivos) {
      const contenido = await readFile(join(dirXsd, archivo), 'utf-8');
      const ns = contenido.match(/targetNamespace="([^"]+)"/)?.[1] ?? '';
      // El versionado del contrato es obligatorio (CLAUDE.md §7, P1).
      if (!/:v\d+$/.test(ns)) malVersionados.push(`${archivo}: ${ns}`);
    }

    expect(malVersionados).toEqual([]);
  });
});
