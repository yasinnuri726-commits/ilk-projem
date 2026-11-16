import type { ClipStatus, ProjectStatus, PublishStatus } from '@klipai/shared';
import { invalidState } from './errors';

type Table<S extends string> = Record<S, readonly S[]>;

export const PROJECT_TRANSITIONS: Table<ProjectStatus> = {
  DRAFT: ['INGESTING', 'CANCELED'],
  INGESTING: ['ANALYZING', 'FAILED', 'CANCELED'],
  ANALYZING: ['GENERATING', 'FAILED', 'CANCELED'],
  GENERATING: ['SCORING', 'FAILED', 'CANCELED'],
  SCORING: ['READY', 'FAILED', 'CANCELED'],
  READY: ['ARCHIVED'],
  FAILED: ['INGESTING', 'ANALYZING', 'GENERATING', 'SCORING', 'ARCHIVED'],
  CANCELED: ['ARCHIVED'],
  ARCHIVED: ['READY'],
};

export const CLIP_TRANSITIONS: Table<ClipStatus> = {
  CANDIDATE: ['EDITING', 'ARCHIVED'],
  EDITING: ['READY', 'FAILED'],
  READY: ['EDITING', 'SCHEDULED', 'ARCHIVED'],
  SCHEDULED: ['READY', 'PUBLISHED', 'FAILED'],
  PUBLISHED: ['ARCHIVED'],
  FAILED: ['EDITING', 'SCHEDULED', 'ARCHIVED'],
  ARCHIVED: [],
};

export const PUBLISH_TRANSITIONS: Table<PublishStatus> = {
  PENDING_APPROVAL: ['SCHEDULED', 'CANCELED'],
  SCHEDULED: ['QUOTA_DEFERRED', 'UPLOADING', 'CANCELED', 'SCHEDULED'],
  QUOTA_DEFERRED: ['SCHEDULED', 'CANCELED'],
  UPLOADING: ['PROCESSING', 'RETRY_WAIT', 'FAILED', 'PUBLISHED'],
  RETRY_WAIT: ['UPLOADING', 'FAILED', 'CANCELED'],
  PROCESSING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [],
  FAILED: ['SCHEDULED'],
  CANCELED: [],
};

export function canTransition<S extends string>(table: Table<S>, from: S, to: S): boolean {
  return table[from]?.includes(to) ?? false;
}

export function assertTransition<S extends string>(table: Table<S>, from: S, to: S, entity: string): void {
  if (!canTransition(table, from, to)) throw invalidState(`${entity}: ${from} → ${to} geçişi geçersiz`);
}
