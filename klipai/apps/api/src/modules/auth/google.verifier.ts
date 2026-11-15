// Yol: klipai/apps/api/src/modules/auth/google.verifier.ts
import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppException } from '../../common/app-exception';
import { AppConfig } from '../../config/app-config';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** Google Sign-In ID token'ını imza, süre ve hedef kitle (aud) açısından doğrular. */
@Injectable()
export class GoogleVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: AppConfig) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (this.config.googleClientIds.length === 0) {
      throw new AppException('GOOGLE_TOKEN_INVALID', 'Google ile giriş yapılandırılmamış');
    }
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.googleClientIds,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) throw new Error('eksik alan');
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: payload.name,
        picture: payload.picture,
      };
    } catch {
      throw new AppException('GOOGLE_TOKEN_INVALID');
    }
  }
}
