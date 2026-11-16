import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { bigintReplacer } from './common/http';
import { env } from './config';

async function bootstrap() {
  const e = env();
  if (e.SENTRY_DSN) Sentry.init({ dsn: e.SENTRY_DSN, environment: e.NODE_ENV, tracesSampleRate: 0.1 });

  // rawBody: iç uçtaki HMAC doğrulaması gövdenin ham baytlarını gerektirir.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set('trust proxy', 1);
  app.set('json replacer', bigintReplacer);
  app.use(helmet());
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: e.CORS_ORIGINS ? e.CORS_ORIGINS.split(',') : false });
  app.enableShutdownHooks();
  await app.listen(e.PORT, '0.0.0.0');
}

void bootstrap();
