#!/usr/bin/env node
/**
 * Genera el esqueleto de un servicio del inventario.
 *
 *   node tools/crear-servicio.mjs <nombre-kebab> <entidad|tarea|utilidad> [puerto]
 *
 * El servicio generado ya trae: bootstrap con @pos/service-kit, /health,
 * validación de esquema en el borde, envelope, auditoría, idempotencia,
 * pruebas y la ficha de servicio que exige CLAUDE.md §2.1 y §2.3.
 *
 * La ficha nace incompleta a propósito: obliga a llenarla antes de dar el
 * servicio por diseñado.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');

const TIPOS = { entidad: 'Entidad', tarea: 'Tarea', utilidad: 'Utilidad' };

const [, , nombre, tipo, puertoArg] = process.argv;

if (!nombre || !tipo || !TIPOS[tipo]) {
  console.error(
    'Uso: node tools/crear-servicio.mjs <nombre-kebab> <entidad|tarea|utilidad> [puerto]\n' +
      'Ejemplo: node tools/crear-servicio.mjs catalogo entidad 3001',
  );
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(nombre)) {
  console.error(`"${nombre}" no es kebab-case (CLAUDE.md §7).`);
  process.exit(1);
}

const puerto = Number(puertoArg ?? 3000);
const pascal = nombre.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
const destino = join(raiz, 'servicios', tipo, nombre);
const baseDatos = `svc_${nombre.replace(/-/g, '_')}`;
const codigoError = `${nombre.toUpperCase().replace(/-/g, '_')}_NO_ENCONTRADO`;
const nombreServicio = `${pascal}.${TIPOS[tipo]}`;

try {
  await access(destino);
  console.error(`Ya existe ${destino}. No se sobrescribe.`);
  process.exit(1);
} catch {
  /* no existe: seguimos */
}

const packageJson = {
  name: `@pos/${nombre}`,
  version: '0.1.0',
  private: true,
  type: 'module',
  description: `Servicio de ${TIPOS[tipo]} — ${pascal}`,
  scripts: {
    // tsx resuelve los especificadores './x.js' hacia './x.ts'; node crudo no.
    dev: 'tsx watch src/index.ts',
    // start corre el build: en produccion no se transpila en caliente.
    start: 'node dist/index.js',
    build: 'tsc -b',
    typecheck: 'tsc --noEmit',
    test: 'vitest run',
  },
  dependencies: {
    '@pos/service-kit': 'workspace:*',
    '@sinclair/typebox': '^0.34.0',
    fastify: '^5.2.0',
  },
  devDependencies: {
    '@types/node': '^22.10.0',
    tsx: '^4.19.0',
    typescript: '^5.7.0',
    vitest: '^3.0.0',
  },
};

const tsconfig = {
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    rootDir: './src',
    outDir: './dist',
    tsBuildInfoFile: './dist/.tsbuildinfo',
  },
  include: ['src/**/*.ts'],
  exclude: ['dist', 'node_modules', 'tests'],
};

const rutas = [
  `import { Type } from '@sinclair/typebox';`,
  `import type { FastifyInstance } from 'fastify';`,
  `import { exito, errorNoEncontrado } from '@pos/service-kit';`,
  ``,
  `/**`,
  ` * Rutas de ${pascal}.`,
  ` *`,
  ` * Contract-first: el esquema declarado aquí debe corresponder al contrato`,
  ` * publicado en contratos/openapi/${nombre}-v1.yaml. El contrato manda.`,
  ` */`,
  `export function registrarRutas(app: FastifyInstance): void {`,
  `  app.get(`,
  `    '/ejemplo/:id',`,
  `    {`,
  `      schema: {`,
  `        params: Type.Object({ id: Type.String({ minLength: 1 }) }),`,
  `      },`,
  `    },`,
  `    async (peticion) => {`,
  `      const { id } = peticion.params as { id: string };`,
  ``,
  `      if (id === 'inexistente') {`,
  `        throw errorNoEncontrado(`,
  `          '${codigoError}',`,
  '          `No existe el recurso ${id}.`,',
  `        );`,
  `      }`,
  ``,
  `      await app.auditoria.registrar({`,
  `        correlationId: peticion.correlationId,`,
  `        servicio: app.config.nombre,`,
  `        accion: 'RECURSO_CONSULTADO',`,
  `        recurso: '${nombre}',`,
  `        recursoId: id,`,
  `        usuario: 'sistema',`,
  `        timestamp: new Date().toISOString(),`,
  `      });`,
  ``,
  `      return exito({ id, nombre: 'ejemplo' }, app.meta(peticion));`,
  `    },`,
  `  );`,
  `}`,
  ``,
].join('\n');

const indexTs = [
  `import { crearServicio, cargarConfig } from '@pos/service-kit';`,
  `import { registrarRutas } from './rutas.js';`,
  ``,
  `const config = cargarConfig({`,
  `  nombre: '${nombreServicio}',`,
  `  puertoPorDefecto: ${puerto},`,
  `});`,
  ``,
  `const app = await crearServicio({ config });`,
  `registrarRutas(app);`,
  ``,
  `// Base propia — nunca la de otro servicio (CLAUDE.md §4.6, principio P5).`,
  `app.log.info({ baseDatos: '${baseDatos}' }, 'base de datos del servicio');`,
  ``,
  `await app.listen({ port: config.puerto, host: '0.0.0.0' });`,
  ``,
].join('\n');

