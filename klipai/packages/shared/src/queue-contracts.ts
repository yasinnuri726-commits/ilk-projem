// Yol: klipai/packages/shared/src/queue-contracts.ts
//
// API (NestJS) ile video servisi (Python) arasındaki kuyruk sözleşmesi.
// Python eşi: services/video/app/contracts.py. İş yükleri yalnızca kimlik ve
// S3 anahtarı taşır; worker sonucu buradaki zod şemalarıyla doğrulanır.

import { z } from 'zod';
import { COMMENTARY_FORMATS } from './settings.schema';

export const QUEUES = {
  INGEST: 'ingest',
  ANALYZE: 'analyze',
  CANDIDATES: 'candidates',
  SCORE: 'score',
  EDIT: 'edit',
  ORIGINALIZE: 'originalize',
  METADATA: 'metadata',
  QC: 'qc',
  PUBLISH: 'publish',
  LEARN: 'learn',
  NOTIFY: 'notify',
  MAINTENANCE: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface QueuePolicy {
  attempts: number;
  backoff: { type: 'exponential' | 'fixed'; delay: number };
  /** Worker'ın kendi uyguladığı üst süre sınırı (ms). */
  timeoutMs: number;
}

export const QUEUE_POLICIES: Readonly<Record<QueueName, QueuePolicy>> = {
  ingest: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, timeoutMs: 30 * 60_000 },
  analyze: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 }, timeoutMs: 15 * 60_000 },
  candidates: { attempts: 3, backoff: { type: 'fixed', delay: 10_000 }, timeoutMs: 2 * 60_000 },
  score: { attempts: 4, backoff: { type: 'exponential', delay: 5_000 }, timeoutMs: 5 * 60_000 },
  edit: { attempts: 2, backoff: { type: 'exponential', delay: 30_000 }, timeoutMs: 10 * 60_000 },
  originalize: { attempts: 3, backoff: { type: 'exponential', delay: 15_000 }, timeoutMs: 10 * 60_000 },
  metadata: { attempts: 4, backoff: { type: 'exponential', delay: 5_000 }, timeoutMs: 3 * 60_000 },
  qc: { attempts: 2, backoff: { type: 'fixed', delay: 10_000 }, timeoutMs: 5 * 60_000 },
  publish: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, timeoutMs: 30 * 60_000 },
  learn: { attempts: 5, backoff: { type: 'exponential', delay: 600_000 }, timeoutMs: 2 * 60_000 },
  notify: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, timeoutMs: 30_000 },
  maintenance: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, timeoutMs: 30 * 60_000 },
};

/** Proje düzeyindeki aşamalar (PipelineJob) ve kuyrukları. */
export const PROJECT_STAGES = ['INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_QUEUE: Readonly<Record<ProjectStage, QueueName>> = {
  INGEST: QUEUES.INGEST,
  ANALYZE: QUEUES.ANALYZE,
  CANDIDATES: QUEUES.CANDIDATES,
  SCORE: QUEUES.SCORE,
};

/** Aşama çalışırken projenin bulunduğu durum. */
export const PROJECT_STAGE_STATUS = {
  INGEST: 'INGESTING',
  ANALYZE: 'ANALYZING',
  CANDIDATES: 'GENERATING_CANDIDATES',
  SCORE: 'SCORING',
} as const satisfies Record<ProjectStage, string>;

/** Aşamanın toplam proje ilerlemesindeki [başlangıç, bitiş] yüzdesi. */
export const PROJECT_STAGE_PROGRESS: Readonly<Record<ProjectStage, readonly [number, number]>> = {
  INGEST: [0, 15],
  ANALYZE: [15, 70],
  CANDIDATES: [70, 75],
  SCORE: [75, 100],
};

/** BullMQ iş kimliği. ":" kullanılamaz (BullMQ anahtar ayırıcısı). */
export function projectJobId(stage: ProjectStage, projectId: string): string {
  return `${stage.toLowerCase()}_${projectId}`;
}

/** Worker'ların iptal edilen projeyi anlamak için baktığı Redis anahtarı. */
export function cancelKey(projectId: string): string {
  return `klipai:cancel:project:${projectId}`;
}

// ───────────── Ortak ─────────────

export const JobCostSchema = z.object({
  gpuSeconds: z.number().min(0).default(0),
  cpuSeconds: z.number().min(0).default(0),
  llmInputTokens: z.number().int().min(0).default(0),
  llmOutputTokens: z.number().int().min(0).default(0),
  ttsCharacters: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
});
export type JobCost = z.infer<typeof JobCostSchema>;

interface BasePayload {
  projectId: string;
  channelId: string;
  traceId: string;
  /** Bu projenin tüm çıktılarının yazılacağı S3 öneki, ör. "projects/{id}/". */
  outputPrefix: string;
}

// ───────────── 1. Alım ─────────────

export interface IngestPayload extends BasePayload {
  source:
    | { type: 'UPLOAD'; storageKey: string }
    /** Worker bağlantı anında IP'yi yeniden doğrular (DNS yeniden bağlama koruması). */
    | { type: 'LINK'; url: string; maxBytes: number };
  /** Hedef orijinal anahtarı (LINK'te indirilen dosya buraya yazılır). */
  storageKey: string;
  maxDurationMs: number;
}

