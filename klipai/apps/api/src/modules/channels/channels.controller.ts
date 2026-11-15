// Yol: klipai/apps/api/src/modules/channels/channels.controller.ts
//
// Bu aşamada yalnızca okuma uçları vardır; YouTube OAuth ile kanal bağlama,
// kota, ekip ve ayar uçları 4. aşamada eklenir.
import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/request-context';
import { UuidPipe } from '../../common/zod.pipe';
import type { Channel } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { ChannelAccessService } from './channel-access.service';

function toChannelDto(channel: Channel, role: string): Record<string, unknown> {
  return {
    id: channel.id,
    youtubeChannelId: channel.youtubeChannelId,
    title: channel.title,
    handle: channel.handle,
    thumbnailUrl: channel.thumbnailUrl,
    status: channel.status,
    role,
    createdAt: channel.createdAt.toISOString(),
  };
}

@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChannelAccessService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<{ items: unknown[] }> {
    const members = await this.prisma.channelMember.findMany({
      where: { userId: user.id, channel: { status: { not: 'DISCONNECTED' } } },
      include: { channel: true },
      orderBy: { createdAt: 'asc' },
    });
    return { items: members.map((m) => toChannelDto(m.channel, m.role)) };
  }

  @Get(':channelId')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('channelId', UuidPipe) channelId: string,
  ): Promise<unknown> {
    const { channel, role } = await this.access.require(user.id, channelId, 'channel.read');
    return toChannelDto(channel, role);
  }
}
