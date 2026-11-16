import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { env } from '../config';
import { RedisService } from './redis.service';
import { StorageService } from './storage.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly transport = env().SMTP_URL ? nodemailer.createTransport(env().SMTP_URL) : null;

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transport) {
      // SMTP tanımlı değilse (yerel geliştirme) içerik loga yazılır.
      this.log.warn(`SMTP_URL tanımlı değil; e-posta gönderilmedi → ${to} | ${subject}\n${text}`);
      return;
    }
    await this.transport.sendMail({ from: env().MAIL_FROM, to, subject, text });
  }
}

@Global()
@Module({
  providers: [PrismaService, RedisService, StorageService, MailService],
  exports: [PrismaService, RedisService, StorageService, MailService],
})
export class InfraModule {}
