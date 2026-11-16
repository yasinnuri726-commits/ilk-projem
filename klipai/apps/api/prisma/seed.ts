/**
 * Sistem şablonlarını ve (ortam değişkenleri verilmişse) geliştirici hesabını oluşturur.
 *
 * Geliştirici hesabı: SEED_DEV_USERNAME + SEED_DEV_PASSWORD (+ isteğe bağlı SEED_DEV_EMAIL).
 * Parola depoya yazılmaz; yalnızca .env dosyasından ya da dağıtım sırlarından okunur.
 * DEVELOPER rolünde kredi, klip, kanal ve çözünürlük sınırı yoktur.
 */
import { PrismaClient, TemplateKind } from '@prisma/client';
import * as argon2 from 'argon2';

const db = new PrismaClient();

const SYSTEM_TEMPLATES: { kind: TemplateKind; name: string; config: object }[] = [
  { kind: 'SUBTITLE', name: 'Vurgu Sarı', config: { fontFamily: 'Montserrat', fontSize: 72, color: '#FFFFFF', highlightColor: '#FFD400', position: 'BOTTOM' } },
  { kind: 'SUBTITLE', name: 'Neon Yeşil', config: { fontFamily: 'Montserrat', fontSize: 76, color: '#FFFFFF', highlightColor: '#39FF14', position: 'MIDDLE' } },
  { kind: 'SUBTITLE', name: 'Sade Beyaz', config: { fontFamily: 'Inter', fontSize: 60, color: '#FFFFFF', highlightColor: '#FFFFFF', position: 'BOTTOM' } },
  { kind: 'SUBTITLE', name: 'Kırmızı Vurgu', config: { fontFamily: 'Montserrat', fontSize: 80, color: '#FFFFFF', highlightColor: '#FF3B30', position: 'BOTTOM' } },
  { kind: 'COMMENTARY', name: 'Tepki — Komik', config: { commentaryFormat: 'REACTION', commentaryTone: 'FUNNY', commentaryMaxSec: 10 } },
  { kind: 'COMMENTARY', name: 'Analiz — Ciddi', config: { commentaryFormat: 'ANALYSIS', commentaryTone: 'SERIOUS', commentaryMaxSec: 20 } },
  { kind: 'COMMENTARY', name: 'Sıralama — Bilgilendirici', config: { commentaryFormat: 'RANKING', commentaryTone: 'INFORMATIVE', commentaryMaxSec: 15 } },
  { kind: 'METADATA', name: 'Shorts Standart', config: { descriptionTemplate: '{description}\n\n{hashtags}\n\n#shorts', youtubeCategoryId: '24' } },
  { kind: 'BRAND', name: 'Markasız', config: { logoKey: null, watermarkKey: null, introKey: null, outroKey: null, palette: [] } },
];

async function main() {
  for (const t of SYSTEM_TEMPLATES) {
    const existing = await db.template.findFirst({ where: { isSystem: true, kind: t.kind, name: t.name } });
    if (existing) await db.template.update({ where: { id: existing.id }, data: { config: t.config } });
    else await db.template.create({ data: { ...t, isSystem: true } });
  }
  console.log(`✓ ${SYSTEM_TEMPLATES.length} sistem şablonu`);

  const username = process.env.SEED_DEV_USERNAME?.trim().toLowerCase();
  const password = process.env.SEED_DEV_PASSWORD;
  if (!username || !password) {
    console.log('• SEED_DEV_USERNAME / SEED_DEV_PASSWORD tanımlı değil; geliştirici hesabı atlandı');
    return;
  }
  const email = (process.env.SEED_DEV_EMAIL ?? `${username}@dev.klipai.local`).toLowerCase();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await db.user.upsert({
    where: { username },
    update: { passwordHash, role: 'DEVELOPER' },
    create: {
      email, username, passwordHash, role: 'DEVELOPER', displayName: process.env.SEED_DEV_USERNAME!.trim(), emailVerifiedAt: new Date(),
      identities: { create: { provider: 'EMAIL', providerUserId: email } },
    },
  });
  await db.subscription.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, plan: 'AGENCY', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
  });
  console.log(`✓ geliştirici hesabı: ${username} (sınırsız)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
