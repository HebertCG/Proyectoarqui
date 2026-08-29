#!/usr/bin/env node
/**
 * Compila todos los .xsl de contratos/xslt/ al formato SEF que necesita Saxon-JS.
 *
 * El .xsl es la fuente de verdad; el .sef.json es artefacto derivado y no se
 * edita a mano. Se regenera en cada build.
 *
 * OJO: xslt3 recibe argumentos con la forma `-xsl:valor`. PowerShell los
 * interpreta como parametros propios y los parte. Por eso este script invoca
 * el binario directamente con execFile, sin pasar por un shell.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const ejecutar = promisify(execFile);

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..', '..', '..');
const dirXslt = join(raiz, 'contratos', 'xslt');

/** Ubica el ejecutable de xslt3 dentro de node_modules. */
async function rutaXslt3() {
  const candidatos = [
    join(aqui, '..', 'node_modules', 'xslt3', 'xslt3.js'),
    join(raiz, 'node_modules', 'xslt3', 'xslt3.js'),
  ];
  for (const c of candidatos) {
    try {
      await access(c);
      return c;
    } catch {
      /* siguiente */
    }
  }
  throw new Error(
    'No se encontro xslt3. Instalalo con: pnpm --filter @pos/xml-kit add -D xslt3',
  );
}

async function main() {
  const xslt3 = await rutaXslt3();
  const archivos = (await readdir(dirXslt)).filter((f) => f.endsWith('.xsl'));

  if (archivos.length === 0) {
    console.log('No hay .xsl en contratos/xslt/. Nada que compilar.');
    return;
  }

  for (const archivo of archivos) {
    const entrada = join(dirXslt, archivo);
    const salida = join(dirXslt, `${basename(archivo, '.xsl')}.sef.json`);

    await ejecutar(process.execPath, [
      xslt3,
      `-xsl:${entrada}`,
      `-export:${salida}`,
      '-nogo',
    ]);

    console.log(`compilado  ${archivo} -> ${basename(salida)}`);
  }

  console.log(`\n${archivos.length} stylesheet(s) compilado(s).`);
}

main().catch((e) => {
  console.error(`\nERROR compilando XSLT: ${e.message}`);
  process.exit(1);
});
