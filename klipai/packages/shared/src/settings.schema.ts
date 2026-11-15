// Yol: klipai/packages/shared/src/settings.schema.ts
//
// Kanal profili (Settings) şemaları. openapi.yaml'daki şemalarla birebir aynıdır.
// Saklanan değer her zaman tam nesnedir: DEFAULT_SETTINGS + kullanıcı değişiklikleri.

import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const AUTOMATION_MODES = ['FULL_AUTO', 'APPROVAL', 'DRAFT_ONLY'] as const;
export const ASPECT_RATIOS = ['PORTRAIT_9_16', 'SQUARE_1_1', 'LANDSCAPE_16_9'] as const;
export const RESOLUTIONS = ['HD_720', 'FHD_1080', 'UHD_4K'] as const;
export const COMMENTARY_FORMATS = ['NONE', 'REACTION', 'ANALYSIS', 'RANKING'] as const;
export const PRIVACY_STATUSES = ['PUBLIC', 'UNLISTED', 'PRIVATE'] as const;

export const PublishWindowSchema = z.strictObject({ start: localTime, end: localTime });

export const SubtitleSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  templateId: z.uuid().nullable(),
  fontFamily: z.string().min(1).max(80),
  fontSize: z.number().int().min(24).max(160),
  color: hex,
  highlightColor: hex,
  strokeColor: hex,
  position: z.enum(['TOP', 'MIDDLE', 'BOTTOM']),
  animation: z.enum(['WORD_POP', 'KARAOKE', 'TYPEWRITER', 'NONE']),
  maxWordsPerLine: z.number().int().min(1).max(8),
  uppercase: z.boolean(),
  language: z.string().min(2).max(10),
});

export const CommentarySettingsSchema = z.strictObject({
  format: z.enum(COMMENTARY_FORMATS),
  tone: z.enum(['FUNNY', 'SERIOUS', 'INFORMATIVE']),
  customPrompt: z.string().max(1000),
  length: z.enum(['SHORT', 'MEDIUM', 'LONG']),
  language: z.string().min(2).max(10),
});

export const AudioSettingsSchema = z.strictObject({
  ttsVoiceId: z.string().max(80),
  ttsSpeed: z.number().min(0.7).max(1.4),
  musicGenre: z.enum(['NONE', 'UPBEAT', 'CINEMATIC', 'LOFI', 'DRAMATIC', 'COMEDY']),
  musicLevelDb: z.number().min(-40).max(-6),
  ducking: z.boolean(),
});

export const BrandSettingsSchema = z.strictObject({
  logoKey: z.string().max(300).nullable(),
  watermarkPosition: z.enum(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'NONE']),
  watermarkOpacity: z.number().min(0.1).max(1),
  introKey: z.string().max(300).nullable(),
  outroKey: z.string().max(300).nullable(),
  palette: z.array(hex).max(5),
});

export const MetadataSettingsSchema = z.strictObject({
  titleLanguage: z.string().min(2).max(10),
  fixedTags: z.array(z.string().min(1).max(50)).max(30),
  descriptionTemplate: z.string().max(3000),
  categoryId: z.string().max(4),
  madeForKids: z.boolean(),
});

export const ChannelSettingsSchema = z
  .strictObject({
    automationMode: z.enum(AUTOMATION_MODES),
    dailyClipCount: z.number().int().min(1).max(24),
    timezone: z.string().min(1).max(64),
    publishWindows: z.array(PublishWindowSchema).min(1).max(6),
    useBestTime: z.boolean(),
    defaultPrivacy: z.enum(PRIVACY_STATUSES),
    minDurationSec: z.number().int().min(15).max(90),
    maxDurationSec: z.number().int().min(15).max(90),
    minScore: z.number().int().min(0).max(100),
    maxClipsPerVideo: z.number().int().min(1).max(30),
    aspectRatio: z.enum(ASPECT_RATIOS),
    resolution: z.enum(RESOLUTIONS),
    subtitle: SubtitleSettingsSchema,
    commentary: CommentarySettingsSchema,
    audio: AudioSettingsSchema,
    brand: BrandSettingsSchema,
    metadata: MetadataSettingsSchema,
  })
  .refine((s) => s.minDurationSec <= s.maxDurationSec, {
    path: ['minDurationSec'],
    message: 'minDurationSec, maxDurationSec değerinden büyük olamaz',
  });
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

