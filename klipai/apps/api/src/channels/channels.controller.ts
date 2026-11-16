import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ChannelSettingsPatch, settingsPatchSchema } from '@klipai/shared';
import { AuthUser, CurrentUser, Public, Zod } from '../common/http';
import { SchedulerService } from '../publishing/scheduler.service';
import { ChannelsService } from './channels.service';

const inviteSchema = z.object({ email: z.string().email().transform((v) => v.trim().toLowerCase()), role: z.enum(['EDITOR', 'VIEWER']) });
const roleSchema = z.object({ role: z.enum(['EDITOR', 'VIEWER']) });

@Controller()
export class ChannelsController {
  constructor(private readonly channels: ChannelsService, private readonly scheduler: SchedulerService) {}

  @Get('channels')
  list(@CurrentUser() u: AuthUser) {
    return this.channels.list(u.id);
  }

  @Post('channels/youtube/oauth/start')
  @HttpCode(200)
  start(@CurrentUser() u: AuthUser) {
    return this.channels.startOAuth(u.id);
  }

  @Public()
  @Get('channels/youtube/oauth/callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    res.redirect(302, await this.channels.completeOAuth(code, state, error));
  }

  @Get('channels/:id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const { channel, role } = await this.channels.access(u.id, id);
    return this.channels.view(channel, role);
  }

  @Delete('channels/:id')
  @HttpCode(204)
  disconnect(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.channels.disconnect(u.id, id);
  }

  @Get('channels/:id/settings')
  async settings(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.channels.access(u.id, id);
    return this.channels.getSettings(id);
  }

  @Patch('channels/:id/settings')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(settingsPatchSchema)) patch: ChannelSettingsPatch) {
    return this.channels.updateSettings(u.id, id, patch);
  }

  @Get('channels/:id/quota')
  async quota(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.channels.access(u.id, id);
    return this.scheduler.quota(id);
  }

  @Get('channels/:id/best-times')
  async bestTimes(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.channels.access(u.id, id);
    return { items: await this.scheduler.bestTimes(id) };
  }

  @Get('channels/:id/members')
  members(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.channels.listMembers(u.id, id);
  }

  @Post('channels/:id/members')
  invite(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(inviteSchema)) dto: z.infer<typeof inviteSchema>) {
    return this.channels.invite(u.id, id, dto.email, dto.role);
  }

  @Patch('channels/:id/members/:memberId')
  updateMember(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('memberId') memberId: string, @Body(new Zod(roleSchema)) dto: z.infer<typeof roleSchema>) {
    return this.channels.updateMember(u.id, id, memberId, dto.role);
  }

  @Delete('channels/:id/members/:memberId')
  @HttpCode(204)
  removeMember(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.channels.removeMember(u.id, id, memberId);
  }

  @Post('invites/:token/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('token') token: string) {
    return this.channels.acceptInvite(u.id, token);
  }
}
