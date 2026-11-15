// Yol: klipai/apps/api/src/modules/projects/projects.service.ts
import { Injectable } from '@nestjs/common';
import {
  applySettingsPatch,
  type Permission,
  PROJECT_STAGES,
  resolutionAllowed,
  RIGHTS_TERMS,
} from '@klipai/shared';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception';
import { type Page, toPage } from '../../common/pagination';
import { sha256 } from '../../infra/crypto.service';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { ChannelAccessService } from '../channels/channel-access.service';
import { PipelineService, projectPrefix } from '../pipeline/pipeline.service';
import {
  PROJECT_INCLUDE,
  type ProjectRow,
  toProjectDto,
  toStageJobDto,
} from './project.mapper';
import type { CreateProjectSchema, ListProjectsSchema, TranscriptQuerySchema } from './projects.schemas';

const TERMS_HASH = sha256(`${RIGHTS_TERMS.tr}\n${RIGHTS_TERMS.en}`);

export interface ClientMeta {
  ip: string;
  userAgent: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChannelAccessService,
    private readonly entitlements: EntitlementsService,
    private readonly storage: StorageService,
    private readonly pipeline: PipelineService,
  ) {}

  /** Projeyi yetki denetimiyle yükler; üye olunmayan kanalın projesi "yok" sayılır. */
  async load(userId: string, projectId: string, permission: Permission): Promise<ProjectRow> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, include: PROJECT_INCLUDE });
    if (!project) throw new AppException('NOT_FOUND');
    await this.access.require(userId, project.channelId, permission);
    return project;
  }

  async dto(project: ProjectRow): Promise<Record<string, unknown>> {
    const key = project.sourceVideo?.thumbnailKey;
    return toProjectDto(project, key ? await this.storage.presignGet(key, 3600) : null);
  }

  async create(
    userId: string,
    input: z.infer<typeof CreateProjectSchema>,
    client: ClientMeta,
  ): Promise<Record<string, unknown>> {
    const { channel } = await this.access.require(userId, input.channelId, 'project.create');
    if (input.rights.termsVersion !== RIGHTS_TERMS.version) throw new AppException('RIGHTS_TERMS_OUTDATED');

    // Kanal profilinin proje anındaki kopyası: sonradan yapılan ayar değişikliği bu projeyi etkilemez.
    let settings;
    try {
      settings = applySettingsPatch(await this.access.settingsFor(channel.id), input.settingsOverride ?? {});
    } catch {
      throw new AppException('VALIDATION_FAILED', 'settingsOverride geçersiz');
    }
    // Faturalanan hesap kanal sahibidir; plan sınırları ona göre uygulanır.
    const owner = await this.entitlements.accessFor(channel.ownerId);
    if (!resolutionAllowed(settings.resolution, owner.entitlements.maxResolution)) {
      // Açıkça istenen çözünürlük planı aşıyorsa reddedilir; kanal profilinden
      // gelen değer ise sessizce planın izin verdiği en yükseğe indirilir.
      if (input.settingsOverride?.resolution) {
        throw new AppException('PLAN_FEATURE_LOCKED', 'Bu çözünürlük planınızda yok');
      }
      settings = { ...settings, resolution: owner.entitlements.maxResolution };
    }
    if (owner.creditsRemaining !== null && owner.creditsRemaining <= 0) {
      throw new AppException('INSUFFICIENT_CREDITS');
    }

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          channelId: channel.id,
          createdById: userId,
          title: input.title,
          settingsSnapshot: { ...settings, watermark: owner.entitlements.watermark },
        },
      });
      await tx.rightsDeclaration.create({
        data: {
          projectId: created.id,
          userId,
          basis: input.rights.basis,
          note: input.rights.note,
          evidenceUrl: input.rights.evidenceUrl,
          evidenceKey: input.rights.evidenceKey,
          termsVersion: RIGHTS_TERMS.version,
          termsHash: TERMS_HASH,
          ip: client.ip,
          userAgent: client.userAgent.slice(0, 500),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          channelId: channel.id,
          action: 'project.create',
          entity: 'Project',
          entityId: created.id,
          meta: { rightsBasis: input.rights.basis },
        },
      });
      return tx.project.findUniqueOrThrow({ where: { id: created.id }, include: PROJECT_INCLUDE });
    });
    return this.dto(project);
  }

  async list(userId: string, query: z.infer<typeof ListProjectsSchema>): Promise<Page<Record<string, unknown>>> {
    const channelIds = await this.access.channelIdsFor(userId);
    if (query.channelId && !channelIds.includes(query.channelId)) throw new AppException('NOT_FOUND');
    const rows = await this.prisma.project.findMany({
      where: {
        channelId: query.channelId ?? { in: channelIds },
        status: query.status,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      include: PROJECT_INCLUDE,
    });
    const page = toPage(rows, query.limit);
    return { items: await Promise.all(page.rows.map((p) => this.dto(p))), nextCursor: page.nextCursor };
  }

  async detail(userId: string, projectId: string): Promise<Record<string, unknown>> {
    const project = await this.load(userId, projectId, 'channel.read');
    const [jobs, rights, charge] = await Promise.all([
      this.prisma.pipelineJob.findMany({ where: { projectId } }),
      this.prisma.rightsDeclaration.findUnique({ where: { projectId } }),
      this.prisma.usageLog.findUnique({ where: { idempotencyKey: `minutes:${projectId}` } }),
    ]);
    const order = (stage: string): number => (PROJECT_STAGES as readonly string[]).indexOf(stage);
    const source = project.sourceVideo;
    return {
      ...(await this.dto(project)),
      jobs: jobs.sort((a, b) => order(a.stage) - order(b.stage)).map(toStageJobDto),
      rights: rights ? { basis: rights.basis, acceptedAt: rights.acceptedAt.toISOString() } : null,
      source: source
        ? {
            ingestType: source.ingestType,
            status: source.status,
            originalName: source.originalName,
            sizeBytes: source.sizeBytes === null ? null : Number(source.sizeBytes),
            width: source.width,
            height: source.height,
          }
        : null,
      creditsCharged: charge ? -charge.credits : 0,
    };
  }

  async cancel(userId: string, projectId: string): Promise<Record<string, unknown>> {
    await this.load(userId, projectId, 'project.create');
    await this.pipeline.cancel(projectId);
    return this.dto(await this.load(userId, projectId, 'channel.read'));
  }

  async retry(userId: string, projectId: string): Promise<Record<string, unknown>> {
    const project = await this.load(userId, projectId, 'project.create');
    if (project.status !== 'FAILED') throw new AppException('INVALID_STATE');
    await this.pipeline.retry(projectId);
    return this.dto(await this.load(userId, projectId, 'channel.read'));
  }

  /** Çalışan işleri durdurur, depolamadaki tüm dosyaları ve kaydı siler. Hak beyanı saklanır. */
  async remove(userId: string, projectId: string): Promise<void> {
    const project = await this.load(userId, projectId, 'project.delete');
    await this.pipeline.cancel(projectId, { allowTerminal: true });
    await this.storage.deletePrefix(projectPrefix(projectId));
    await this.prisma.$transaction([
      this.prisma.project.delete({ where: { id: projectId } }),
      this.prisma.auditLog.create({
        data: {
          actorId: userId,
          channelId: project.channelId,
          action: 'project.delete',
          entity: 'Project',
          entityId: projectId,
        },
      }),
    ]);
  }

  async transcript(
    userId: string,
    projectId: string,
    query: z.infer<typeof TranscriptQuerySchema>,
  ): Promise<Record<string, unknown>> {
    const project = await this.load(userId, projectId, 'channel.read');
    const transcript = project.sourceVideo
      ? await this.prisma.transcript.findUnique({ where: { sourceVideoId: project.sourceVideo.id } })
      : null;
    if (!transcript) throw new AppException('NOT_FOUND');
    const segments = await this.prisma.transcriptSegment.findMany({
      where: {
        transcriptId: transcript.id,
        ...(query.fromMs !== undefined ? { endMs: { gte: query.fromMs } } : {}),
        ...(query.toMs !== undefined ? { startMs: { lte: query.toMs } } : {}),
      },
      orderBy: { index: 'asc' },
      select: { index: true, startMs: true, endMs: true, speaker: true, text: true },
    });
    return {
      language: transcript.language,
      speakerCount: transcript.speakerCount,
      wordsUrl: await this.storage.presignGet(transcript.wordsKey, 600),
      segments,
    };
  }
}
