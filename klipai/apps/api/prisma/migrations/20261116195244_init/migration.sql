-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('TR', 'EN');

-- CreateEnum
CREATE TYPE "ChannelRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('FULL_AUTO', 'APPROVAL', 'DRAFT_ONLY');

-- CreateEnum
CREATE TYPE "AspectRatio" AS ENUM ('PORTRAIT_9_16', 'SQUARE_1_1', 'LANDSCAPE_16_9');

-- CreateEnum
CREATE TYPE "Resolution" AS ENUM ('HD_720', 'FHD_1080', 'UHD_4K');

-- CreateEnum
CREATE TYPE "CommentaryTone" AS ENUM ('FUNNY', 'SERIOUS', 'INFORMATIVE');

-- CreateEnum
CREATE TYPE "CommentaryFormat" AS ENUM ('NONE', 'REACTION', 'ANALYSIS', 'RANKING');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('UPLOAD', 'LINK');

-- CreateEnum
CREATE TYPE "RightsBasis" AS ENUM ('OWN_CONTENT', 'LICENSED', 'PUBLIC_DOMAIN', 'PERMITTED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'INGESTING', 'ANALYZING', 'GENERATING', 'SCORING', 'READY', 'FAILED', 'CANCELED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceVideoStatus" AS ENUM ('PENDING', 'UPLOADING', 'DOWNLOADING', 'PROBING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('INITIATED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING_SCORE', 'SCORED', 'ACCEPTED', 'REJECTED', 'BELOW_THRESHOLD');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('CANDIDATE', 'EDITING', 'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('PENDING', 'PASSED', 'AUTO_FIXED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE', 'EDIT', 'COMMENTARY', 'METADATA', 'QC', 'PUBLISH', 'LEARN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'UPLOADING', 'RETRY_WAIT', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "YoutubePrivacy" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('SUBTITLE', 'BRAND', 'COMMENTARY', 'METADATA');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'IN_GRACE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('CREDIT_GRANT', 'CREDIT_CONSUME', 'CREDIT_REFUND', 'CLIP_RENDER', 'COST_LLM', 'COST_GPU', 'COST_TTS', 'COST_STORAGE');

-- CreateEnum
CREATE TYPE "StatsWindow" AS ENUM ('H24', 'D7', 'D28');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PROJECT_READY', 'PROJECT_FAILED', 'CLIP_READY', 'CLIP_NEEDS_APPROVAL', 'CLIP_PUBLISHED', 'PUBLISH_FAILED', 'QUOTA_WARNING', 'CHANNEL_TOKEN_EXPIRED', 'CREDITS_LOW', 'SUBSCRIPTION_CHANGED', 'TEAM_INVITE');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('EXPORT', 'DELETE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'TR',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "revenueCatId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimeToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "pushToken" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'TR',
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "youtubeChannelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "thumbnailUrl" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "quotaUsedToday" INTEGER NOT NULL DEFAULT 0,
    "quotaResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriberCount" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMember" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT,
    "inviteEmail" TEXT,
    "role" "ChannelRole" NOT NULL,
    "invitedById" TEXT NOT NULL,
    "inviteTokenHash" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "automationMode" "AutomationMode" NOT NULL DEFAULT 'APPROVAL',
    "dailyClipCount" INTEGER NOT NULL DEFAULT 2,
    "timeSlots" JSONB NOT NULL DEFAULT '[{"start":"12:00","end":"14:00"},{"start":"19:00","end":"22:00"}]',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "useBestTimes" BOOLEAN NOT NULL DEFAULT true,
    "minDurationSec" INTEGER NOT NULL DEFAULT 20,
    "maxDurationSec" INTEGER NOT NULL DEFAULT 60,
    "minScore" INTEGER NOT NULL DEFAULT 70,
    "maxClipsPerVideo" INTEGER NOT NULL DEFAULT 8,
    "aspectRatio" "AspectRatio" NOT NULL DEFAULT 'PORTRAIT_9_16',
    "resolution" "Resolution" NOT NULL DEFAULT 'FHD_1080',
    "subtitle" JSONB NOT NULL DEFAULT '{}',
    "commentaryFormat" "CommentaryFormat" NOT NULL DEFAULT 'NONE',
    "commentaryTone" "CommentaryTone" NOT NULL DEFAULT 'INFORMATIVE',
    "commentaryPrompt" TEXT,
    "commentaryMaxSec" INTEGER NOT NULL DEFAULT 15,
    "audio" JSONB NOT NULL DEFAULT '{}',
    "brand" JSONB NOT NULL DEFAULT '{}',
    "titleLanguage" "Locale" NOT NULL DEFAULT 'TR',
    "fixedTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "descriptionTemplate" TEXT,
    "youtubeCategoryId" TEXT NOT NULL DEFAULT '24',
    "defaultPrivacy" "YoutubePrivacy" NOT NULL DEFAULT 'PUBLIC',
    "madeForKids" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "channelId" TEXT,
    "kind" "TemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStage" "PipelineStage",
    "progress" INTEGER NOT NULL DEFAULT 0,
    "settingsSnapshot" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "creditsReserved" INTEGER NOT NULL DEFAULT 0,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "s3UploadId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "partSize" INTEGER NOT NULL,
    "partCount" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'INITIATED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceVideo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "status" "SourceVideoStatus" NOT NULL DEFAULT 'PENDING',
    "uploadSessionId" TEXT,
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "proxyKey" TEXT,
    "audioKey" TEXT,
    "checksumSha256" TEXT,
    "sizeBytes" BIGINT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "language" TEXT,
    "thumbnailKey" TEXT,
    "scenesKey" TEXT,
    "audioEnergyKey" TEXT,
    "facesKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsDeclaration" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sourceVideoId" TEXT,
    "projectTitle" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "basis" "RightsBasis" NOT NULL,
    "details" TEXT,
    "evidenceKey" TEXT,
    "attestationText" TEXT NOT NULL,
    "attestationVersion" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RightsDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'whisper-large-v3',
    "text" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "wordsKey" TEXT NOT NULL,
    "speakers" JSONB NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipCandidate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING_SCORE',
    "score" INTEGER,
    "hookScore" INTEGER,
    "emotionScore" INTEGER,
    "standaloneScore" INTEGER,
    "curiosityScore" INTEGER,
    "shareabilityScore" INTEGER,
    "rationale" JSONB,
    "features" JSONB,
    "promptVersion" TEXT,
    "previewKey" TEXT,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "candidateId" TEXT,
    "status" "ClipStatus" NOT NULL DEFAULT 'CANDIDATE',
    "qcStatus" "QcStatus" NOT NULL DEFAULT 'PENDING',
    "qcReport" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "aspectRatio" "AspectRatio" NOT NULL,
    "resolution" "Resolution" NOT NULL,
    "watermarked" BOOLEAN NOT NULL DEFAULT false,
    "editSpec" JSONB NOT NULL,
    "hookText" TEXT,
    "commentaryFormat" "CommentaryFormat" NOT NULL DEFAULT 'NONE',
    "commentaryScript" TEXT,
    "commentaryAudioKey" TEXT,
    "title" TEXT,
    "titleAlternatives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputKey" TEXT,
    "thumbnailKey" TEXT,
    "frameKey" TEXT,
    "durationSec" DOUBLE PRECISION,
    "sizeBytes" BIGINT,
    "loudnessLufs" DOUBLE PRECISION,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "queueJobId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "workerId" TEXT,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PipelineJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "queueJobId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "specSnapshot" JSONB NOT NULL,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "workerId" TEXT,
    "gpuSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "privacy" "YoutubePrivacy" NOT NULL DEFAULT 'PUBLIC',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryId" TEXT NOT NULL,
    "uploadUrl" TEXT,
    "bytesUploaded" BIGINT NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "quotaCost" INTEGER NOT NULL DEFAULT 1650,
    "youtubeVideoId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipStats" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "window" "StatsWindow" NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "avgViewPct" DOUBLE PRECISION,
    "avgViewSec" DOUBLE PRECISION,
    "subscribersGained" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningInsight" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "store" TEXT,
    "productId" TEXT,
    "entitlement" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "willRenew" BOOLEAN NOT NULL DEFAULT false,
    "creditsGranted" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "clipsUsed" INTEGER NOT NULL DEFAULT 0,
    "lastEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "clipId" TEXT,
    "kind" "UsageKind" NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "provider" TEXT,
    "idempotencyKey" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "deepLink" TEXT,
    "readAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultKey" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_revenueCatId_key" ON "User"("revenueCatId");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OneTimeToken_tokenHash_key" ON "OneTimeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OneTimeToken_userId_purpose_idx" ON "OneTimeToken"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Device_pushToken_key" ON "Device"("pushToken");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_youtubeChannelId_key" ON "Channel"("youtubeChannelId");

-- CreateIndex
CREATE INDEX "Channel_ownerId_idx" ON "Channel"("ownerId");

-- CreateIndex
CREATE INDEX "Channel_status_idx" ON "Channel"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMember_inviteTokenHash_key" ON "ChannelMember"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "ChannelMember_userId_idx" ON "ChannelMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMember_channelId_userId_key" ON "ChannelMember"("channelId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMember_channelId_inviteEmail_key" ON "ChannelMember"("channelId", "inviteEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_channelId_key" ON "Settings"("channelId");

-- CreateIndex
CREATE INDEX "Template_ownerId_kind_idx" ON "Template"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "Template_channelId_kind_idx" ON "Template"("channelId", "kind");

-- CreateIndex
CREATE INDEX "Template_isSystem_kind_idx" ON "Template"("isSystem", "kind");

-- CreateIndex
CREATE INDEX "Project_userId_createdAt_idx" ON "Project"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Project_channelId_status_idx" ON "Project"("channelId", "status");

-- CreateIndex
CREATE INDEX "Project_status_updatedAt_idx" ON "Project"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_storageKey_key" ON "UploadSession"("storageKey");

-- CreateIndex
CREATE INDEX "UploadSession_userId_status_idx" ON "UploadSession"("userId", "status");

-- CreateIndex
CREATE INDEX "UploadSession_status_expiresAt_idx" ON "UploadSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceVideo_projectId_key" ON "SourceVideo"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceVideo_uploadSessionId_key" ON "SourceVideo"("uploadSessionId");

-- CreateIndex
CREATE INDEX "SourceVideo_checksumSha256_idx" ON "SourceVideo"("checksumSha256");

-- CreateIndex
CREATE UNIQUE INDEX "RightsDeclaration_sourceVideoId_key" ON "RightsDeclaration"("sourceVideoId");

-- CreateIndex
CREATE INDEX "RightsDeclaration_userId_idx" ON "RightsDeclaration"("userId");

-- CreateIndex
CREATE INDEX "RightsDeclaration_declaredAt_idx" ON "RightsDeclaration"("declaredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_projectId_key" ON "Transcript"("projectId");

-- CreateIndex
CREATE INDEX "ClipCandidate_projectId_score_idx" ON "ClipCandidate"("projectId", "score" DESC);

-- CreateIndex
CREATE INDEX "ClipCandidate_projectId_status_idx" ON "ClipCandidate"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_candidateId_key" ON "Clip"("candidateId");

-- CreateIndex
CREATE INDEX "Clip_projectId_idx" ON "Clip"("projectId");

-- CreateIndex
CREATE INDEX "Clip_channelId_status_idx" ON "Clip"("channelId", "status");

-- CreateIndex
CREATE INDEX "Clip_channelId_createdAt_idx" ON "Clip"("channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Clip_status_updatedAt_idx" ON "Clip"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PipelineJob_projectId_stage_idx" ON "PipelineJob"("projectId", "stage");

-- CreateIndex
CREATE INDEX "PipelineJob_status_queuedAt_idx" ON "PipelineJob"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "RenderJob_clipId_stage_idx" ON "RenderJob"("clipId", "stage");

-- CreateIndex
CREATE INDEX "RenderJob_status_priority_queuedAt_idx" ON "RenderJob"("status", "priority", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_youtubeVideoId_key" ON "PublishJob"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "PublishJob_channelId_scheduledAt_idx" ON "PublishJob"("channelId", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublishJob_status_scheduledAt_idx" ON "PublishJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublishJob_clipId_idx" ON "PublishJob"("clipId");

-- CreateIndex
CREATE INDEX "ClipStats_capturedAt_idx" ON "ClipStats"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClipStats_clipId_window_key" ON "ClipStats"("clipId", "window");

-- CreateIndex
CREATE INDEX "LearningInsight_channelId_active_idx" ON "LearningInsight"("channelId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LearningInsight_channelId_version_key" ON "LearningInsight"("channelId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "UsageLog_idempotencyKey_key" ON "UsageLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageLog_userId_createdAt_idx" ON "UsageLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UsageLog_projectId_idx" ON "UsageLog"("projectId");

-- CreateIndex
CREATE INDEX "UsageLog_kind_createdAt_idx" ON "UsageLog"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "DataRequest_userId_type_idx" ON "DataRequest"("userId", "type");

-- CreateIndex
CREATE INDEX "DataRequest_status_scheduledFor_idx" ON "DataRequest"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneTimeToken" ADD CONSTRAINT "OneTimeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVideo" ADD CONSTRAINT "SourceVideo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVideo" ADD CONSTRAINT "SourceVideo_uploadSessionId_fkey" FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsDeclaration" ADD CONSTRAINT "RightsDeclaration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsDeclaration" ADD CONSTRAINT "RightsDeclaration_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "SourceVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ClipCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineJob" ADD CONSTRAINT "PipelineJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipStats" ADD CONSTRAINT "ClipStats_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningInsight" ADD CONSTRAINT "LearningInsight_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
