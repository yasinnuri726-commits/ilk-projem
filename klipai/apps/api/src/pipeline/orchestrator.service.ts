import { Injectable, Logger } from '@nestjs/common';
import type { Clip, ClipCandidate, PipelineJob, Prisma, Project, RenderJob } from '@prisma/client';
import { z } from 'zod';
import { ChannelSettings, DEFAULT_EDIT_SPEC, DEFAULT_SETTINGS, EditSpec, outputSize, PIPELINE_STAGES, PipelineStage, ProjectStatus, weightedScore } from '@klipai/shared';
import { EntitlementsService } from '../billing/entitlements.service';
import { AppError, invalidState } from '../common/errors';
import { PrismaService } from '../infra/infra.module';
import { NotificationsService } from '../notifications/notifications';
import { PublishingService } from '../publishing/publishing.service';
import { RealtimeService } from '../realtime/realtime';
import { QueuesService } from './queues';

export const jobEventSchema = z.object({
  kind: z.enum(['PIPELINE', 'RENDER']),
  stage: z.enum(PIPELINE_STAGES),
  type: z.enum(['STARTED', 'PROGRESS', 'SUCCEEDED', 'FAILED']),
  attempt: z.number().int().min(1).optional(),
  /** FAILED için: yeniden deneme hakkı kalmadı. */
  final: z.boolean().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string().max(60), message: z.string().max(2000), retryable: z.boolean().optional() }).optional(),
  usage: z.array(z.object({
    kind: z.enum(['COST_LLM', 'COST_GPU', 'COST_TTS', 'COST_STORAGE']), provider: z.string().optional(), quantity: z.number(), unit: z.string().optional(), costMicroUsd: z.number(),
  })).optional(),
  workerId: z.string().max(120).optional(),
});
export type JobEvent = z.infer<typeof jobEventSchema>;

type ProjectStage = 'INGEST' | 'ANALYZE' | 'CANDIDATES' | 'SCORE';
type ClipStage = 'COMMENTARY' | 'EDIT' | 'METADATA' | 'QC';

const PROJECT_FLOW: ProjectStage[] = ['INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE'];
const STAGE_STATUS: Record<ProjectStage, ProjectStatus> = { INGEST: 'INGESTING', ANALYZE: 'ANALYZING', CANDIDATES: 'GENERATING', SCORE: 'SCORING' };
/** Toplam ilerlemede her aşamanın [başlangıç, bitiş] yüzdesi. */
const PROJECT_SPAN: Record<ProjectStage, [number, number]> = { INGEST: [0, 15], ANALYZE: [15, 70], CANDIDATES: [70, 75], SCORE: [75, 100] };
const CLIP_SPAN: Record<ClipStage, [number, number]> = { COMMENTARY: [0, 15], EDIT: [15, 80], METADATA: [80, 90], QC: [90, 100] };
const span = ([a, b]: [number, number], p: number) => Math.round(a + ((b - a) * p) / 100);

interface CandidateOut { startSec: number; endSec: number; text: string; features?: Record<string, unknown> }
interface ScoreOut { id: string; hook: number; emotion: number; standalone: number; curiosity: number; shareability: number; rationale: Record<string, unknown> }

@Injectable()
export class Orchestrator {
  private readonly log = new Logger('Orchestrator');

  constructor(
    private readonly db: PrismaService,
    private readonly queues: QueuesService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly entitlements: EntitlementsService,
    private readonly publishing: PublishingService,
  ) {}

  settingsOf(project: Pick<Project, 'settingsSnapshot'>): ChannelSettings {
    return { ...DEFAULT_SETTINGS, ...((project.settingsSnapshot as object | null) ?? {}) };
  }

  private async ownerOf(channelId: string): Promise<string> {
    return (await this.db.channel.findUniqueOrThrow({ where: { id: channelId }, select: { ownerId: true } })).ownerId;
  }

  // ═══════════════ Proje hattı ═══════════════

