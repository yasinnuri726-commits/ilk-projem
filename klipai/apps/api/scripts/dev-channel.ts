// Yol: klipai/apps/api/scripts/dev-channel.ts
//
// YALNIZCA GELİŞTİRME. YouTube bağlama (4. aşama) gelene kadar proje
// oluşturmayı deneyebilmek için kullanıcıya bağlı olmayan sahte bir kanal açar.
// Kullanım:  pnpm --filter @klipai/api dev:channel kullanici@ornek.com
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Üretimde çalıştırılamaz');
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error('Kullanım: dev:channel <e-posta>');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`Kullanıcı bulunamadı: ${email} (önce /v1/auth/register ile kayıt olun)`);
    const channel = await prisma.channel.create({
      data: {
        ownerId: user.id,
        youtubeChannelId: `dev-${randomUUID()}`,
        title: 'Geliştirme Kanalı',
        quotaResetAt: new Date(Date.now() + 86_400_000),
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Kanal oluşturuldu: ${channel.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error((error as Error).message);
  process.exit(1);
});
