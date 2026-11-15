// Yol: klipai/apps/api/src/modules/auth/auth.controller.ts
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, Public, RateLimit } from '../../common/decorators';
import type { AuthUser } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import {
  ForgotSchema,
  GoogleSchema,
  LoginSchema,
  LogoutSchema,
  RefreshSchema,
  RegisterSchema,
  ResetSchema,
  TokenSchema,
} from './auth.schemas';
import { type AuthSession, AuthService } from './auth.service';
import type { ClientInfo } from './token.service';

function clientOf(req: Request): ClientInfo {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

// Kimlik uçları IP başına dakikada 10 istekle sınırlıdır (parola deneme koruması).
const AUTH_LIMIT = { name: 'auth', limit: 10, windowSec: 60, by: 'ip' } as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit(AUTH_LIMIT)
  @Post('register')
  register(
    @Body(new ZodPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.auth.register(body, clientOf(req));
  }

  @Public()
  @RateLimit(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.auth.login(body.email, body.password, clientOf(req));
  }

  @Public()
  @RateLimit(AUTH_LIMIT)
  @Post('google')
  @HttpCode(200)
  google(
    @Body(new ZodPipe(GoogleSchema)) body: z.infer<typeof GoogleSchema>,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.auth.loginWithGoogle(body.idToken, clientOf(req));
  }

  @Public()
  @RateLimit({ name: 'auth-refresh', limit: 60, windowSec: 60, by: 'ip' })
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.auth.refresh(body.refreshToken, clientOf(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(LogoutSchema)) body: z.infer<typeof LogoutSchema>,
  ): Promise<void> {
    await this.auth.logout(user.id, body.refreshToken, body.allDevices);
  }

  @Public()
  @RateLimit(AUTH_LIMIT)
  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(@Body(new ZodPipe(TokenSchema)) body: z.infer<typeof TokenSchema>): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  @Public()
  @RateLimit({ name: 'auth-forgot', limit: 5, windowSec: 300, by: 'ip' })
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body(new ZodPipe(ForgotSchema)) body: z.infer<typeof ForgotSchema>): Promise<void> {
    await this.auth.forgotPassword(body.email);
  }

  @Public()
  @RateLimit(AUTH_LIMIT)
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body(new ZodPipe(ResetSchema)) body: z.infer<typeof ResetSchema>): Promise<void> {
    await this.auth.resetPassword(body.token, body.password);
  }
}
