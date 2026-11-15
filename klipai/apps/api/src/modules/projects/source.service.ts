// Yol: klipai/apps/api/src/modules/projects/source.service.ts
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { PipelineService, projectPrefix } from '../pipeline/pipeline.service';
import type { ProjectRow } from './project.mapper';
import {
  type CompleteUploadSchema,
  type InitUploadSchema,
  UPLOAD_TYPES,
} from './projects.schemas';
import { ProjectsService } from './projects.service';
import { assertIngestableUrl } from './url-guard';

const MIB = 1024 * 1024;
const MIN_PART = 16 * MIB;
const MAX_PARTS = 9000;
const SESSION_TTL_MS = 48 * 3_600_000;

export interface UploadSessionDto {
  uploadId: string;
  partSize: number;
  partCount: number;
  uploadedParts: { partNumber: number; etag: string; size: number }[];
  expiresAt: string;
}

/**
 * Alım (aşama 1'in istemci tarafı): parçalı, devam ettirilebilir yükleme ve
 * bağlantıdan alım. Dosya API'den geçmez; istemci imzalı adreslerle doğrudan
 * depolamaya yazar.
 */
@Injectable()
export class SourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly entitlements: EntitlementsService,
    private readonly pipeline: PipelineService,
    private readonly projects: ProjectsService,
  ) {}

  private async draft(userId: string, projectId: string): Promise<ProjectRow> {
    const project = await this.projects.load(userId, projectId, 'project.create');
    if (project.status !== 'DRAFT') throw new AppException('INVALID_STATE');
    return project;
  }

  private async ownerOf(project: ProjectRow): Promise<string> {
    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: project.channelId },
      select: { ownerId: true },
    });
    return channel.ownerId;
  }

  private session(source: { uploadId: string | null; partSize: number | null; sizeBytes: bigint | null; updatedAt: Date },
    uploadedParts: UploadSessionDto['uploadedParts'],
  ): UploadSessionDto {
    const partSize = source.partSize!;
    return {
      uploadId: source.uploadId!,
      partSize,
      partCount: Math.ceil(Number(source.sizeBytes) / partSize),
      uploadedParts,
      expiresAt: new Date(source.updatedAt.getTime() + SESSION_TTL_MS).toISOString(),
    };
  }

  async initUpload(
    userId: string,
    projectId: string,
    input: z.infer<typeof InitUploadSchema>,
  ): Promise<UploadSessionDto> {
    const project = await this.draft(userId, projectId);
    await this.entitlements.assertCredits(await this.ownerOf(project), input.durationMs);

    // Yarım kalmış önceki oturum varsa kapatılır; yeni dosya onun yerini alır.
    const previous = project.sourceVideo;
    if (previous?.uploadId && previous.storageKey) {
      await this.storage.abortMultipart(previous.storageKey, previous.uploadId);
    }

    const partSize = Math.max(MIN_PART, Math.ceil(input.sizeBytes / MAX_PARTS / MIB) * MIB);
    const storageKey = `${projectPrefix(projectId)}source/original.${UPLOAD_TYPES[input.contentType]}`;
    const uploadId = await this.storage.createMultipart(storageKey, input.contentType);
    const data = {
      ingestType: 'UPLOAD' as const,
      status: 'UPLOADING' as const,
      sourceUrl: null,
      originalName: input.fileName,
      mimeType: input.contentType,
      sizeBytes: BigInt(input.sizeBytes),
      sha256: input.sha256 ?? null,
      declaredDurationMs: input.durationMs,
      storageKey,
      uploadId,
      partSize,
      errorCode: null,
    };
    const source = await this.prisma.sourceVideo.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
    return this.session(source, []);
  }

  private async uploading(userId: string, projectId: string) {
    const project = await this.draft(userId, projectId);
    const source = project.sourceVideo;
    if (!source || source.status !== 'UPLOADING' || !source.uploadId || !source.storageKey) {
      throw new AppException('NOT_FOUND', 'Etkin yükleme oturumu yok');
    }
    return { project, source: source as typeof source & { uploadId: string; storageKey: string } };
  }

  /** Devam ettirme: istemci hangi parçaların yüklendiğini buradan öğrenir. */
  async getUpload(userId: string, projectId: string): Promise<UploadSessionDto> {
    const { source } = await this.uploading(userId, projectId);
    return this.session(source, await this.storage.listParts(source.storageKey, source.uploadId));
  }

  async presignParts(
    userId: string,
    projectId: string,
    partNumbers: number[],
  ): Promise<{ parts: { partNumber: number; url: string }[] }> {
    const { source } = await this.uploading(userId, projectId);
    const partCount = Math.ceil(Number(source.sizeBytes) / source.partSize!);
    const unique = [...new Set(partNumbers)];
    if (unique.some((n) => n > partCount)) {
      throw new AppException('VALIDATION_FAILED', `Parça numarası en çok ${partCount} olabilir`);
    }
    const parts = await Promise.all(
      unique.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.presignPart(source.storageKey, source.uploadId, partNumber),
      })),
    );
    return { parts };
  }

  async completeUpload(
    userId: string,
    projectId: string,
    input: z.infer<typeof CompleteUploadSchema>,
  ): Promise<Record<string, unknown>> {
    const { source } = await this.uploading(userId, projectId);
    const partCount = Math.ceil(Number(source.sizeBytes) / source.partSize!);
    const numbers = new Set(input.parts.map((p) => p.partNumber));
    if (numbers.size !== input.parts.length || numbers.size !== partCount) {
      throw new AppException('UPLOAD_INCOMPLETE', `${partCount} parça bekleniyor, ${numbers.size} geldi`);
    }

    try {
      await this.storage.completeMultipart(source.storageKey, source.uploadId, input.parts);
    } catch (error) {
      const name = (error as { name?: string }).name ?? '';
      if (['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall', 'NoSuchUpload'].includes(name)) {
        throw new AppException('UPLOAD_INCOMPLETE', name);
      }
      throw error;
    }

    // İstemcinin beyanına güvenilmez: depolamadaki gerçek boyut denetlenir.
    const head = await this.storage.head(source.storageKey);
    if (!head || BigInt(head.size) !== source.sizeBytes) {
      await this.prisma.sourceVideo.update({
        where: { id: source.id },
        data: { status: 'FAILED', uploadId: null, errorCode: 'UPLOAD_MISMATCH' },
      });
      throw new AppException('UPLOAD_MISMATCH');
    }

    await this.prisma.sourceVideo.update({ where: { id: source.id }, data: { status: 'UPLOADED', uploadId: null } });
    await this.pipeline.start(projectId);
    return this.projects.dto(await this.projects.load(userId, projectId, 'channel.read'));
  }

  async abortUpload(userId: string, projectId: string): Promise<void> {
    const { source } = await this.uploading(userId, projectId);
    await this.storage.abortMultipart(source.storageKey, source.uploadId);
    await this.prisma.sourceVideo.update({ where: { id: source.id }, data: { status: 'PENDING', uploadId: null } });
  }

  async ingestFromLink(userId: string, projectId: string, rawUrl: string): Promise<Record<string, unknown>> {
    const project = await this.draft(userId, projectId);
    const url = await assertIngestableUrl(rawUrl);
    // Süre indirilmeden bilinemez; en az bir dakikalık kredi aranır, kesin düşüm alım sonunda yapılır.
    await this.entitlements.assertCredits(await this.ownerOf(project), 60_000);

    const previous = project.sourceVideo;
    if (previous?.uploadId && previous.storageKey) {
      await this.storage.abortMultipart(previous.storageKey, previous.uploadId);
    }
    const data = {
      ingestType: 'LINK' as const,
      status: 'FETCHING' as const,
      sourceUrl: url.toString(),
      originalName: decodeURIComponent(url.pathname.split('/').pop() ?? '').slice(0, 255) || null,
      mimeType: null,
      sizeBytes: null,
      sha256: null,
      declaredDurationMs: null,
      storageKey: `${projectPrefix(projectId)}source/original`,
      uploadId: null,
      partSize: null,
      errorCode: null,
    };
    await this.prisma.sourceVideo.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await this.pipeline.start(projectId);
    return this.projects.dto(await this.projects.load(userId, projectId, 'channel.read'));
  }
}