/** PATCH gövdesi: her alan ve grup içindeki her alan isteğe bağlı. */
export const SettingsPatchSchema = z.strictObject({
  automationMode: z.enum(AUTOMATION_MODES).optional(),
  dailyClipCount: z.number().int().min(1).max(24).optional(),
  timezone: z.string().min(1).max(64).optional(),
  publishWindows: z.array(PublishWindowSchema).min(1).max(6).optional(),
  useBestTime: z.boolean().optional(),
  defaultPrivacy: z.enum(PRIVACY_STATUSES).optional(),
  minDurationSec: z.number().int().min(15).max(90).optional(),
  maxDurationSec: z.number().int().min(15).max(90).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  maxClipsPerVideo: z.number().int().min(1).max(30).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  resolution: z.enum(RESOLUTIONS).optional(),
  subtitle: SubtitleSettingsSchema.partial().optional(),
  commentary: CommentarySettingsSchema.partial().optional(),
  audio: AudioSettingsSchema.partial().optional(),
  brand: BrandSettingsSchema.partial().optional(),
  metadata: MetadataSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: ChannelSettings = {
  automationMode: 'APPROVAL',
  dailyClipCount: 3,
  timezone: 'Europe/Istanbul',
  publishWindows: [
    { start: '12:00', end: '14:00' },
    { start: '19:00', end: '22:00' },
  ],
  useBestTime: true,
  defaultPrivacy: 'PUBLIC',
  minDurationSec: 20,
  maxDurationSec: 60,
  minScore: 70,
  maxClipsPerVideo: 8,
  aspectRatio: 'PORTRAIT_9_16',
  resolution: 'FHD_1080',
  subtitle: {
    enabled: true,
    templateId: null,
    fontFamily: 'Montserrat-ExtraBold',
    fontSize: 72,
    color: '#FFFFFF',
    highlightColor: '#FFE500',
    strokeColor: '#000000',
    position: 'BOTTOM',
    animation: 'WORD_POP',
    maxWordsPerLine: 3,
    uppercase: true,
    language: 'source',
  },
  commentary: {
    format: 'NONE',
    tone: 'INFORMATIVE',
    customPrompt: '',
    length: 'SHORT',
    language: 'tr',
  },
  audio: {
    ttsVoiceId: '',
    ttsSpeed: 1,
    musicGenre: 'NONE',
    musicLevelDb: -22,
    ducking: true,
  },
  brand: {
    logoKey: null,
    watermarkPosition: 'NONE',
    watermarkOpacity: 0.7,
    introKey: null,
    outroKey: null,
    palette: [],
  },
  metadata: {
    titleLanguage: 'tr',
    fixedTags: [],
    descriptionTemplate: '{{description}}\n\n{{hashtags}}',
    categoryId: '24',
    madeForKids: false,
  },
};

const GROUPS = ['subtitle', 'commentary', 'audio', 'brand', 'metadata'] as const;

/** Yamayı tam ayar nesnesine uygular (gruplar bir düzey derin birleştirilir) ve doğrular. */
export function applySettingsPatch(base: ChannelSettings, patch: SettingsPatch): ChannelSettings {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((GROUPS as readonly string[]).includes(key)) {
      merged[key] = { ...(base[key as (typeof GROUPS)[number]] as object), ...(value as object) };
    } else {
      merged[key] = value;
    }
  }
  return ChannelSettingsSchema.parse(merged);
}

/** Veritabanındaki (eski sürümlerde eksik alanlı olabilen) değeri tam nesneye tamamlar. */
export function normalizeSettings(stored: unknown): ChannelSettings {
  const patch = SettingsPatchSchema.safeParse(stored ?? {});
  return applySettingsPatch(DEFAULT_SETTINGS, patch.success ? patch.data : {});
}
