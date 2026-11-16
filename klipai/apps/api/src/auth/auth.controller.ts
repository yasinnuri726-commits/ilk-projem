import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, Zod } from '../common/http';
import { AuthService, forgotSchema, googleSchema, loginSchema, refreshSchema, registerSchema, resetSchema } from './auth.service';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const AUTH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Public()
@Throttle(AUTH_LIMIT)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body(new Zod(registerSchema)) dto: z.infer<typeof registerSchema>, @Req() req: Request) {
    return this.auth.register(dto, meta(req));
  }

  @Post('login')
  @HttpCode(200)
  login(@Body(new Zod(loginSchema)) dto: z.infer<typeof loginSchema>, @Req() req: Request) {
    return this.auth.login(dto, meta(req));
  }

  @Post('google')
  @HttpCode(200)
  google(@Body(new Zod(googleSchema)) dto: z.infer<typeof googleSchema>, @Req() req: Request) {
    return this.auth.loginWithGoogle(dto.idToken, meta(req));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new Zod(refreshSchema)) dto: z.infer<typeof refreshSchema>, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, meta(req));
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body(new Zod(refreshSchema)) dto: z.infer<typeof refreshSchema>) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('password/forgot')
  @HttpCode(204)
  forgot(@Body(new Zod(forgotSchema)) dto: z.infer<typeof forgotSchema>) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('password/reset')
  @HttpCode(204)
  reset(@Body(new Zod(resetSchema)) dto: z.infer<typeof resetSchema>) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('email/verify')
  @HttpCode(204)
  verify(@Body(new Zod(z.object({ token: z.string().min(10) }))) dto: { token: string }) {
    return this.auth.verifyEmail(dto.token);
  }
}
