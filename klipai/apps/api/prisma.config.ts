// Yol: klipai/apps/api/prisma.config.ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'ts-node prisma/seed.ts' },
  datasource: {
    // `prisma generate` veritabanına bağlanmaz; imaj derlemesinde değişken olmayabilir.
    url: process.env.DATABASE_URL ?? 'postgresql://klipai:klipai@localhost:5432/klipai',
  },
});
