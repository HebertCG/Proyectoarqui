import { defineConfig } from 'vitest/config';

/**
 * Configuración de pruebas compartida por todos los servicios.
 *
 * CLAUDE.md §9.3 exige cobertura ≥ 80%. Para que ese número signifique algo, se
 * mide sobre la **lógica**, no sobre archivos que no la contienen.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],

      exclude: [
        // Configuración: no tiene lógica que probar.
        '**/drizzle.config.ts',
        '**/vitest.config.ts',
        '**/*.config.ts',

        // Arranque: solo cablea piezas ya probadas. Se verifica levantando el
        // servicio de verdad, no con pruebas unitarias.
        '**/src/index.ts',

        // Declaraciones de tabla e interfaces: son tipos, no comportamiento.
        '**/src/esquema.ts',
        '**/src/repositorio.ts',

        // Repositorios sobre PostgreSQL: requieren base real. Se cubren con
        // pruebas de INTEGRACIÓN (*.integracion.spec.ts), que corren solo con
        // Docker levantado y no cuentan en la cobertura unitaria.
        '**/src/repositorio-postgres.ts',

        '**/dist/**',
        '**/node_modules/**',
        '**/tests/**',
      ],

      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
