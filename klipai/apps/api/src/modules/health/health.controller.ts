// Yol: klipai/apps/api/src/modules/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health(): Promise<{ status: 'ok' | 'degraded'; version: string; checks: Record<string, string> }> {
    const check = async (run: () => Promise<unknown>): Promise<string> => {
      try {
        await run();
        return 'ok';
      } catch {
        return 'fail';
      }
    };
    const checks = {
      database: await check(() => this.prisma.$queryRaw`SELECT 1`),
      redis: await check(() => this.redis.client.ping()),
    };
    return {
      status: Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded',
      version: process.env.APP_VERSION ?? 'dev',
      checks,
    };
  }
}
