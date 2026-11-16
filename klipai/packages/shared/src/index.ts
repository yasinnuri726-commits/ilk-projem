import { z } from 'zod';

// ───────────── Enum'lar (Prisma ile birebir) ─────────────
export const LOCALES = ['TR', 'EN'] as const;
export const USER_ROLES = ['USER', 'DEVELOPER'] as const;
export const CHANNEL_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export const AUTOMATION_MODES = ['FULL_AUTO', 'APPROVAL', 'DRAFT_ONLY'] as const;
export const ASPECT_RATIOS = ['PORTRAIT_9_16', 'SQUARE_1_1', 'LANDSCAPE_16_9'] as const;
export const RESOLUTIONS = ['HD_720', 'FHD_1080', 'UHD_4K'] as const;
export const COMMENTARY_TONES = ['FUNNY', 'SERIOUS', 'INFORMATIVE'] as const;
export const COMMENTARY_FORMATS = ['NONE', 'REACTION', 'ANALYSIS', 'RANKING'] as const;
export const RIGHTS_BASES = ['OWN_CONTENT', 'LICENSED', 'PUBLIC_DOMAIN', 'PERMITTED'] as const;
export const PROJECT_STATUSES = ['DRAFT', 'INGESTING', 'ANALYZING', 'GENERATING', 'SCORING', 'READY', 'FAILED', 'CANCELED', 'ARCHIVED'] as const;
export const CLIP_STATUSES = ['CANDIDATE', 'EDITING', 'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'ARCHIVED'] as const;
export const QC_STATUSES = ['PENDING', 'PASSED', 'AUTO_FIXED', 'FLAGGED'] as const;
export const PIPELINE_STAGES = ['INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE', 'EDIT', 'COMMENTARY', 'METADATA', 'QC', 'PUBLISH', 'LEARN'] as const;
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const;
export const PUBLISH_STATUSES = ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'UPLOADING', 'RETRY_WAIT', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELED'] as const;
export const YOUTUBE_PRIVACIES = ['PUBLIC', 'UNLISTED', 'PRIVATE'] as const;
export const TEMPLATE_KINDS = ['SUBTITLE', 'BRAND', 'COMMENTARY', 'METADATA'] as const;
export const PLANS = ['FREE', 'PRO', 'AGENCY'] as const;
export const SUBTITLE_POSITIONS = ['TOP', 'MIDDLE', 'BOTTOM'] as const;

export type Locale = (typeof LOCALES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type ChannelRole = (typeof CHANNEL_ROLES)[number];
export type AutomationMode = (typeof AUTOMATION_MODES)[number];
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type Resolution = (typeof RESOLUTIONS)[number];
export type CommentaryTone = (typeof COMMENTARY_TONES)[number];
export type CommentaryFormat = (typeof COMMENTARY_FORMATS)[number];
export type RightsBasis = (typeof RIGHTS_BASES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ClipStatus = (typeof CLIP_STATUSES)[number];
export type QcStatus = (typeof QC_STATUSES)[number];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];
export type YoutubePrivacy = (typeof YOUTUBE_PRIVACIES)[number];
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type Plan = (typeof PLANS)[number];

// ───────────── Plan sınırları ─────────────
export interface PlanLimits {
  clipsPerMonth: number | null; // null = sınırsız
  creditsPerMonth: number | null; // işlenen kaynak dakikası; null = sınırsız
  maxResolution: Resolution;
  maxChannels: number | null;
  watermark: boolean;
  teamAccess: boolean;
  queuePriority: number; // 1 = en yüksek
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { clipsPerMonth: 5, creditsPerMonth: 60, maxResolution: 'HD_720', maxChannels: 1, watermark: true, teamAccess: false, queuePriority: 5 },
  PRO: { clipsPerMonth: 150, creditsPerMonth: 1800, maxResolution: 'FHD_1080', maxChannels: 1, watermark: false, teamAccess: false, queuePriority: 3 },
  AGENCY: { clipsPerMonth: null, creditsPerMonth: 12000, maxResolution: 'UHD_4K', maxChannels: 10, watermark: false, teamAccess: true, queuePriority: 1 },
};

/** Geliştirici hesabı: hiçbir sınır yok, ücretsiz. */
export const DEVELOPER_LIMITS: PlanLimits = {
  clipsPerMonth: null, creditsPerMonth: null, maxResolution: 'UHD_4K', maxChannels: null, watermark: false, teamAccess: true, queuePriority: 1,
};

export function limitsFor(plan: Plan, role: UserRole): PlanLimits {
  return role === 'DEVELOPER' ? DEVELOPER_LIMITS : PLAN_LIMITS[plan];
}

const RES_ORDER: Resolution[] = ['HD_720', 'FHD_1080', 'UHD_4K'];
export function clampResolution(wanted: Resolution, max: Resolution): Resolution {
  return RES_ORDER.indexOf(wanted) > RES_ORDER.indexOf(max) ? max : wanted;
}

export function outputSize(aspect: AspectRatio, res: Resolution): { width: number; height: number } {
  const short = res === 'HD_720' ? 720 : res === 'FHD_1080' ? 1080 : 2160;
  const long = Math.round((short * 16) / 9);
  if (aspect === 'PORTRAIT_9_16') return { width: short, height: long };
  if (aspect === 'LANDSCAPE_16_9') return { width: long, height: short };
  return { width: short, height: short };
}

/** Puan ağırlıkları: kanca %30, duygu %25, anlaşılırlık %20, merak %15, paylaşılabilirlik %10. */
export const SCORE_WEIGHTS = { hook: 0.3, emotion: 0.25, standalone: 0.2, curiosity: 0.15, shareability: 0.1 } as const;
export function weightedScore(b: Record<keyof typeof SCORE_WEIGHTS, number>): number {
  const total = (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).reduce((s, k) => s + b[k] * SCORE_WEIGHTS[k], 0);
  return Math.max(0, Math.min(100, Math.round(total)));
}

// ───────────── Ayarlar (kanal profili) ─────────────
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const subtitleSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  templateId: z.string().nullable().default(null),
  fontFamily: z.string().max(60).default('Montserrat'),
  fontSize: z.number().int().min(24).max(160).default(72),
  color: hex.default('#FFFFFF'),
  highlightColor: hex.default('#FFD400'),
  position: z.enum(SUBTITLE_POSITIONS).default('BOTTOM'),
  language: z.string().max(8).default('auto'),
  translateTo: z.string().max(8).nullable().default(null),
});
export const audioSettingsSchema = z.object({
  ttsVoice: z.string().max(80).default('default'),
  ttsSpeed: z.number().min(0.7).max(1.4).default(1),
  musicGenre: z.string().max(40).default('none'),
  musicLevelDb: z.number().min(-40).max(0).default(-22),
});
export const brandSettingsSchema = z.object({
  logoKey: z.string().nullable().default(null),
  watermarkKey: z.string().nullable().default(null),
  introKey: z.string().nullable().default(null),
  outroKey: z.string().nullable().default(null),
  palette: z.array(hex).max(5).default([]),
});

