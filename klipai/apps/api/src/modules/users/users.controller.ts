// Yol: klipai/apps/api/src/modules/users/users.controller.ts
//
// Profil ve push cihaz kaydı. KVKK/GDPR veri talepleri (/me/data-requests)
// bildirim altyapısıyla birlikte 6. aşamada eklenir.
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/request-context';
import { UuidPipe, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { DeviceSchema, UpdateMeSchema } from '../auth/auth.schemas';
import { toUserDto, type UserDto } from '../auth/auth.service';

@Controller('me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() auth: AuthUser): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw new AppException('UNAUTHORIZED');
    return toUserDto(user);
  }

  @Patch()
  async update(
    @CurrentUser() auth: AuthUser,
    @Body(new ZodPipe(UpdateMeSchema)) body: z.infer<typeof UpdateMeSchema>,
  ): Promise<UserDto> {
    return toUserDto(await this.prisma.user.update({ where: { id: auth.id }, data: body }));
  }

  /** Push token kaydı. Token başka bir hesaba kayıtlıysa bu hesaba taşınır (cihaz el değiştirmiş). */
  @Post('devices')
  @HttpCode(200)
  async registerDevice(
    @CurrentUser() auth: AuthUser,
    @Body(new ZodPipe(DeviceSchema)) body: z.infer<typeof DeviceSchema>,
  ): Promise<{ id: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    const device = await this.prisma.device.upsert({
      where: { pushToken: body.pushToken },
      update: {
        userId: auth.id,
        platform: body.platform,
        appVersion: body.appVersion,
        locale: user.locale,
        lastSeenAt: new Date(),
      },
      create: { userId: auth.id, ...body, locale: user.locale },
    });
    return { id: device.id };
  }

  @Delete('devices/:deviceId')
  @HttpCode(204)
  async unregisterDevice(
    @CurrentUser() auth: AuthUser,
    @Param('deviceId', UuidPipe) deviceId: string,
  ): Promise<void> {
    await this.prisma.device.deleteMany({ where: { id: deviceId, userId: auth.id } });
  }
}
