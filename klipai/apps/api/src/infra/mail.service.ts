// Yol: klipai/apps/api/src/infra/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppLocale } from '@klipai/shared';
import { AppConfig } from '../config/app-config';

type Template = 'VERIFY_EMAIL' | 'PASSWORD_RESET';

const TEXTS: Record<Template, Record<AppLocale, { subject: string; body: (link: string) => string }>> = {
  VERIFY_EMAIL: {
    tr: {
      subject: 'KlipAI — e-posta adresinizi doğrulayın',
      body: (link) =>
        `Merhaba,\n\nKlipAI hesabınızı doğrulamak için bağlantıya dokunun:\n${link}\n\nBağlantı 24 saat geçerlidir. Bu hesabı siz açmadıysanız bu e-postayı yok sayabilirsiniz.`,
    },
    en: {
      subject: 'KlipAI — verify your email address',
      body: (link) =>
        `Hello,\n\nTap the link to verify your KlipAI account:\n${link}\n\nThe link is valid for 24 hours. If you did not create this account you can ignore this email.`,
    },
  },
  PASSWORD_RESET: {
    tr: {
      subject: 'KlipAI — parola sıfırlama',
      body: (link) =>
        `Merhaba,\n\nParolanızı sıfırlamak için bağlantıya dokunun:\n${link}\n\nBağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız parolanız değişmeyecektir.`,
    },
    en: {
      subject: 'KlipAI — password reset',
      body: (link) =>
        `Hello,\n\nTap the link to reset your password:\n${link}\n\nThe link is valid for 1 hour. If you did not request this, your password stays unchanged.`,
    },
  },
};

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport?: Transporter;

  constructor(private readonly config: AppConfig) {
    if (config.smtpUrl) this.transport = createTransport(config.smtpUrl);
  }

  link(path: 'verify-email' | 'reset-password', token: string): string {
    return `${this.config.appUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  async send(to: string, template: Template, locale: AppLocale, link: string): Promise<void> {
    const text = TEXTS[template][locale];
    if (!this.transport) {
      // SMTP tanımlı değilse (geliştirme) bağlantı log'a yazılır.
      this.logger.warn({ to, template, link }, 'SMTP_URL tanımlı değil; e-posta gönderilmedi');
      return;
    }
    try {
      await this.transport.sendMail({
        from: this.config.mailFrom,
        to,
        subject: text.subject,
        text: text.body(link),
      });
    } catch (error) {
      // E-posta hatası isteği başarısız kılmaz; kullanıcı yeniden isteyebilir.
      this.logger.error({ to, template, err: error }, 'E-posta gönderilemedi');
    }
  }
}
