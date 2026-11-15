// Yol: klipai/apps/api/src/bootstrap.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/request-context';
import { AppConfig } from './config/app-config';

/** HTTP uygulamasının ortak kurulumu (main.ts ve e2e testleri aynı ayarı kullanır). */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');
  // Yük dengeleyicinin arkasında gerçek istemci IP'si (hız sınırı, hak beyanı kaydı).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestContextMiddleware);
  app.useBodyParser('json', { limit: '1mb' });
  if (config.corsOrigins.length) app.enableCors({ origin: config.corsOrigins });
  app.enableShutdownHooks();
}
