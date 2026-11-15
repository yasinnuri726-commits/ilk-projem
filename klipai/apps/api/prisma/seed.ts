// Yol: klipai/apps/api/prisma/seed.ts
//
// Yerleşik (sistem) şablonlar. Sabit kimliklerle upsert edildiği için
// defalarca çalıştırılabilir:  pnpm --filter @klipai/api db:seed
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_SETTINGS } from '@klipai/shared';
import { PrismaClient, type TemplateKind } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const id = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const TEMPLATES: { id: string; kind: TemplateKind; name: string; config: object }[] = [
  {
    id: id(1),
    kind: 'SUBTITLE',
    name: 'Vurgulu Sarı',
    config: { ...DEFAULT_SETTINGS.subtitle },
  },
  {
    id: id(2),
    kind: 'SUBTITLE',
    name: 'Karaoke Yeşil',
    config: {
      ...DEFAULT_SETTINGS.subtitle,
      animation: 'KARAOKE',
      highlightColor: '#39FF14',
      fontFamily: 'Poppins-Black',
      maxWordsPerLine: 4,
    },
  },
  {
    id: id(3),
    kind: 'SUBTITLE',
    name: 'Sade Beyaz',
    config: {
      ...DEFAULT_SETTINGS.subtitle,
      animation: 'NONE',
      highlightColor: '#FFFFFF',
      fontFamily: 'Inter-Bold',
      fontSize: 56,
      uppercase: false,
      maxWordsPerLine: 6,
    },
  },
  {
    id: id(4),
    kind: 'SUBTITLE',
    name: 'Daktilo Üstte',
    config: {
      ...DEFAULT_SETTINGS.subtitle,
      animation: 'TYPEWRITER',
      position: 'TOP',
      highlightColor: '#00E5FF',
      fontFamily: 'JetBrainsMono-Bold',
      fontSize: 60,
    },
  },
  {
    id: id(10),
    kind: 'COMMENTARY',
    name: 'Komik Tepki',
    config: { ...DEFAULT_SETTINGS.commentary, format: 'REACTION', tone: 'FUNNY', length: 'SHORT' },
  },
  {
    id: id(11),
    kind: 'COMMENTARY',
    name: 'Ciddi Analiz',
    config: { ...DEFAULT_SETTINGS.commentary, format: 'ANALYSIS', tone: 'SERIOUS', length: 'MEDIUM' },
  },
  {
    id: id(12),
    kind: 'COMMENTARY',
    name: 'Bilgilendirici Sıralama',
    config: { ...DEFAULT_SETTINGS.commentary, format: 'RANKING', tone: 'INFORMATIVE', length: 'MEDIUM' },
  },
];

async function main(): Promise<void> {
  for (const template of TEMPLATES) {
    const data = { kind: template.kind, name: template.name, config: template.config, isSystem: true };
    await prisma.template.upsert({ where: { id: template.id }, create: { id: template.id, ...data }, update: data });
  }
  // eslint-disable-next-line no-console
  console.log(`${TEMPLATES.length} sistem şablonu yazıldı`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
