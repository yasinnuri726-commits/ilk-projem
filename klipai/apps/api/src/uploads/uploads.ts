import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import type { UploadSession } from '@prisma/client';
import { z } from 'zod';
import { UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES } from '@klipai/shared';
import { AppError, invalidState, notFound } from '../common/errors';
import { AuthUser, CurrentUser, Zod } from '../common/http';
import { PrismaService } from '../infra/infra.module';
import { StorageService } from '../infra/storage.service';

const MB = 1024 * 1024;
const initSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
  /** "source" = işlenecek video; "asset" = logo, filigran, hak belgesi vb. */
  purpose: z.enum(['source', 'asset']).default('source'),
});
const partsSchema = z.object({ partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(50) });
const completeSchema = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1).max(200) })).max(10000) });
const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'video/mp4', 'video/quicktime'];

/** Parça boyutu: en az 8 MB, en çok 10.000 parça olacak şekilde büyütülür. */
export function partSizeFor(sizeBytes: number): number {
  return Math.max(8 * MB, Math.ceil(sizeBytes / 9000 / MB) * MB);
}
const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-120);

@Injectable()
export class UploadsService {
  constructor(private readonly db: PrismaService, private readonly storage: StorageService) {}

  async view(u: UploadSession, withParts = false) {
    const completedParts = withParts && ['INITIATED', 'IN_PROGRESS'].includes(u.status) ? (await this.storage.listParts(u.storageKey, u.s3UploadId).catch(() => [])).map((p) => p.partNumber) : undefined;
    return { id: u.id, status: u.status, partSize: u.partSize, partCount: u.partCount, completedParts, expiresAt: u.expiresAt };
  }

  async init(userId: string, dto: z.infer<typeof initSchema>) {
    const source = dto.purpose === 'source';
    if (source && dto.sizeBytes > UPLOAD_MAX_BYTES) throw new AppError(413, 'UPLOAD_TOO_LARGE', 'Dosya 20 GB sınırını aşıyor');
    if (!source && dto.sizeBytes > 200 * MB) throw new AppError(413, 'UPLOAD_TOO_LARGE', 'Dosya 200 MB sınırını aşıyor');
    const allowed: readonly string[] = source ? UPLOAD_CONTENT_TYPES : ASSET_TYPES;
    if (!allowed.includes(dto.contentType)) throw new AppError(422, 'UNSUPPORTED_MEDIA', `Desteklenmeyen dosya türü: ${dto.contentType}`);
    const partSize = partSizeFor(dto.sizeBytes);
    const session = await this.db.uploadSession.create({
      data: {
        userId, storageKey: 'pending', s3UploadId: 'pending', fileName: dto.fileName, contentType: dto.contentType, sizeBytes: BigInt(dto.sizeBytes),
        partSize, partCount: Math.ceil(dto.sizeBytes / partSize), expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    const key = `${source ? 'uploads' : 'assets'}/${userId}/${session.id}/${safeName(dto.fileName)}`;
    const s3UploadId = await this.storage.createMultipart(key, dto.contentType);
    return this.view(await this.db.uploadSession.update({ where: { id: session.id }, data: { storageKey: key, s3UploadId } }));
  }

  async owned(userId: string, id: string): Promise<UploadSession> {
    const u = await this.db.uploadSession.findFirst({ where: { id, userId } });
    if (!u) throw notFound('Yükleme');
    return u;
  }

  async signParts(userId: string, id: string, partNumbers: number[]) {
    const u = await this.owned(userId, id);
    if (!['INITIATED', 'IN_PROGRESS'].includes(u.status) || u.expiresAt < new Date()) throw invalidState('Yükleme oturumu açık değil');
    if (partNumbers.some((n) => n > u.partCount)) throw new AppError(422, 'VALIDATION_FAILED', 'Parça numarası aralık dışında');
    if (u.status === 'INITIATED') await this.db.uploadSession.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    const expiresAt = new Date(Date.now() + 900_000);
    return { parts: await Promise.all(partNumbers.map(async (partNumber) => ({ partNumber, url: await this.storage.signPart(u.storageKey, u.s3UploadId, partNumber), expiresAt }))) };
  }

  /** S3 `ListParts` tek doğru kaynaktır: istemci ETag göndermemiş/yanlış göndermiş olsa da tamamlanır (devam ettirilen yüklemelerde ilk parçaların ETag'i istemcide yoktur). */
  async complete(userId: string, id: string, _clientParts: { partNumber: number; etag: string }[]) {
    const u = await this.owned(userId, id);
    if (u.status === 'COMPLETED') return this.view(u);
    if (!['INITIATED', 'IN_PROGRESS'].includes(u.status)) throw invalidState('Yükleme oturumu açık değil');
    const parts = await this.storage.listParts(u.storageKey, u.s3UploadId);
    if (parts.length !== u.partCount) throw new AppError(409, 'INVALID_STATE', `${u.partCount} parça bekleniyor, ${parts.length} parça yüklenmiş`);
    await this.storage.completeMultipart(u.storageKey, u.s3UploadId, parts);
    const head = await this.storage.head(u.storageKey);
    if (!head || BigInt(head.size) !== u.sizeBytes) throw new AppError(409, 'INVALID_STATE', 'Yüklenen dosya boyutu beyan edilenle uyuşmuyor');
    return this.view(await this.db.uploadSession.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } }));
  }

  async abort(userId: string, id: string) {
    const u = await this.owned(userId, id);
    if (u.status === 'COMPLETED') throw invalidState('Tamamlanmış yükleme iptal edilemez');
    await this.storage.abortMultipart(u.storageKey, u.s3UploadId);
    await this.db.uploadSession.update({ where: { id }, data: { status: 'ABORTED' } });
  }
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  init(@CurrentUser() u: AuthUser, @Body(new Zod(initSchema)) dto: z.infer<typeof initSchema>) {
    return this.uploads.init(u.id, dto);
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.uploads.view(await this.uploads.owned(u.id, id), true);
  }

  @Post(':id/parts')
  @HttpCode(200)
  parts(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(partsSchema)) dto: z.infer<typeof partsSchema>) {
    return this.uploads.signParts(u.id, id, dto.partNumbers);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(completeSchema)) dto: z.infer<typeof completeSchema>) {
    return this.uploads.complete(u.id, id, dto.parts);
  }

  @Delete(':id')
  @HttpCode(204)
  abort(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.uploads.abort(u.id, id);
  }
}
