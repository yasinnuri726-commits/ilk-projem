// Yol: klipai/apps/api/src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleVerifier } from './google.verifier';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, GoogleVerifier],
  exports: [TokenService],
})
export class AuthModule {}
