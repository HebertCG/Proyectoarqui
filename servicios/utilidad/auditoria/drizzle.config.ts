import { defineConfig } from 'drizzle-kit';

// Migraciones propias del servicio (CLAUDE.md 6). Ningun otro servicio las toca.
export default defineConfig({
  schema: './src/esquema.ts',
  out: './db/migraciones',
  dialect: 'postgresql',
  dbCredentials: {
    // El puerto sale del entorno: en el host suele haber un PostgreSQL nativo
    // ocupando el 5432, asi que el contenedor escucha en otro.
    url:
      process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? 'pos'}:` +
        `${process.env.POSTGRES_PASSWORD ?? 'pos_dev_local'}@` +
        `${process.env.POSTGRES_HOST ?? 'localhost'}:` +
        `${process.env.POSTGRES_PORT ?? '5433'}/svc_auditoria`,
  },
});