  /** Projeyi başlatır ya da başarısız olduğu aşamadan (veya verilen aşamadan) sürdürür. */
  async startProject(projectId: string, from?: ProjectStage): Promise<Project> {
    const project = await this.db.project.findUniqueOrThrow({ where: { id: projectId } });
    if (!['DRAFT', 'FAILED'].includes(project.status)) throw invalidState(`Proje ${project.status} durumunda başlatılamaz`);
    const ownerId = await this.ownerOf(project.channelId);
    await this.entitlements.assertHasCredits(ownerId);
    const stage: ProjectStage = from ?? (project.status === 'FAILED' && PROJECT_FLOW.includes(project.currentStage as ProjectStage) ? (project.currentStage as ProjectStage) : 'INGEST');
    await this.db.project.update({ where: { id: projectId }, data: { startedAt: project.startedAt ?? new Date(), errorCode: null, errorMessage: null } });
    await this.enqueueProjectStage(projectId, stage);
    return this.db.project.findUniqueOrThrow({ where: { id: projectId } });
  }

  private async enqueueProjectStage(projectId: string, stage: ProjectStage): Promise<void> {
    const project = await this.db.project.findUniqueOrThrow({ where: { id: projectId }, include: { sourceVideo: true, transcript: true, channel: true } });
    const src = project.sourceVideo!;
    const s = this.settingsOf(project);
    let payload: Record<string, unknown>;

    if (stage === 'INGEST') {
      payload = { source: { type: src.type, storageKey: src.storageKey, url: src.sourceUrl } };
    } else if (stage === 'ANALYZE') {
      payload = { proxyKey: src.proxyKey, audioKey: src.audioKey, languageHint: s.subtitle.language === 'auto' ? null : s.subtitle.language, durationSec: src.durationSec };
    } else if (stage === 'CANDIDATES') {
      payload = { minDurationSec: s.minDurationSec, maxDurationSec: s.maxDurationSec, maxCandidates: Math.max(12, s.maxClipsPerVideo * 4), durationSec: src.durationSec };
    } else {
      const [candidates, insight] = await Promise.all([
        this.db.clipCandidate.findMany({ where: { projectId, status: 'PENDING_SCORE' }, orderBy: { startSec: 'asc' } }),
        this.db.learningInsight.findFirst({ where: { channelId: project.channelId, active: true }, orderBy: { version: 'desc' } }),
      ]);
      payload = {
        candidates: candidates.map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, text: c.text, features: c.features })),
        language: project.transcript?.language ?? 'tr', videoTitle: project.title, channelTitle: project.channel.title, insights: insight?.summary ?? null,
      };
    }

    const ownerId = project.channel.ownerId;
    const { limits } = await this.entitlements.get(ownerId);
    const job = await this.db.pipelineJob.create({ data: { projectId, stage, input: payload as Prisma.InputJsonObject } });
    await this.db.project.update({ where: { id: projectId }, data: { status: STAGE_STATUS[stage], currentStage: stage, progress: PROJECT_SPAN[stage][0] } });
    await this.queues.addStage({ jobId: job.id, kind: 'PIPELINE', stage, projectId, payload }, limits.queuePriority);
    await this.db.pipelineJob.update({ where: { id: job.id }, data: { queueJobId: job.id } });
    await this.emitProject(projectId);
  }

  async cancelProject(projectId: string): Promise<Project> {
    const project = await this.db.project.findUniqueOrThrow({ where: { id: projectId } });
    if (!['INGESTING', 'ANALYZING', 'GENERATING', 'SCORING', 'DRAFT'].includes(project.status)) throw invalidState(`Proje ${project.status} durumunda iptal edilemez`);
    const jobs = await this.db.pipelineJob.findMany({ where: { projectId, status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } } });
    for (const j of jobs) await this.queues.remove(this.queueOf(j.stage), j.id);
    await this.db.pipelineJob.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { status: 'CANCELED', finishedAt: new Date() } });
    const updated = await this.db.project.update({ where: { id: projectId }, data: { status: 'CANCELED' } });
    await this.entitlements.refundCredits(await this.ownerOf(project.channelId), projectId);
    await this.emitProject(projectId);
    return updated;
  }

  private queueOf(stage: PipelineStage) {
    return stage.toLowerCase() as 'ingest';
  }

  private async emitProject(projectId: string, stageProgress = 0) {
    const p = await this.db.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.realtime.toChannel(p.channelId, 'project.progress', { projectId, status: p.status, stage: p.currentStage, stageProgress, progress: p.progress });
  }

  // ═══════════════ Klip hattı ═══════════════

  /** Adaydan klip oluşturur, aylık haktan düşer ve kurgu hattını başlatır. */
  async createClipFromCandidate(candidate: ClipCandidate, range?: { startSec?: number; endSec?: number }): Promise<Clip> {
    if (candidate.status === 'ACCEPTED') throw invalidState('Aday zaten kabul edilmiş');
    const project = await this.db.project.findUniqueOrThrow({ where: { id: candidate.projectId }, include: { sourceVideo: true } });
    const s = this.settingsOf(project);
    const ownerId = await this.ownerOf(project.channelId);
    const startSec = range?.startSec ?? candidate.startSec;
    const endSec = range?.endSec ?? candidate.endSec;
    const max = project.sourceVideo?.durationSec ?? Infinity;
    if (startSec < 0 || endSec > max + 0.5 || endSec - startSec < 5 || endSec - startSec > 180) throw new AppError(422, 'VALIDATION_FAILED', 'Kesit aralığı geçersiz');

    const rationale = (candidate.rationale as { suggestedHook?: string } | null) ?? {};
    const editSpec: EditSpec = { ...DEFAULT_EDIT_SPEC, subtitles: { enabled: s.subtitle.enabled, words: [] }, hook: { text: rationale.suggestedHook ?? '', durationSec: 2 }, music: { trackId: null, levelDb: s.audio.musicLevelDb, ducking: true } };
    const e = await this.entitlements.get(ownerId);
    const clip = await this.db.$transaction(async (tx) => {
      const updated = await tx.clipCandidate.updateMany({ where: { id: candidate.id, status: { not: 'ACCEPTED' } }, data: { status: 'ACCEPTED' } });
      if (updated.count === 0) throw invalidState('Aday zaten kabul edilmiş');
      return tx.clip.create({
        data: {
          projectId: project.id, channelId: project.channelId, candidateId: candidate.id, status: 'CANDIDATE', startSec, endSec,
          aspectRatio: s.aspectRatio, resolution: this.entitlements.resolution(e, s.resolution), watermarked: e.limits.watermark,
          editSpec: editSpec as unknown as Prisma.InputJsonObject, hookText: editSpec.hook.text || null, commentaryFormat: s.commentaryFormat,
        },
      });
    });
    try {
      await this.entitlements.consumeClip(ownerId, clip.id, project.id);
    } catch (err) {
      await this.db.$transaction([this.db.clip.delete({ where: { id: clip.id } }), this.db.clipCandidate.update({ where: { id: candidate.id }, data: { status: 'SCORED' } })]);
      throw err;
    }
    return this.startClipPipeline(clip.id);
  }

  /** Kurgu hattını başlatır: (COMMENTARY) → EDIT → (METADATA) → QC. */
  async startClipPipeline(clipId: string, opts: { regenerateCommentary?: boolean } = {}): Promise<Clip> {
    const clip = await this.db.clip.findUniqueOrThrow({ where: { id: clipId } });
    if (!['CANDIDATE', 'READY', 'FAILED'].includes(clip.status)) throw invalidState(`Klip ${clip.status} durumunda kurgulanamaz`);
    const updated = await this.db.clip.update({ where: { id: clipId }, data: { status: 'EDITING', qcStatus: 'PENDING', errorCode: null, errorMessage: null } });
    const needsCommentary = clip.commentaryFormat !== 'NONE' && (opts.regenerateCommentary || !clip.commentaryAudioKey);
    await this.enqueueClipStage(clipId, needsCommentary ? 'COMMENTARY' : 'EDIT', { chain: true, regenerate: !!opts.regenerateCommentary });
    await this.emitClip(updated);
    return updated;
  }

  /** Yalnızca meta veriyi (veya kapağı) yeniden üretir; çıktı videosu değişmez. */
  async regenerateMetadata(clipId: string, instruction?: string, thumbnailOnly = false): Promise<void> {
    const clip = await this.db.clip.findUniqueOrThrow({ where: { id: clipId } });
    if (clip.status !== 'READY' || !clip.outputKey) throw invalidState('Meta veri yalnızca hazır klipte yeniden üretilebilir');
    await this.enqueueClipStage(clipId, 'METADATA', { chain: false, regenerate: true, instruction, thumbnailOnly });
  }

  private async enqueueClipStage(clipId: string, stage: ClipStage, flags: { chain: boolean; regenerate?: boolean; instruction?: string; thumbnailOnly?: boolean }): Promise<void> {
    const clip = await this.db.clip.findUniqueOrThrow({ where: { id: clipId }, include: { project: { include: { sourceVideo: true, transcript: true, channel: true } }, candidate: true } });
    const project = clip.project;
    const src = project.sourceVideo!;
    const s = this.settingsOf(project);
    const editSpec = { ...DEFAULT_EDIT_SPEC, ...(clip.editSpec as object) } as EditSpec;
    const size = outputSize(clip.aspectRatio, clip.resolution);
    const language = project.transcript?.language ?? 'tr';
    const analysis = { wordsKey: project.transcript?.wordsKey, facesKey: src.facesKey, scenesKey: src.scenesKey, audioEnergyKey: src.audioEnergyKey };
    const insight = await this.db.learningInsight.findFirst({ where: { channelId: clip.channelId, active: true }, orderBy: { version: 'desc' } });
    let payload: Record<string, unknown>;

    if (stage === 'COMMENTARY') {
      payload = {
        ...analysis, startSec: clip.startSec, endSec: clip.endSec, language, format: clip.commentaryFormat, tone: s.commentaryTone, customPrompt: s.commentaryPrompt,
        maxSec: s.commentaryMaxSec, script: flags.regenerate ? null : clip.commentaryScript, tts: { voice: s.audio.ttsVoice, speed: s.audio.ttsSpeed },
        videoTitle: project.title, version: clip.version,
      };
    } else if (stage === 'EDIT') {
      payload = {
        ...analysis, sourceKey: src.storageKey, sourceWidth: src.width, sourceHeight: src.height, startSec: clip.startSec, endSec: clip.endSec, width: size.width, height: size.height,
        aspectRatio: clip.aspectRatio, watermarked: clip.watermarked, editSpec, language, version: clip.version,
        subtitleStyle: s.subtitle, audio: s.audio, brand: s.brand,
        commentary: clip.commentaryAudioKey && clip.commentaryFormat !== 'NONE' ? { audioKey: clip.commentaryAudioKey, format: clip.commentaryFormat } : null,
      };
    } else if (stage === 'METADATA') {
      payload = {
        ...analysis, startSec: clip.startSec, endSec: clip.endSec, language, titleLanguage: s.titleLanguage, hookText: clip.hookText, commentaryScript: clip.commentaryScript,
        fixedTags: s.fixedTags, videoTitle: project.title, channelTitle: project.channel.title, insights: insight?.summary ?? null, instruction: flags.instruction ?? null,
        outputKey: clip.outputKey, frameKey: clip.frameKey, width: size.width, height: size.height, version: clip.version,
        thumbnailOnly: !!flags.thumbnailOnly, currentTitle: clip.title, brand: s.brand,
      };
    } else {
      payload = {
        outputKey: clip.outputKey, width: size.width, height: size.height, version: clip.version,
        minDurationSec: 5, maxDurationSec: clip.aspectRatio === 'PORTRAIT_9_16' ? 180 : 600, expectedDurationSec: clip.durationSec,
        subtitles: { enabled: editSpec.subtitles.enabled, fontSize: s.subtitle.fontSize, words: editSpec.subtitles.words },
      };
    }

    const { limits } = await this.entitlements.get(project.channel.ownerId);
    const job = await this.db.renderJob.create({ data: { clipId, stage, priority: limits.queuePriority, specSnapshot: { editSpec, flags } as unknown as Prisma.InputJsonObject } });
    await this.queues.addStage({ jobId: job.id, kind: 'RENDER', stage, projectId: project.id, clipId, payload }, limits.queuePriority);
    await this.db.renderJob.update({ where: { id: job.id }, data: { queueJobId: job.id } });
  }

  private async emitClip(clip: Clip) {
    await this.realtime.toChannel(clip.channelId, 'clip.updated', { clipId: clip.id, status: clip.status, qcStatus: clip.qcStatus, version: clip.version });
  }

  // ═══════════════ Worker olayları ═══════════════

  async handleEvent(jobId: string, ev: JobEvent): Promise<void> {
    if (ev.kind === 'PIPELINE') {
      const job = await this.db.pipelineJob.findUnique({ where: { id: jobId } });
      if (job && job.stage === ev.stage) await this.onPipelineEvent(job, ev);
    } else {
      const job = await this.db.renderJob.findUnique({ where: { id: jobId } });
      if (job && job.stage === ev.stage) await this.onRenderEvent(job, ev);
    }
  }

  private terminal(status: string) {
    return status === 'SUCCEEDED' || status === 'CANCELED' || status === 'FAILED';
  }

  private async logUsage(ownerId: string, ev: JobEvent, ids: { projectId?: string; clipId?: string }): Promise<bigint> {
    let total = 0;
    for (const u of ev.usage ?? []) {
      total += u.costMicroUsd;
      await this.entitlements.logCost(ownerId, u.kind, { ...ids, provider: u.provider, quantity: u.quantity, unit: u.unit, costMicroUsd: u.costMicroUsd });
    }
    return BigInt(Math.round(total));
  }

  private async onPipelineEvent(job: PipelineJob, ev: JobEvent): Promise<void> {
    if (this.terminal(job.status)) return; // geç veya yinelenen olay
    const stage = job.stage as ProjectStage;
    const project = await this.db.project.findUniqueOrThrow({ where: { id: job.projectId } });
    if (project.status === 'CANCELED') return;
    const ownerId = await this.ownerOf(project.channelId);

    if (ev.type === 'STARTED') {
      await this.db.pipelineJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date(), attempt: ev.attempt ?? job.attempt + 1, workerId: ev.workerId } });
      return;
    }
    if (ev.type === 'PROGRESS') {
      const p = ev.progress ?? 0;
      await this.db.pipelineJob.update({ where: { id: job.id }, data: { progress: p } });
      await this.db.project.update({ where: { id: project.id }, data: { progress: span(PROJECT_SPAN[stage], p) } });
      if (await this.realtime.throttled(`p:${project.id}`)) await this.emitProject(project.id, p);
      return;
    }
    if (ev.type === 'FAILED') {
      const error = ev.error ?? { code: 'INTERNAL', message: 'Bilinmeyen hata' };
      if (!ev.final) {
        await this.db.pipelineJob.update({ where: { id: job.id }, data: { status: 'RETRYING', errorCode: error.code, errorMessage: error.message } });
        return;
      }
      await this.db.pipelineJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: error.code, errorMessage: error.message, finishedAt: new Date() } });
      await this.failProject(project, stage, error, ownerId);
      return;
    }

    // SUCCEEDED
    const cost = await this.logUsage(ownerId, ev, { projectId: project.id });
    await this.db.pipelineJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', progress: 100, output: (ev.output ?? {}) as Prisma.InputJsonObject, costMicroUsd: cost, finishedAt: new Date() } });
    await this.db.project.update({ where: { id: project.id }, data: { costMicroUsd: { increment: cost }, progress: PROJECT_SPAN[stage][1] } });
    const out = ev.output ?? {};

    if (stage === 'INGEST') {
      const o = out as { storageKey: string; proxyKey: string; audioKey: string; thumbnailKey?: string; durationSec: number; width: number; height: number; fps: number; videoCodec?: string; audioCodec?: string; sizeBytes: number; checksumSha256?: string };
      await this.db.sourceVideo.update({
        where: { projectId: project.id },
        data: { status: 'READY', storageKey: o.storageKey, proxyKey: o.proxyKey, audioKey: o.audioKey, thumbnailKey: o.thumbnailKey, durationSec: o.durationSec, width: o.width, height: o.height, fps: o.fps, videoCodec: o.videoCodec, audioCodec: o.audioCodec, sizeBytes: BigInt(Math.round(o.sizeBytes)), checksumSha256: o.checksumSha256 },
      });
      const charge = await this.entitlements.consumeCredits(ownerId, project.id, o.durationSec);
      if (!charge.ok) {
        await this.failProject(project, stage, { code: 'CREDITS_EXHAUSTED', message: `Bu video ${charge.credits} dakika kredi gerektiriyor` }, ownerId);
        return;
      }
      await this.enqueueProjectStage(project.id, 'ANALYZE');
    } else if (stage === 'ANALYZE') {
      const o = out as { language: string; text: string; segments: unknown[]; wordsKey: string; speakers: unknown[]; wordCount: number; scenesKey: string; audioEnergyKey: string; facesKey: string };
      const data = { language: o.language, text: o.text, segments: o.segments as Prisma.InputJsonArray, wordsKey: o.wordsKey, speakers: o.speakers as Prisma.InputJsonArray, wordCount: o.wordCount };
      await this.db.transcript.upsert({ where: { projectId: project.id }, update: data, create: { projectId: project.id, ...data } });
      await this.db.sourceVideo.update({ where: { projectId: project.id }, data: { language: o.language, scenesKey: o.scenesKey, audioEnergyKey: o.audioEnergyKey, facesKey: o.facesKey } });
      await this.enqueueProjectStage(project.id, 'CANDIDATES');
    } else if (stage === 'CANDIDATES') {
      const list = ((out as { candidates?: CandidateOut[] }).candidates ?? []).filter((c) => c.endSec > c.startSec);
      if (!list.length) {
        await this.failProject(project, stage, { code: 'NO_CANDIDATES', message: 'Bu videoda uygun kesit bulunamadı (konuşma çok az olabilir)' }, ownerId);
        return;
      }
      await this.db.clipCandidate.deleteMany({ where: { projectId: project.id, status: { not: 'ACCEPTED' } } });
      await this.db.clipCandidate.createMany({
        data: list.map((c) => ({ projectId: project.id, startSec: c.startSec, endSec: c.endSec, durationSec: c.endSec - c.startSec, text: c.text.slice(0, 8000), features: (c.features ?? {}) as Prisma.InputJsonObject })),
      });
      await this.enqueueProjectStage(project.id, 'SCORE');
    } else {
      await this.applyScores(project, out as { scores?: ScoreOut[]; promptVersion?: string }, ownerId);
    }
  }

  private async applyScores(project: Project, out: { scores?: ScoreOut[]; promptVersion?: string }, ownerId: string) {
    const s = this.settingsOf(project);
    const scored = (out.scores ?? []).map((r) => ({ ...r, total: weightedScore(r) })).sort((a, b) => b.total - a.total);
    await this.db.$transaction(
      scored.map((r, i) =>
        this.db.clipCandidate.updateMany({
          where: { id: r.id, projectId: project.id, status: 'PENDING_SCORE' },
          data: {
            score: r.total, hookScore: r.hook, emotionScore: r.emotion, standaloneScore: r.standalone, curiosityScore: r.curiosity, shareabilityScore: r.shareability,
            rationale: r.rationale as Prisma.InputJsonObject, promptVersion: out.promptVersion, rank: i + 1, status: r.total >= s.minScore ? 'SCORED' : 'BELOW_THRESHOLD',
          },
        }),
      ),
    );
    // LLM'in puan döndürmediği adaylar listede kalmasın.
    await this.db.clipCandidate.updateMany({ where: { projectId: project.id, status: 'PENDING_SCORE' }, data: { status: 'BELOW_THRESHOLD', score: 0 } });
    await this.db.project.update({ where: { id: project.id }, data: { status: 'READY', currentStage: null, progress: 100, completedAt: new Date() } });
    const count = await this.db.clipCandidate.count({ where: { projectId: project.id, status: 'SCORED' } });
    await this.emitProject(project.id, 100);
    await this.realtime.toChannel(project.channelId, 'project.ready', { projectId: project.id, candidateCount: count, topScore: scored[0]?.total ?? null });
    await this.notifications.notifyChannel(project.channelId, 'PROJECT_READY', { title: project.title, count }, `/project/${project.id}/candidates`);

    if (s.automationMode !== 'DRAFT_ONLY') {
      const top = await this.db.clipCandidate.findMany({ where: { projectId: project.id, status: 'SCORED' }, orderBy: { score: 'desc' }, take: s.maxClipsPerVideo });
      for (const c of top) {
        if (!(await this.entitlements.hasClipQuota(ownerId))) break;
        await this.createClipFromCandidate(c).catch((e) => this.log.warn(`otomatik kabul başarısız (${c.id}): ${e}`));
      }
    }
  }

  private async failProject(project: Project, stage: ProjectStage, error: { code: string; message: string }, ownerId: string) {
    await this.db.project.update({ where: { id: project.id }, data: { status: 'FAILED', currentStage: stage, errorCode: error.code, errorMessage: error.message } });
    if (stage === 'INGEST' || error.code === 'NO_CANDIDATES') await this.entitlements.refundCredits(ownerId, project.id);
    await this.realtime.toChannel(project.channelId, 'project.failed', { projectId: project.id, stage, error });
    await this.notifications.notifyChannel(project.channelId, 'PROJECT_FAILED', { title: project.title }, `/project/${project.id}`);
  }

  private async onRenderEvent(job: RenderJob, ev: JobEvent): Promise<void> {
    if (this.terminal(job.status)) return;
    const stage = job.stage as ClipStage;
    const clip = await this.db.clip.findUnique({ where: { id: job.clipId } });
    if (!clip) return;
    const flags = ((job.specSnapshot as { flags?: { chain?: boolean; thumbnailOnly?: boolean } }).flags ?? {}) as { chain?: boolean; thumbnailOnly?: boolean };
    const ownerId = await this.ownerOf(clip.channelId);

    if (ev.type === 'STARTED') {
      await this.db.renderJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date(), attempt: ev.attempt ?? job.attempt + 1, workerId: ev.workerId } });
      return;
    }
    if (ev.type === 'PROGRESS') {
      await this.db.renderJob.update({ where: { id: job.id }, data: { progress: ev.progress ?? 0 } });
      if (flags.chain && (await this.realtime.throttled(`c:${clip.id}`))) {
        await this.realtime.toChannel(clip.channelId, 'clip.progress', { clipId: clip.id, projectId: clip.projectId, stage, progress: span(CLIP_SPAN[stage], ev.progress ?? 0) });
      }
      return;
    }
    if (ev.type === 'FAILED') {
      const error = ev.error ?? { code: 'INTERNAL', message: 'Bilinmeyen hata' };
      if (!ev.final) {
        await this.db.renderJob.update({ where: { id: job.id }, data: { status: 'RETRYING', errorCode: error.code, errorMessage: error.message } });
        return;
      }
      await this.db.renderJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: error.code, errorMessage: error.message, finishedAt: new Date() } });
      if (flags.chain) {
        const failed = await this.db.clip.update({ where: { id: clip.id }, data: { status: 'FAILED', errorCode: error.code, errorMessage: error.message } });
        await this.emitClip(failed);
      }
      await this.realtime.toChannel(clip.channelId, 'clip.failed', { clipId: clip.id, stage, error });
      return;
    }

    // SUCCEEDED
    const cost = await this.logUsage(ownerId, ev, { projectId: clip.projectId, clipId: clip.id });
    const gpuSeconds = (ev.usage ?? []).filter((u) => u.kind === 'COST_GPU').reduce((s, u) => s + u.quantity, 0);
    await this.db.renderJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', progress: 100, output: (ev.output ?? {}) as Prisma.InputJsonObject, costMicroUsd: cost, gpuSeconds, finishedAt: new Date() } });
    await this.db.project.update({ where: { id: clip.projectId }, data: { costMicroUsd: { increment: cost } } });
    const out = ev.output ?? {};

    if (stage === 'COMMENTARY') {
      const o = out as { script: string; audioKey: string };
      await this.db.clip.update({ where: { id: clip.id }, data: { commentaryScript: o.script, commentaryAudioKey: o.audioKey } });
      if (flags.chain) await this.enqueueClipStage(clip.id, 'EDIT', { chain: true });
    } else if (stage === 'EDIT') {
      const o = out as { outputKey: string; frameKey?: string; durationSec: number; sizeBytes: number; loudnessLufs?: number; editSpec?: EditSpec };
      const updated = await this.db.clip.update({
        where: { id: clip.id },
        data: {
          outputKey: o.outputKey, frameKey: o.frameKey, durationSec: o.durationSec, sizeBytes: BigInt(Math.round(o.sizeBytes)), loudnessLufs: o.loudnessLufs,
          ...(o.editSpec ? { editSpec: o.editSpec as unknown as Prisma.InputJsonObject, hookText: o.editSpec.hook?.text || clip.hookText } : {}),
        },
      });
      if (flags.chain) await this.enqueueClipStage(clip.id, updated.title ? 'QC' : 'METADATA', { chain: true });
    } else if (stage === 'METADATA') {
      const o = out as { titles?: string[]; description?: string; tags?: string[]; hashtags?: string[]; thumbnailKey?: string };
      const updated = await this.db.clip.update({
        where: { id: clip.id },
        data: flags.thumbnailOnly
          ? { thumbnailKey: o.thumbnailKey ?? clip.thumbnailKey }
          : { title: o.titles?.[0] ?? clip.title, titleAlternatives: o.titles ?? clip.titleAlternatives, description: o.description ?? clip.description, tags: o.tags ?? clip.tags, hashtags: o.hashtags ?? clip.hashtags, thumbnailKey: o.thumbnailKey ?? clip.thumbnailKey },
      });
      if (flags.chain) await this.enqueueClipStage(clip.id, 'QC', { chain: true });
      else await this.emitClip(updated);
    } else {
      const o = out as { status: 'PASSED' | 'AUTO_FIXED' | 'FLAGGED'; report: unknown[]; outputKey?: string; loudnessLufs?: number; durationSec?: number; sizeBytes?: number };
      const ready = await this.db.clip.update({
        where: { id: clip.id },
        data: {
          status: 'READY', qcStatus: o.status, qcReport: o.report as Prisma.InputJsonArray, outputKey: o.outputKey ?? clip.outputKey, loudnessLufs: o.loudnessLufs ?? clip.loudnessLufs,
          durationSec: o.durationSec ?? clip.durationSec, sizeBytes: o.sizeBytes ? BigInt(Math.round(o.sizeBytes)) : clip.sizeBytes,
        },
      });
      await this.emitClip(ready);
      await this.publishing.autoPlan(ready, ownerId);
    }
  }
}
