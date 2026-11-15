// Yol: klipai/packages/shared/src/state-machines.ts
//
// Durum makinelerinin tek doğruluk kaynağı. API geçişleri bu tablolarla
// doğrular (geçersiz geçiş → 409 INVALID_STATE); mobil uygulama hangi
// eylem düğmelerinin görüneceğini aynı tablolardan türetir.

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export class InvalidTransitionError<S extends string> extends Error {
  constructor(
    readonly machine: string,
    readonly from: S,
    readonly to: S,
  ) {
    super(`${machine}: ${from} → ${to} geçişi tanımlı değil`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

export function assertTransition<S extends string>(
  machine: string,
  map: TransitionMap<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(map, from, to)) throw new InvalidTransitionError(machine, from, to);
}

export function isTerminal<S extends string>(map: TransitionMap<S>, state: S): boolean {
  return map[state].length === 0;
}

// ───────────── Project ─────────────

export const PROJECT_STATUSES = [
  'DRAFT',
  'INGESTING',
  'ANALYZING',
  'GENERATING_CANDIDATES',
  'SCORING',
  'AWAITING_SELECTION',
  'PRODUCING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_TRANSITIONS: TransitionMap<ProjectStatus> = {
  DRAFT: ['INGESTING', 'CANCELED'],
  INGESTING: ['ANALYZING', 'FAILED', 'CANCELED'],
  ANALYZING: ['GENERATING_CANDIDATES', 'FAILED', 'CANCELED'],
  GENERATING_CANDIDATES: ['SCORING', 'FAILED', 'CANCELED'],
  // FULL_AUTO: eşiği geçen adaylar doğrudan PRODUCING; hiçbiri geçmezse COMPLETED.
  SCORING: ['AWAITING_SELECTION', 'PRODUCING', 'COMPLETED', 'FAILED', 'CANCELED'],
  AWAITING_SELECTION: ['PRODUCING', 'COMPLETED', 'CANCELED'],
  // Sonradan yeni aday seçilirse COMPLETED → PRODUCING.
  PRODUCING: ['COMPLETED', 'AWAITING_SELECTION', 'CANCELED'],
  COMPLETED: ['PRODUCING'],
  // Yeniden deneme başarısız aşamadan sürer.
  FAILED: ['INGESTING', 'ANALYZING', 'GENERATING_CANDIDATES', 'SCORING', 'CANCELED'],
  CANCELED: [],
};

// ───────────── SourceVideo ─────────────

export const SOURCE_STATUSES = [
  'PENDING',
  'UPLOADING',
  'UPLOADED',
  'FETCHING',
  'PROBING',
  'READY',
  'FAILED',
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const SOURCE_TRANSITIONS: TransitionMap<SourceStatus> = {
  PENDING: ['UPLOADING', 'FETCHING', 'FAILED'],
  UPLOADING: ['UPLOADED', 'PENDING', 'FAILED'], // PENDING: yükleme iptali
  UPLOADED: ['PROBING', 'FAILED'],
  FETCHING: ['PROBING', 'FAILED'],
  PROBING: ['READY', 'FAILED'],
  READY: [],
  FAILED: ['PENDING'],
};

// ───────────── Kuyruk işleri (PipelineJob, RenderJob) ─────────────

export const JOB_STATUSES = ['QUEUED', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRANSITIONS: TransitionMap<JobStatus> = {
  QUEUED: ['ACTIVE', 'CANCELED'],
  ACTIVE: ['SUCCEEDED', 'FAILED', 'QUEUED', 'CANCELED'], // QUEUED: otomatik yeniden deneme
  SUCCEEDED: [],
  FAILED: ['QUEUED'], // elle yeniden deneme
  CANCELED: [],
};

// ───────────── ClipCandidate ─────────────

export const CANDIDATE_STATUSES = ['PROPOSED', 'SCORED', 'SELECTED', 'REJECTED'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_TRANSITIONS: TransitionMap<CandidateStatus> = {
  PROPOSED: ['SCORED', 'REJECTED'],
  SCORED: ['SELECTED', 'REJECTED'],
  SELECTED: [],
  REJECTED: ['SELECTED'], // kullanıcı fikir değiştirebilir
};

// ───────────── Clip ─────────────
// aday → kurguda → hazır → planlandı → yayında → hata

export const CLIP_STATUSES = [
  'CANDIDATE',
  'EDITING',
  'READY',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'ARCHIVED',
] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

export const CLIP_TRANSITIONS: TransitionMap<ClipStatus> = {
  CANDIDATE: ['EDITING', 'ARCHIVED'],
  EDITING: ['READY', 'FAILED', 'ARCHIVED'],
  READY: ['EDITING', 'SCHEDULED', 'PUBLISHING', 'ARCHIVED'], // EDITING: yeniden üretim
  SCHEDULED: ['READY', 'PUBLISHING', 'ARCHIVED'], // READY: plan iptali
  PUBLISHING: ['PUBLISHED', 'SCHEDULED', 'FAILED'], // SCHEDULED: geri çekilmeli yeniden deneme
  PUBLISHED: ['ARCHIVED'],
  FAILED: ['EDITING', 'SCHEDULED', 'PUBLISHING', 'ARCHIVED'],
  ARCHIVED: [],
};

/** Kullanıcının klibi düzenleyebildiği durumlar (PATCH /clips/{id}). */
export const CLIP_EDITABLE: readonly ClipStatus[] = ['CANDIDATE', 'READY', 'FAILED'];

// ───────────── PublishJob ─────────────

export const PUBLISH_STATUSES = [
  'SCHEDULED',
  'QUEUED',
  'UPLOADING',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
  'CANCELED',
] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

export const PUBLISH_TRANSITIONS: TransitionMap<PublishStatus> = {
  SCHEDULED: ['QUEUED', 'CANCELED'],
  QUEUED: ['UPLOADING', 'SCHEDULED', 'CANCELED'], // SCHEDULED: kota doldu, ertesi güne ertele
  UPLOADING: ['PROCESSING', 'SCHEDULED', 'FAILED'], // SCHEDULED: nextRetryAt ile yeniden deneme
  PROCESSING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [],
  FAILED: ['QUEUED'], // elle yeniden deneme
  CANCELED: [],
};

/** Yayın yeniden deneme gecikmesi: 3 deneme, üstel geri çekilme + ±%20 sapma. */
export const PUBLISH_MAX_ATTEMPTS = 3;
export function publishBackoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 60_000 * 2 ** Math.max(0, attempt - 1); // 1 dk, 2 dk, 4 dk
  const jitter = 1 + (random() * 2 - 1) * 0.2;
  return Math.round(base * jitter);
}

// ───────────── Subscription ─────────────

export const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'TRIALING',
  'GRACE_PERIOD',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_TRANSITIONS: TransitionMap<SubscriptionStatus> = {
  TRIALING: ['ACTIVE', 'CANCELED', 'EXPIRED'],
  ACTIVE: ['GRACE_PERIOD', 'PAST_DUE', 'CANCELED', 'EXPIRED'],
  GRACE_PERIOD: ['ACTIVE', 'PAST_DUE', 'EXPIRED'],
  PAST_DUE: ['ACTIVE', 'EXPIRED'],
  CANCELED: ['ACTIVE', 'EXPIRED'], // dönem bitmeden yeniden abone olma
  EXPIRED: ['ACTIVE', 'TRIALING'],
};

// ───────────── Puanlama ağırlıkları ─────────────

export const SCORE_WEIGHTS = {
  hook: 0.3,
  emotion: 0.25,
  standalone: 0.2,
  curiosity: 0.15,
  shareability: 0.1,
} as const;
export type ScoreBreakdown = Record<keyof typeof SCORE_WEIGHTS, number>;

export function weightedScore(b: ScoreBreakdown): number {
  const total = (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).reduce(
    (sum, k) => sum + b[k] * SCORE_WEIGHTS[k],
    0,
  );
  return Math.round(total);
}

// ───────────── Plan hakları ─────────────

export const PLANS = ['FREE', 'PRO', 'AGENCY'] as const;
export type Plan = (typeof PLANS)[number];

export interface Entitlements {
  /** null = sınırsız */
  monthlyClips: number | null;
  /** 1 kredi = işlenen 1 kaynak dakikası */
  monthlyCredits: number;
  maxResolution: 'HD_720' | 'FHD_1080' | 'UHD_4K';
  maxChannels: number;
  watermark: boolean;
  teamAccess: boolean;
  /** BullMQ önceliği: küçük sayı önce işlenir */
  priority: number;
}

export const ENTITLEMENTS: Readonly<Record<Plan, Entitlements>> = {
  FREE: {
    monthlyClips: 5,
    monthlyCredits: 60,
    maxResolution: 'HD_720',
    maxChannels: 1,
    watermark: true,
    teamAccess: false,
    priority: 10,
  },
  PRO: {
    monthlyClips: 150,
    monthlyCredits: 1500,
    maxResolution: 'FHD_1080',
    maxChannels: 1,
    watermark: false,
    teamAccess: false,
    priority: 5,
  },
  AGENCY: {
    monthlyClips: null,
    monthlyCredits: 10000,
    maxResolution: 'UHD_4K',
    maxChannels: 10,
    watermark: false,
    teamAccess: true,
    priority: 1,
  },
};

// ───────────── Rol yetkileri ─────────────

export const MEMBER_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PERMISSIONS = {
  'channel.read': ['OWNER', 'EDITOR', 'VIEWER'],
  'channel.disconnect': ['OWNER'],
  'members.manage': ['OWNER'],
  'settings.write': ['OWNER', 'EDITOR'],
  'project.create': ['OWNER', 'EDITOR'],
  'project.delete': ['OWNER', 'EDITOR'],
  'clip.edit': ['OWNER', 'EDITOR'],
  'clip.approve': ['OWNER', 'EDITOR'],
  'clip.publish': ['OWNER', 'EDITOR'],
  'stats.read': ['OWNER', 'EDITOR', 'VIEWER'],
} as const satisfies Record<string, readonly MemberRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: MemberRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly MemberRole[]).includes(role);
}
