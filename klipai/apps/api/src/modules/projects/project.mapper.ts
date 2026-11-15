// Yol: klipai/apps/api/src/modules/projects/project.mapper.ts
import { JOB_ERRORS, PROJECT_STAGE_STATUS, type ProjectStage } from '@klipai/shared';
import type { PipelineJob, Prisma } from '../../generated/prisma/client';

export const PROJECT_INCLUDE = {
  sourceVideo: true,
  _count: { select: { candidates: true, clips: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

export interface JobErrorDto {
  code: string;
  message: string;
  retryable: boolean;
}

export function toJobError(code: string | null, message: string | null): JobErrorDto | null {
  if (!code) return null;
  const known = (JOB_ERRORS as Record<string, { retryable: boolean }>)[code];
  return { code, message: message ?? '', retryable: known?.retryable ?? true };
}

export function currentStageOf(status: string): ProjectStage | 'EDIT' | null {
  if (status === 'PRODUCING') return 'EDIT';
  const entry = Object.entries(PROJECT_STAGE_STATUS).find(([, value]) => value === status);
  return (entry?.[0] as ProjectStage | undefined) ?? null;
}

export function toProjectDto(project: ProjectRow, thumbnailUrl: string | null): Record<string, unknown> {
  return {
    id: project.id,
    channelId: project.channelId,
    title: project.title,
    status: project.status,
    progress: project.progress,
    currentStage: currentStageOf(project.status),
    durationMs: project.sourceVideo?.durationMs ?? project.sourceVideo?.declaredDurationMs ?? null,
    thumbnailUrl,
    candidateCount: project._count.candidates,
    clipCount: project._count.clips,
    error: toJobError(project.errorCode, project.errorMessage),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toStageJobDto(job: PipelineJob): Record<string, unknown> {
  return {
    stage: job.stage,
    status: job.status,
    attempt: job.attempt,
    progress: job.progress,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: toJobError(job.errorCode, job.errorMessage),
  };
}
