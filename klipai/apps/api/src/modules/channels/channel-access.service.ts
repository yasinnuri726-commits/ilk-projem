// Yol: klipai/apps/api/src/modules/channels/channel-access.service.ts
import { Injectable } from '@nestjs/common';
import {
  can,
  type ChannelSettings,
  type MemberRole,
  normalizeSettings,
  type Permission,
} from '@klipai/shared';
import { AppException } from '../../common/app-exception';
import type { Channel } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';

export interface ChannelAccess {
  channel: Channel;
  role: MemberRole;
}

/** Kanal kaynaklarına erişimin tek denetim noktası: üyelik + rol yetkisi. */
@Injectable()
export class ChannelAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Üye değilse kanalın varlığı sızdırılmaz (404); üye ama yetkisizse 403.
   */
  async require(userId: string, channelId: string, permission: Permission): Promise<ChannelAccess> {
    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
      include: { channel: true },
    });
    if (!member || member.channel.status === 'DISCONNECTED') throw new AppException('NOT_FOUND');
    if (!can(member.role, permission)) throw new AppException('FORBIDDEN');
    return { channel: member.channel, role: member.role };
  }

  async channelIdsFor(userId: string): Promise<string[]> {
    const rows = await this.prisma.channelMember.findMany({
      where: { userId, channel: { status: { not: 'DISCONNECTED' } } },
      select: { channelId: true },
    });
    return rows.map((r) => r.channelId);
  }

  /** Kanal profili; satır yoksa varsayılanlar. */
  async settingsFor(channelId: string): Promise<ChannelSettings> {
    const row = await this.prisma.settings.findUnique({ where: { channelId } });
    if (!row) return normalizeSettings({});
    const { channelId: _c, version: _v, updatedAt: _u, ...values } = row;
    return normalizeSettings(values);
  }
}
