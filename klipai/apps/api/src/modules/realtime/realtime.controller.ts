// Yol: klipai/apps/api/src/modules/realtime/realtime.controller.ts
import { Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/request-context';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /** Erişim token'ı URL'de/log'da görünmesin diye 30 sn geçerli, tek kullanımlık bilet. */
  @Post('ticket')
  @HttpCode(200)
  ticket(@CurrentUser() user: AuthUser): Promise<{ ticket: string; url: string; expiresAt: string }> {
    return this.realtime.createTicket({ userId: user.id, exp: user.exp });
  }
}