export const settingsSchema = z.object({
  automationMode: z.enum(AUTOMATION_MODES),
  dailyClipCount: z.number().int().min(0).max(50),
  timeSlots: z.array(z.object({ start: hhmm, end: hhmm })).max(12),
  timezone: z.string().min(1).max(64),
  useBestTimes: z.boolean(),
  minDurationSec: z.number().int().min(15).max(90),
  maxDurationSec: z.number().int().min(15).max(90),
  minScore: z.number().int().min(0).max(100),
  maxClipsPerVideo: z.number().int().min(1).max(30),
  aspectRatio: z.enum(ASPECT_RATIOS),
  resolution: z.enum(RESOLUTIONS),
  subtitle: subtitleSettingsSchema,
  commentaryFormat: z.enum(COMMENTARY_FORMATS),
  commentaryTone: z.enum(COMMENTARY_TONES),
  commentaryPrompt: z.string().max(1000).nullable(),
  commentaryMaxSec: z.number().int().min(3).max(45),
  audio: audioSettingsSchema,
  brand: brandSettingsSchema,
  titleLanguage: z.enum(LOCALES),
  fixedTags: z.array(z.string().max(40)).max(20),
  descriptionTemplate: z.string().max(4000).nullable(),
  youtubeCategoryId: z.string().max(4),
  defaultPrivacy: z.enum(YOUTUBE_PRIVACIES),
  madeForKids: z.boolean(),
});
export type ChannelSettings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial().refine(
  (s) => s.minDurationSec === undefined || s.maxDurationSec === undefined || s.minDurationSec <= s.maxDurationSec,
  { message: 'minDurationSec, maxDurationSec değerinden büyük olamaz', path: ['minDurationSec'] },
);
export type ChannelSettingsPatch = z.infer<typeof settingsPatchSchema>;

export const DEFAULT_SETTINGS: ChannelSettings = {
  automationMode: 'APPROVAL',
  dailyClipCount: 2,
  timeSlots: [{ start: '12:00', end: '14:00' }, { start: '19:00', end: '22:00' }],
  timezone: 'Europe/Istanbul',
  useBestTimes: true,
  minDurationSec: 20,
  maxDurationSec: 60,
  minScore: 70,
  maxClipsPerVideo: 8,
  aspectRatio: 'PORTRAIT_9_16',
  resolution: 'FHD_1080',
  subtitle: subtitleSettingsSchema.parse({}),
  commentaryFormat: 'NONE',
  commentaryTone: 'INFORMATIVE',
  commentaryPrompt: null,
  commentaryMaxSec: 15,
  audio: audioSettingsSchema.parse({}),
  brand: brandSettingsSchema.parse({}),
  titleLanguage: 'TR',
  fixedTags: [],
  descriptionTemplate: null,
  youtubeCategoryId: '24',
  defaultPrivacy: 'PUBLIC',
  madeForKids: false,
};

