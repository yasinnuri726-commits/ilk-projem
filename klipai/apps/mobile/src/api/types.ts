import type {
  AspectRatio, AutomationMode, ChannelRole, ChannelSettings, ClipStatus, CommentaryFormat, EditSpec, JobStatus, Locale, Plan, PipelineStage, ProjectStatus, PublishStatus,
  QcStatus, Resolution, TemplateKind, YoutubePrivacy,
} from '@klipai/shared';

export type { ChannelSettings, EditSpec };

export interface User {
  id: string; email: string; username: string | null; role: 'USER' | 'DEVELOPER'; emailVerified: boolean; displayName: string; avatarUrl: string | null;
  locale: Locale; timezone: string; plan: Plan; revenueCatId: string; createdAt: string;
}
export interface Session { accessToken: string; refreshToken: string; expiresIn: number; user: User }
export interface Channel {
  id: string; youtubeChannelId: string; title: string; handle: string | null; thumbnailUrl: string | null; status: 'ACTIVE' | 'TOKEN_EXPIRED' | 'DISCONNECTED';
  role: ChannelRole; subscriberCount: number | null; createdAt: string;
}
export interface Member { id: string; userId: string | null; email: string; displayName: string | null; role: ChannelRole; acceptedAt: string | null }
export interface ApiErrorBody { code: string; detail?: string; title?: string; errors?: { path: string; message: string }[]; traceId?: string }
export interface Project {
  id: string; channelId: string; title: string; status: ProjectStatus; currentStage: PipelineStage | null; progress: number; thumbnailUrl: string | null; durationSec: number | null;
  candidateCount: number; clipCount: number; creditsConsumed: number; error: { code: string; message: string } | null; createdAt: string; completedAt: string | null;
}
export interface StageState { stage: PipelineStage; status: JobStatus | null; progress: number; attempt: number; startedAt: string | null; finishedAt: string | null }
export interface ProjectDetail extends Project { source: { type: 'UPLOAD' | 'LINK'; status: string; width: number | null; height: number | null; language: string | null; rightsBasis: string | null } | null; stages: StageState[] }
export interface Candidate {
  id: string; startSec: number; endSec: number; durationSec: number; text: string; status: string; score: number | null; rank: number | null;
  breakdown: { hook: number; emotion: number; standalone: number; curiosity: number; shareability: number } | null;
  rationale: { summary?: string; hook?: string; emotion?: string; standalone?: string; curiosity?: string; shareability?: string; suggestedHook?: string; risks?: string[] } | null;
  previewUrl: string | null; clipId: string | null;
}
export interface PublishJob {
  id: string; clipId: string; channelId: string; status: PublishStatus; scheduledAt: string; privacy: YoutubePrivacy; title: string; thumbnailUrl: string | null; attempt: number;
  nextAttemptAt: string | null; uploadProgress: number; youtubeVideoId: string | null; youtubeUrl: string | null; publishedAt: string | null; error: { code: string; message: string } | null;
}
export interface Clip {
  id: string; projectId: string; channelId: string; candidateId: string | null; status: ClipStatus; qcStatus: QcStatus; qcReport?: { check: string; passed: boolean; value: string; fixed?: boolean }[] | null;
  version: number; score: number | null; startSec: number; endSec: number; durationSec: number | null; aspectRatio: AspectRatio; resolution: Resolution; watermarked: boolean;
  editSpec?: EditSpec; hookText: string | null; commentaryFormat: CommentaryFormat; commentaryScript?: string | null; title: string | null; titleAlternatives: string[];
  description?: string | null; tags: string[]; hashtags: string[]; videoUrl: string | null; thumbnailUrl: string | null; renderStage: PipelineStage | null; renderProgress: number | null;
  publishJob: PublishJob | null; error: { code: string; message: string } | null; createdAt: string; updatedAt: string;
}
export interface Dashboard {
  today: { published: number; scheduled: number; awaitingApproval: number; failed: number; views24h: number };
  queue: { projects: Project[]; rendering: Clip[]; upcoming: PublishJob[] };
  credits: { used: number; granted: number | null; clipsUsed: number; clipLimit: number | null };
}
export interface StatsOverview {
  totals: { views: number; likes: number; comments: number; subscribersGained: number; clipsPublished: number; avgViewPct: number | null };
  series: { date: string; views: number; clipsPublished: number }[];
  topClips: { clipId: string; title: string; thumbnailUrl: string | null; views: number; score: number | null }[];
  insight: string | null;
}
export interface SubscriptionInfo {
  plan: Plan; role: 'USER' | 'DEVELOPER'; status: string; willRenew: boolean; currentPeriodEnd: string;
  limits: { clipsPerMonth: number | null; creditsPerMonth: number | null; maxResolution: Resolution; maxChannels: number | null; watermark: boolean; teamAccess: boolean; queuePriority: number };
  usage: { clipsUsed: number; creditsUsed: number; creditsGranted: number | null; channelsUsed: number };
}
export interface UsageEntry { id: string; kind: string; credits: number; projectId: string | null; projectTitle: string | null; createdAt: string }
export interface AppNotification { id: string; type: string; params: Record<string, string | number | null>; deepLink: string | null; readAt: string | null; createdAt: string }
export interface Template { id: string; kind: TemplateKind; name: string; isSystem: boolean; channelId: string | null; config: Record<string, unknown> }
export interface UploadSession { id: string; status: string; partSize: number; partCount: number; completedParts?: number[]; expiresAt: string }
export type { AutomationMode, Locale, YoutubePrivacy };
