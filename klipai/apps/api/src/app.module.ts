// Yol: klipai/apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth.guard';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { ProblemFilter } from './common/problem.filter';
import { RateLimitGuard } from './common/rate-limit.guard';
import { currentContext } from './common/request-context';
import { InfraModule } from './infra/infra.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { HealthController } from './modules/health/health.controller';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { UsersModule } from './modules/users/users.module';

const env = process.env.NODE_ENV ?? 'development';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env === 'test' ? 'silent' : env === 'development' ? 'debug' : 'info',
        // Her log satırına isteğin traceId'si eklenir.
        mixin: () => ({ traceId: currentContext()?.traceId }),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["idempotency-key"]'],
        autoLogging: { ignore: (req) => req.url === '/v1/health' },
        transport: env === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    InfraModule,
    BillingModule,
    ChannelsModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    PipelineModule,
    ProjectsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Sıra önemli: önce kimlik, sonra (kullanıcıya göre) hız sınırı.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
