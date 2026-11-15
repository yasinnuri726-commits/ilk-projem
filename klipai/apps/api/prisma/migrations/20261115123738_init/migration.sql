-- Büyük/küçük harf duyarsız e-posta sütunları için
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('TR', 'EN');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('FULL_AUTO', 'APPROVAL', 'DRAFT_ONLY');

-- CreateEnum
CREATE TYPE "AspectRatio" AS ENUM ('PORTRAIT_9_16', 'SQUARE_1_1', 'LANDSCAPE_16_9');

-- CreateEnum
CREATE TYPE "Resolution" AS ENUM ('HD_720', 'FHD_1080', 'UHD_4K');

-- CreateEnum
CREATE TYPE "CommentaryFormat" AS ENUM ('NONE', 'REACTION', 'ANALYSIS', 'RANKING');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('SUBTITLE', 'COMMENTARY', 'BRAND', 'PROFILE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'INGESTING', 'ANALYZING', 'GENERATING_CANDIDATES', 'SCORING', 'AWAITING_SELECTION', 'PRODUCING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RightsBasis" AS ENUM ('OWN_CONTENT', 'LICENSED', 'PUBLIC_DOMAIN', 'PERMITTED');

-- CreateEnum
CREATE TYPE "IngestType" AS ENUM ('UPLOAD', 'LINK');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'UPLOADING', 'UPLOADED', 'FETCHING', 'PROBING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE', 'EDIT', 'ORIGINALIZE', 'METADATA', 'QC', 'PUBLISH', 'LEARN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PROPOSED', 'SCORED', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('CANDIDATE', 'EDITING', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('PENDING', 'PASSED', 'AUTO_FIXED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "RenderKind" AS ENUM ('EDIT', 'ORIGINALIZE', 'METADATA', 'QC');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'UPLOADING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PrivacyStatus" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "StatsWindow" AS ENUM ('H24', 'D7');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'GRACE_PERIOD', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Store" AS ENUM ('APP_STORE', 'PLAY_STORE', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('CREDIT_GRANT', 'MINUTES_PROCESSED', 'CLIP_RENDERED', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ANALYSIS_DONE', 'CLIP_READY', 'CLIP_NEEDS_APPROVAL', 'CLIP_PUBLISHED', 'PUBLISH_FAILED', 'QC_FLAGGED', 'QUOTA_LOW', 'CREDITS_LOW', 'CHANNEL_REAUTH', 'SUBSCRIPTION_CHANGED', 'TEAM_INVITE', 'DATA_EXPORT_READY');

-- CreateEnum
CREATE TYPE "DataRequestKind" AS ENUM ('EXPORT', 'DELETE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OneTimeTokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT,
    "googleSub" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'TR',
    "theme" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "deletionScheduledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" UUID,
    "userAgent" TEXT,
    "ip" INET,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "OneTimeTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "pushToken" TEXT NOT NULL,
    "appVersion" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'TR',
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "youtubeChannelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "thumbnailUrl" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "quotaUnitsUsed" INTEGER NOT NULL DEFAULT 0,
    "quotaResetAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_credentials" (
    "channelId" UUID NOT NULL,
    "accessTokenEnc" BYTEA NOT NULL,
    "refreshTokenEnc" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[],
    "accessExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channel_credentials_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "channel_members" (
    "channelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "channel_invites" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "channelId" UUID NOT NULL,
    "automationMode" "AutomationMode" NOT NULL DEFAULT 'APPROVAL',
    "dailyClipCount" INTEGER NOT NULL DEFAULT 3,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "publishWindows" JSONB NOT NULL DEFAULT '[{"start":"12:00","end":"14:00"},{"start":"19:00","end":"22:00"}]',
    "useBestTime" BOOLEAN NOT NULL DEFAULT true,
    "defaultPrivacy" "PrivacyStatus" NOT NULL DEFAULT 'PUBLIC',
    "minDurationSec" INTEGER NOT NULL DEFAULT 20,
    "maxDurationSec" INTEGER NOT NULL DEFAULT 60,
    "minScore" INTEGER NOT NULL DEFAULT 70,
    "maxClipsPerVideo" INTEGER NOT NULL DEFAULT 8,
    "aspectRatio" "AspectRatio" NOT NULL DEFAULT 'PORTRAIT_9_16',
    "resolution" "Resolution" NOT NULL DEFAULT 'FHD_1080',
    "subtitle" JSONB NOT NULL DEFAULT '{}',
    "commentary" JSONB NOT NULL DEFAULT '{}',
    "audio" JSONB NOT NULL DEFAULT '{}',
    "brand" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID,
    "channelId" UUID,
    "config" JSONB NOT NULL,
    "previewKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "settingsSnapshot" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rights_declarations" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "userId" UUID NOT NULL,
    "basis" "RightsBasis" NOT NULL,
    "note" TEXT,
    "evidenceUrl" TEXT,
    "evidenceKey" TEXT,
    "termsVersion" TEXT NOT NULL,
    "termsHash" TEXT NOT NULL,
    "sourceFingerprint" TEXT,
    "ip" INET NOT NULL,
    "userAgent" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rights_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_videos" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ingestType" "IngestType" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "sourceUrl" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "storageKey" TEXT,
    "proxyKey" TEXT,
    "audioKey" TEXT,
    "uploadId" TEXT,
    "partSize" INTEGER,
    "thumbnailKey" TEXT,
    "declaredDurationMs" INTEGER,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "hasAudio" BOOLEAN,
    "analysisKeys" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "source_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" UUID NOT NULL,
    "sourceVideoId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "wordsKey" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "speakerCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "transcriptId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speaker" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("transcriptId","index")
);

-- CreateTable
CREATE TABLE "pipeline_jobs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "stage" "PipelineStage" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "queueJobId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "gpuSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "pipeline_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clip_candidates" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PROPOSED',
    "signals" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "breakdown" JSONB,
    "rationale" TEXT,
    "hookText" TEXT,
    "suggestedFormat" "CommentaryFormat",
    "promptVersion" TEXT,
    "rank" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clip_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clips" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "status" "ClipStatus" NOT NULL DEFAULT 'CANDIDATE',
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "aspectRatio" "AspectRatio" NOT NULL,
    "resolution" "Resolution" NOT NULL,
    "commentaryFormat" "CommentaryFormat" NOT NULL DEFAULT 'NONE',
    "watermark" BOOLEAN NOT NULL DEFAULT false,
    "editSpec" JSONB NOT NULL,
    "commentaryScript" TEXT,
    "titles" TEXT[],
    "selectedTitle" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "tags" TEXT[],
    "hashtags" TEXT[],
    "categoryId" TEXT,
    "language" TEXT,
    "outputKey" TEXT,
    "previewKey" TEXT,
    "thumbnailKey" TEXT,
    "durationMs" INTEGER,
    "qcStatus" "QcStatus" NOT NULL DEFAULT 'PENDING',
    "qcReport" JSONB,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "scheduledAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "youtubeVideoId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "render_jobs" (
    "id" UUID NOT NULL,
    "clipId" UUID NOT NULL,
    "kind" "RenderKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "queueJobId" TEXT,
    "specHash" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "outputKey" TEXT,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "gpuSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_jobs" (
    "id" UUID NOT NULL,
    "clipId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'SCHEDULED',
    "privacy" "PrivacyStatus" NOT NULL DEFAULT 'PUBLIC',
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "queueJobId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMPTZ(3),
    "uploadSessionEnc" BYTEA,
    "bytesUploaded" BIGINT NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT,
    "quotaUnits" INTEGER NOT NULL DEFAULT 0,
    "youtubeVideoId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "publish_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clip_stats" (
    "clipId" UUID NOT NULL,
    "window" "StatsWindow" NOT NULL,
    "views" INTEGER NOT NULL,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "avgViewDurationSec" DOUBLE PRECISION,
    "avgViewPercentage" DOUBLE PRECISION,
    "subscribersGained" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clip_stats_pkey" PRIMARY KEY ("clipId","window")
);

-- CreateTable
CREATE TABLE "channel_insights" (
    "channelId" UUID NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '{}',
    "promptAddendum" TEXT NOT NULL DEFAULT '',
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_insights_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "userId" UUID NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "store" "Store",
    "productId" TEXT,
    "rcAppUserId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "willRenew" BOOLEAN NOT NULL DEFAULT false,
    "creditsGranted" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "clipsUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channelId" UUID,
    "projectId" UUID,
    "clipId" UUID,
    "kind" "UsageKind" NOT NULL,
    "credits" INTEGER NOT NULL,
    "minutes" DECIMAL(10,3),
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "periodKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "target" JSONB,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "DataRequestKind" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultKey" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "channelId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_tokenHash_key" ON "one_time_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "one_time_tokens_userId_purpose_idx" ON "one_time_tokens"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "devices_pushToken_key" ON "devices"("pushToken");

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channels_youtubeChannelId_key" ON "channels"("youtubeChannelId");

-- CreateIndex
CREATE INDEX "channels_ownerId_idx" ON "channels"("ownerId");

-- CreateIndex
CREATE INDEX "channel_members_userId_idx" ON "channel_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_invites_tokenHash_key" ON "channel_invites"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "channel_invites_channelId_email_key" ON "channel_invites"("channelId", "email");

-- CreateIndex
CREATE INDEX "templates_ownerId_kind_idx" ON "templates"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "templates_channelId_kind_idx" ON "templates"("channelId", "kind");

-- CreateIndex
CREATE INDEX "templates_isSystem_kind_idx" ON "templates"("isSystem", "kind");

-- CreateIndex
CREATE INDEX "projects_channelId_createdAt_idx" ON "projects"("channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "projects_channelId_status_idx" ON "projects"("channelId", "status");

-- CreateIndex
CREATE INDEX "projects_createdById_idx" ON "projects"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "rights_declarations_projectId_key" ON "rights_declarations"("projectId");

-- CreateIndex
CREATE INDEX "rights_declarations_userId_acceptedAt_idx" ON "rights_declarations"("userId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "source_videos_projectId_key" ON "source_videos"("projectId");

-- CreateIndex
CREATE INDEX "source_videos_status_idx" ON "source_videos"("status");

-- CreateIndex
CREATE INDEX "source_videos_sha256_idx" ON "source_videos"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_sourceVideoId_key" ON "transcripts"("sourceVideoId");

-- CreateIndex
CREATE INDEX "transcript_segments_transcriptId_startMs_idx" ON "transcript_segments"("transcriptId", "startMs");

-- CreateIndex
CREATE INDEX "pipeline_jobs_status_queuedAt_idx" ON "pipeline_jobs"("status", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_jobs_projectId_stage_key" ON "pipeline_jobs"("projectId", "stage");

-- CreateIndex
CREATE INDEX "clip_candidates_projectId_score_idx" ON "clip_candidates"("projectId", "score" DESC);

-- CreateIndex
CREATE INDEX "clip_candidates_projectId_status_idx" ON "clip_candidates"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clips_candidateId_key" ON "clips"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "clips_youtubeVideoId_key" ON "clips"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "clips_projectId_status_idx" ON "clips"("projectId", "status");

-- CreateIndex
CREATE INDEX "clips_channelId_status_updatedAt_idx" ON "clips"("channelId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "clips_channelId_scheduledAt_idx" ON "clips"("channelId", "scheduledAt");

-- CreateIndex
CREATE INDEX "clips_channelId_publishedAt_idx" ON "clips"("channelId", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "render_jobs_clipId_queuedAt_idx" ON "render_jobs"("clipId", "queuedAt" DESC);

-- CreateIndex
CREATE INDEX "render_jobs_status_queuedAt_idx" ON "render_jobs"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "render_jobs_clipId_kind_specHash_idx" ON "render_jobs"("clipId", "kind", "specHash");

-- CreateIndex
CREATE INDEX "publish_jobs_status_scheduledAt_idx" ON "publish_jobs"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "publish_jobs_channelId_scheduledAt_idx" ON "publish_jobs"("channelId", "scheduledAt");

-- CreateIndex
CREATE INDEX "publish_jobs_clipId_createdAt_idx" ON "publish_jobs"("clipId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_rcAppUserId_key" ON "subscriptions"("rcAppUserId");

-- CreateIndex
CREATE INDEX "subscriptions_periodEnd_idx" ON "subscriptions"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "usage_logs_idempotencyKey_key" ON "usage_logs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "usage_logs_userId_periodKey_kind_idx" ON "usage_logs"("userId", "periodKey", "kind");

-- CreateIndex
CREATE INDEX "usage_logs_projectId_idx" ON "usage_logs"("projectId");

-- CreateIndex
CREATE INDEX "usage_logs_createdAt_idx" ON "usage_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "data_requests_userId_kind_idx" ON "data_requests"("userId", "kind");

-- CreateIndex
CREATE INDEX "data_requests_status_idx" ON "data_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "audit_logs_channelId_createdAt_idx" ON "audit_logs"("channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_credentials" ADD CONSTRAINT "channel_credentials_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_invites" ADD CONSTRAINT "channel_invites_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_declarations" ADD CONSTRAINT "rights_declarations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_declarations" ADD CONSTRAINT "rights_declarations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_videos" ADD CONSTRAINT "source_videos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "source_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clip_candidates" ADD CONSTRAINT "clip_candidates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "clip_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clip_stats" ADD CONSTRAINT "clip_stats_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_insights" ADD CONSTRAINT "channel_insights_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "clips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
