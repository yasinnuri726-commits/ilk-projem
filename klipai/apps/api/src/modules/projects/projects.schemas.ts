// Yol: klipai/apps/api/src/modules/projects/projects.schemas.ts
import { z } from 'zod';
import { RIGHTS_BASES, RIGHTS_NOTE_REQUIRED, SettingsPatchSchema } from '@klipai/shared';
import { PageQuerySchema } from '../../common/pagination';
import { MAX_SOURCE_BYTES, MAX_SOURCE_DURATION_MS } from '../pipeline/pipeline.service';

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

export const RightsSchema = z
  .strictObject({
    basis: z.enum(RIGHTS_BASES),
    note: z.string().trim().max(500).optional(),
    evidenceUrl: z.url().max(2048).optional(),
    evidenceKey: z.string().max(300).optional(),
    termsVersion: z.string().min(1).max(32),
    accepted: z.literal(true),
  })
  .refine((r) => !RIGHTS_NOTE_REQUIRED.includes(r.basis) || (r.note?.length ?? 0) >= 3, {
    path: ['note'],
    message: 'Lisanslı ve izinli içerikte lisans / izin kaynağı yazılmalıdır',
  });

export const CreateProjectSchema = z.strictObject({
  channelId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  rights: RightsSchema,
  settingsOverride: SettingsPatchSchema.optional(),
});

export const ListProjectsSchema = PageQuerySchema.extend({
  channelId: z.uuid().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

export const UPLOAD_TYPES = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
} as const;

export const InitUploadSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(Object.keys(UPLOAD_TYPES) as [keyof typeof UPLOAD_TYPES, ...(keyof typeof UPLOAD_TYPES)[]]),
  sizeBytes: z.number().int().min(1).max(MAX_SOURCE_BYTES),
  durationMs: z.number().int().min(30_000).max(MAX_SOURCE_DURATION_MS),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const PresignPartsSchema = z.strictObject({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(50),
});

export const CompleteUploadSchema = z.strictObject({
  parts: z
    .array(z.strictObject({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10_000),
});

export const LinkSchema = z.strictObject({ url: z.url().max(2048) });

export const TranscriptQuerySchema = z.object({
  fromMs: z.coerce.number().int().min(0).optional(),
  toMs: z.coerce.number().int().min(0).optional(),
});
