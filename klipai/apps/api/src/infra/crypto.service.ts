// Yol: klipai/apps/api/src/infra/crypto.service.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

export interface Sealed {
  data: Buffer;
  keyVersion: number;
}

/**
 * OAuth token'ları gibi sırların veritabanında şifreli saklanması.
 * AES-256-GCM; biçim: iv(12) | etiket(16) | şifreli metin. Anahtarlar sürümlüdür:
 * yeni kayıtlar en büyük sürümle şifrelenir, eski sürümler çözülmeye devam eder.
 * `aad` (ör. kanal kimliği) şifreli değerin başka bir satıra taşınmasını engeller.
 */
@Injectable()
export class CryptoService {
  private readonly keys = new Map<number, Buffer>();
  private readonly current: number;

  constructor(config: AppConfig) {
    for (const entry of config.tokenEncKeys.split(',')) {
      const [version, encoded] = entry.trim().split(':');
      const key = Buffer.from(encoded ?? '', 'base64');
      const number = Number(version);
      if (!Number.isInteger(number) || number < 1 || key.length !== 32) {
        throw new Error('TOKEN_ENC_KEYS geçersiz: "sürüm:base64(32 bayt)" bekleniyor');
      }
      this.keys.set(number, key);
    }
    this.current = Math.max(...this.keys.keys());
  }

  seal(plaintext: string, aad: string): Sealed {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { data: Buffer.concat([iv, cipher.getAuthTag(), body]), keyVersion: this.current };
  }

  open(sealed: Sealed, aad: string): string {
    const key = this.keys.get(sealed.keyVersion);
    if (!key) throw new Error(`Şifreleme anahtarı sürümü bulunamadı: ${sealed.keyVersion}`);
    const data = Buffer.from(sealed.data);
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }

  /** Kayıt güncel anahtarla mı şifreli? Değilse yeniden şifrelenmelidir. */
  isCurrent(keyVersion: number): boolean {
    return keyVersion === this.current;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Tahmin edilemez, URL'de güvenle taşınabilen belirteç. */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