// ───────────── Kurgu tarifi ─────────────
export const editSpecSchema = z.object({
  crop: z.object({
    mode: z.enum(['AUTO_FACE', 'CENTER', 'MANUAL']).default('AUTO_FACE'),
    keyframes: z.array(z.object({ t: z.number().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(1).max(4) })).max(400).default([]),
  }).default({ mode: 'AUTO_FACE', keyframes: [] }),
  subtitles: z.object({
    enabled: z.boolean().default(true),
    words: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().max(80), highlight: z.boolean().optional() })).max(1500).default([]),
  }).default({ enabled: true, words: [] }),
  hook: z.object({ text: z.string().max(80).default(''), durationSec: z.number().min(0).max(5).default(2) }).default({ text: '', durationSec: 2 }),
  effects: z.array(z.object({
    type: z.enum(['ZOOM_IN', 'ZOOM_OUT', 'FADE']),
    at: z.number().min(0),
    durationSec: z.number().min(0.1).max(10).default(0.6),
    intensity: z.number().min(0).max(1).default(0.12),
  })).max(40).default([]),
  music: z.object({ trackId: z.string().nullable().default(null), levelDb: z.number().min(-40).max(0).default(-22), ducking: z.boolean().default(true) }).default({ trackId: null, levelDb: -22, ducking: true }),
  autoEffects: z.boolean().default(true),
});
export type EditSpec = z.infer<typeof editSpecSchema>;
export const DEFAULT_EDIT_SPEC: EditSpec = editSpecSchema.parse({});

// ───────────── Hata kodları ─────────────
export const ERROR_CODES = [
  'VALIDATION_FAILED', 'UNAUTHENTICATED', 'TOKEN_REUSED', 'FORBIDDEN', 'NOT_FOUND', 'EMAIL_TAKEN', 'INVALID_CREDENTIALS',
  'VERSION_CONFLICT', 'INVALID_STATE', 'CREDITS_EXHAUSTED', 'CLIP_LIMIT_REACHED', 'CHANNEL_LIMIT_REACHED', 'PLAN_REQUIRED',
  'QUOTA_EXCEEDED', 'CHANNEL_TOKEN_EXPIRED', 'UPLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA', 'RATE_LIMITED', 'UPSTREAM_ERROR', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ───────────── WebSocket olayları ─────────────
export interface WsEvents {
  'project.progress': { projectId: string; status: ProjectStatus; stage: PipelineStage | null; stageProgress: number; progress: number };
  'project.ready': { projectId: string; candidateCount: number; topScore: number | null };
  'project.failed': { projectId: string; stage: PipelineStage | null; error: { code: string; message: string } };
  'clip.progress': { clipId: string; projectId: string; stage: PipelineStage; progress: number };
  'clip.updated': { clipId: string; status: ClipStatus; qcStatus: QcStatus; version: number };
  'clip.ready': { clipId: string; needsApproval: boolean };
  'clip.failed': { clipId: string; stage: PipelineStage | null; error: { code: string; message: string } };
  'publish.updated': { publishJobId: string; clipId: string; status: PublishStatus; uploadProgress: number; nextAttemptAt: string | null };
  'publish.published': { publishJobId: string; clipId: string; youtubeVideoId: string; youtubeUrl: string };
  'publish.failed': { publishJobId: string; clipId: string; error: { code: string; message: string } };
  'quota.updated': { channelId: string; used: number; limit: number; resetAt: string };
  'credits.updated': { used: number; granted: number | null; clipsUsed: number };
  'notification.created': { id: string; type: string; params: Record<string, unknown>; deepLink: string | null; createdAt: string };
}
export type WsEventType = keyof WsEvents;
export interface WsEnvelope<T extends WsEventType = WsEventType> { id: string; type: T; ts: string; data: WsEvents[T] }

export const UPLOAD_MAX_BYTES = 20 * 1024 ** 3;
export const UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4'] as const;
export const RIGHTS_ATTESTATION_VERSION = '2026-11';
export const RIGHTS_ATTESTATION: Record<Locale, string> = {
  TR: 'Bu kaynağı kullanma, düzenleme ve yayınlama hakkına sahip olduğumu; içerik bana ait değilse geçerli bir lisansım veya hak sahibinin izni bulunduğunu ya da içeriğin kamu malı olduğunu beyan ederim. Bu beyanın doğruluğundan ve doğabilecek tüm hukuki sonuçlardan ben sorumluyum.',
  EN: 'I declare that I have the right to use, edit and publish this source; if the content is not mine, I hold a valid licence or the rights holder’s permission, or the content is in the public domain. I am responsible for the accuracy of this declaration and any legal consequences.',
};