export const IngestResultSchema = z.object({
  storageKey: z.string().min(1),
  proxyKey: z.string().min(1),
  audioKey: z.string().min(1),
  thumbnailKey: z.string().min(1).nullable().default(null),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  hasAudio: z.boolean(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
  cost: JobCostSchema.default(() => JobCostSchema.parse({})),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

// ───────────── 2. Analiz ─────────────

export interface AnalyzePayload extends BasePayload {
  proxyKey: string;
  audioKey: string;
  durationMs: number;
  /** 'source' ise dil Whisper tarafından tespit edilir. */
  languageHint: string | null;
}

export const AnalysisKeysSchema = z.object({
  scenes: z.string().min(1),
  audioEnergy: z.string().min(1),
  diarization: z.string().min(1).nullable(),
  faces: z.string().min(1),
});
export type AnalysisKeys = z.infer<typeof AnalysisKeysSchema>;

export const AnalyzeResultSchema = z.object({
  language: z.string().min(2).max(10),
  model: z.string().min(1),
  /** Kelime düzeyi zaman damgaları (JSON.gz). */
  wordsKey: z.string().min(1),
  /** Cümle bölütleri: TranscriptSegmentFile biçiminde JSON. */
  segmentsKey: z.string().min(1),
  wordCount: z.number().int().min(0),
  speakerCount: z.number().int().min(1),
  analysisKeys: AnalysisKeysSchema,
  cost: JobCostSchema.default(() => JobCostSchema.parse({})),
});
export type AnalyzeResult = z.infer<typeof AnalyzeResultSchema>;

export const TranscriptSegmentFileSchema = z.object({
  segments: z.array(
    z.object({
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(0),
      speaker: z.string().nullable().default(null),
      text: z.string(),
    }),
  ),
});
export type TranscriptSegmentFile = z.infer<typeof TranscriptSegmentFileSchema>;

// ───────────── 3. Aday üretimi ─────────────

export interface CandidatesPayload extends BasePayload {
  durationMs: number;
  wordsKey: string;
  segmentsKey: string;
  analysisKeys: AnalysisKeys;
  minDurationSec: number;
  maxDurationSec: number;
  /** Puanlamaya gönderilecek en çok aday sayısı. */
  maxCandidates: number;
}

export const CandidateSignalsSchema = z.object({
  audioEnergy: z.number().min(0).max(1),
  sceneCuts: z.number().int().min(0),
  speakerTurns: z.number().int().min(0),
  faceRatio: z.number().min(0).max(1),
});

export const CandidatesResultSchema = z.object({
  candidates: z
    .array(
      z.object({
        startMs: z.number().int().min(0),
        endMs: z.number().int().positive(),
        text: z.string().min(1),
        signals: CandidateSignalsSchema,
      }),
    )
    .max(200),
  cost: JobCostSchema.default(() => JobCostSchema.parse({})),
});
export type CandidatesResult = z.infer<typeof CandidatesResultSchema>;

// ───────────── 4. Puanlama ─────────────

export interface ScorePayload extends BasePayload {
  language: string;
  candidates: { id: string; startMs: number; endMs: number; text: string; signals: unknown }[];
  /** Öğrenme aşamasından gelen kanal özeti; boş olabilir. */
  promptAddendum: string;
  tone: 'FUNNY' | 'SERIOUS' | 'INFORMATIVE';
}

const criterion = z.number().int().min(0).max(100);
export const ScoreBreakdownSchema = z.object({
  hook: criterion,
  emotion: criterion,
  standalone: criterion,
  curiosity: criterion,
  shareability: criterion,
});

export const ScoreResultSchema = z.object({
  promptVersion: z.string().min(1),
  scores: z.array(
    z.object({
      id: z.uuid(),
      breakdown: ScoreBreakdownSchema,
      rationale: z.string().max(1000),
      hookText: z.string().max(80),
      suggestedFormat: z.enum(COMMENTARY_FORMATS),
    }),
  ),
  cost: JobCostSchema.default(() => JobCostSchema.parse({})),
});
export type ScoreResult = z.infer<typeof ScoreResultSchema>;

export interface ProjectStagePayloads {
  INGEST: IngestPayload;
  ANALYZE: AnalyzePayload;
  CANDIDATES: CandidatesPayload;
  SCORE: ScorePayload;
}

export const PROJECT_STAGE_RESULT = {
  INGEST: IngestResultSchema,
  ANALYZE: AnalyzeResultSchema,
  CANDIDATES: CandidatesResultSchema,
  SCORE: ScoreResultSchema,
} as const;

/** Worker'ın job.updateProgress ile bildirdiği değer. */
export interface StageProgress {
  percent: number;
  etaSec?: number;
  note?: string;
}

// ───────────── Canlı olaylar (docs/api/websocket.md) ─────────────

export const REALTIME_CHANNEL = 'klipai:rt';
export const realtimeStreamKey = (topic: string): string => `klipai:rt:stream:${topic}`;

export interface RealtimeEnvelope<T = unknown> {
  id: string;
  topic: string;
  type: string;
  at: string;
  data: T;
}
