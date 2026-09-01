import { defineConfig } from 'drizzle-kit';

// Migraciones propias del servicio (CLAUDE.md 6). Ningun otro servicio las toca.
export default defineConfig({
  schema: './src/esquema.ts',
  out: './db/migraciones',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://pos:pos_dev_local@localhost:5432/svc_auditoria',
  },
});
