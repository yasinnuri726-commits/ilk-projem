// Yol: klipai/apps/api/src/worker.ts
//
// HTTP sunucusu açmadan yalnızca kuyruk işleyicilerini (orkestratör, bakım)
// çalıştıran süreç. Üretimde API'den bağımsız ölçeklenir.
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { Logger } from 'nestjs-pino';

process.env.ROLE = 'worker';

async function main(): Promise<void> {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      release: process.env.APP_VERSION,
      sendDefaultPii: false,
    });
  }
  // AppModule, ROLE atandıktan sonra yüklenmelidir.
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