const test = [
  `import { describe, it, expect, beforeEach } from 'vitest';`,
  `import type { FastifyInstance } from 'fastify';`,
  `import { crearServicio, cargarConfig, AuditoriaConsola } from '@pos/service-kit';`,
  `import { registrarRutas } from '../src/rutas.js';`,
  ``,
  `let app: FastifyInstance;`,
  `let auditoria: AuditoriaConsola;`,
  ``,
  `beforeEach(async () => {`,
  `  auditoria = new AuditoriaConsola();`,
  `  app = await crearServicio({`,
  `    config: cargarConfig({`,
  `      nombre: '${nombreServicio}',`,
  `      puertoPorDefecto: ${puerto},`,
  `      env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },`,
  `    }),`,
  `    auditoria,`,
  `  });`,
  `  registrarRutas(app);`,
  `  await app.ready();`,
  `});`,
  ``,
  `describe('${nombreServicio}', () => {`,
  `  it('responde /health', async () => {`,
  `    const r = await app.inject({ method: 'GET', url: '/health' });`,
  `    expect(r.statusCode).toBe(200);`,
  `    expect(r.json().datos.estado).toBe('ok');`,
  `  });`,
  ``,
  `  it('devuelve el recurso con el envelope estándar', async () => {`,
  `    const r = await app.inject({ method: 'GET', url: '/ejemplo/abc' });`,
  `    expect(r.statusCode).toBe(200);`,
  `    expect(r.json().exito).toBe(true);`,
  `    expect(r.json().datos.id).toBe('abc');`,
  `  });`,
  ``,
  `  it('audita la consulta (RNF-11)', async () => {`,
  `    await app.inject({ method: 'GET', url: '/ejemplo/abc' });`,
  `    expect(auditoria.entradas).toHaveLength(1);`,
  `    expect(auditoria.entradas[0]?.accion).toBe('RECURSO_CONSULTADO');`,
  `  });`,
  ``,
  `  it('devuelve 404 con envelope cuando no existe', async () => {`,
  `    const r = await app.inject({ method: 'GET', url: '/ejemplo/inexistente' });`,
  `    expect(r.statusCode).toBe(404);`,
  `    expect(r.json().exito).toBe(false);`,
  `  });`,
  `});`,
  ``,
].join('\n');

const readme = [
  `# ${nombreServicio}`,
  ``,
  `> Servicio de **${TIPOS[tipo]}** del inventario (CLAUDE.md §4).`,
  `> **Base de datos propia:** \`${baseDatos}\` — ningún otro servicio la lee (P5).`,
  ``,
  `## Propósito`,
  ``,
  `_(Qué resuelve y a qué objetivo estratégico del negocio sirve. Un servicio que`,
  `no se puede vincular a un proceso de negocio está mal diseñado — CLAUDE.md §1.3.)_`,
  ``,
  `## Clasificación (CLAUDE.md §2.3)`,
  ``,
  `| Atributo | Valor |`,
  `| :--- | :--- |`,
  `| Tipo / capa | ${TIPOS[tipo]} |`,
  `| Estado | _Stateless / Stateful + justificación_ |`,
  `| Comunicación | _Síncrona / Asíncrona + justificación_ |`,
  `| Granularidad | _Fina / Media / Gruesa_ |`,
  `| Rol | _Proveedor / Consumidor / Intermediario / Compositor_ |`,
  `| Seguridad | _Autenticación, autorización, cifrado en tránsito_ |`,
  ``,
  `## Contrato`,
  ``,
  `- OpenAPI: \`contratos/openapi/${nombre}-v1.yaml\``,
  `- Esquemas: \`contratos/xsd/\``,
  ``,
  `## Los 8 principios (CLAUDE.md §2.1)`,
  ``,
  `| # | Principio | Cómo se cumple |`,
  `| :--- | :--- | :--- |`,
  `| P1 | Contrato estandarizado | |`,
  `| P2 | Bajo acoplamiento | |`,
  `| P3 | Abstracción | |`,
  `| P4 | Reutilización | |`,
  `| P5 | Autonomía | Base propia \`${baseDatos}\` |`,
  `| P6 | Sin estado | |`,
  `| P7 | Descubribilidad | Registrado en el registro UDDI |`,
  `| P8 | Componibilidad | |`,
  ``,
  `## Requerimientos que cubre`,
  ``,
  `| RF/RNF | Operación |`,
  `| :--- | :--- |`,
  `| | |`,
  ``,
  `## Operación`,
  ``,
  '```bash',
  `pnpm --filter @pos/${nombre} dev     # desarrollo`,
  `pnpm --filter @pos/${nombre} test    # pruebas`,
  '```',
  ``,
  `Puerto por defecto: \`${puerto}\``,
  ``,
].join('\n');

await mkdir(join(destino, 'src'), { recursive: true });
await mkdir(join(destino, 'tests'), { recursive: true });
await mkdir(join(destino, 'db'), { recursive: true });

const escribir = (ruta, contenido) => writeFile(join(destino, ruta), contenido, 'utf-8');

await Promise.all([
  escribir('package.json', JSON.stringify(packageJson, null, 2) + '\n'),
  escribir('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n'),
  escribir('src/index.ts', indexTs),
  escribir('src/rutas.ts', rutas),
  escribir(`tests/${nombre}.spec.ts`, test),
  escribir('README.md', readme),
  escribir('db/.gitkeep', ''),
]);

console.log(`
Servicio creado: servicios/${tipo}/${nombre}

  Nombre    ${nombreServicio}
  Puerto    ${puerto}
  Base      ${baseDatos}

Siguientes pasos:
  1. pnpm install
  2. Llenar la ficha de servicio en servicios/${tipo}/${nombre}/README.md
  3. Escribir el contrato en contratos/openapi/${nombre}-v1.yaml ANTES de implementar
  4. pnpm --filter @pos/${nombre} test
`);
