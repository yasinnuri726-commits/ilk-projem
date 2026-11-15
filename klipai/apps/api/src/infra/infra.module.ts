// Yol: klipai/apps/api/src/infra/infra.module.ts
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { CryptoService } from './crypto.service';
import { MailService } from './mail.service';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue.service';
import { RedisService } from './redis.service';
import { StorageService } from './storage.service';

const config = { provide: AppConfig, useFactory: (): AppConfig => new AppConfig() };

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      extraProviders: [config],
      inject: [AppConfig],
      useFactory: (c: AppConfig) => ({
        secret: c.jwtSecret,
        signOptions: { algorithm: 'HS256', expiresIn: c.accessTtlSec, issuer: 'klipai' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'klipai' },
      }),
    }),
  ],
  providers: [config, PrismaService, RedisService, StorageService, CryptoService, QueueService, MailService],
  exports: [
    AppConfig,
    JwtModule,
    PrismaService,
    RedisService,
    StorageService,
    CryptoService,
    QueueService,
    MailService,
  ],
})
export class InfraModule {}
