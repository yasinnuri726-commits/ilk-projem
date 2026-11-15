// Yol: klipai/apps/api/src/modules/projects/projects.controller.ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, RateLimit } from '../../common/decorators';
import type { Page } from '../../common/pagination';
import type { AuthUser } from '../../common/request-context';
import { UuidPipe, ZodPipe } from '../../common/zod.pipe';
import {
  CompleteUploadSchema,
  CreateProjectSchema,
  InitUploadSchema,
  LinkSchema,
  ListProjectsSchema,
  PresignPartsSchema,
  TranscriptQuerySchema,
} from './projects.schemas';
import { ProjectsService } from './projects.service';
import { SourceService, type UploadSessionDto } from './source.service';

type Dto = Record<string, unknown>;
// Yeni iş başlatan uçlar kullanıcı başına saatte 20 ile sınırlıdır.
const START_LIMIT = { name: 'project-start', limit: 20, windowSec: 3600, by: 'user' } as const;

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly source: SourceService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ListProjectsSchema)) query: z.infer<typeof ListProjectsSchema>,
  ): Promise<Page<Dto>> {
    return this.projects.list(user.id, query);
  }

  @Post()
  @RateLimit(START_LIMIT)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateProjectSchema)) body: z.infer<typeof CreateProjectSchema>,
    @Req() req: Request,
  ): Promise<Dto> {
    return this.projects.create(user.id, body, {
      ip: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'] ?? 'unknown',
    });
  }

  @Get(':projectId')
  get(@CurrentUser() user: AuthUser, @Param('projectId', UuidPipe) id: string): Promise<Dto> {
    return this.projects.detail(user.id, id);
  }

  @Delete(':projectId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('projectId', UuidPipe) id: string): Promise<void> {
    await this.projects.remove(user.id, id);
  }

  @Post(':projectId/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('projectId', UuidPipe) id: string): Promise<Dto> {
    return this.projects.cancel(user.id, id);
  }

  @Post(':projectId/retry')
  @HttpCode(202)
  retry(@CurrentUser() user: AuthUser, @Param('projectId', UuidPipe) id: string): Promise<Dto> {
    return this.projects.retry(user.id, id);
  }

  @Get(':projectId/transcript')
  transcript(
    @CurrentUser() user: AuthUser,
    @Param('projectId', UuidPipe) id: string,
    @Query(new ZodPipe(TranscriptQuerySchema)) query: z.infer<typeof TranscriptQuerySchema>,
  ): Promise<Dto> {
    return this.projects.transcript(user.id, id, query);
  }

  // ───────────── Kaynak (alım) ─────────────

  @Post(':projectId/source/upload')
  initUpload(
    @CurrentUser() user: AuthUser,
    @Param('projectId', UuidPipe) id: string,
    @Body(new ZodPipe(InitUploadSchema)) body: z.infer<typeof InitUploadSchema>,
  ): Promise<UploadSessionDto> {
    return this.source.initUpload(user.id, id, body);
  }

  @Get(':projectId/source/upload')
  getUpload(@CurrentUser() user: AuthUser, @Param('projectId', UuidPipe) id: string): Promise<UploadSessionDto> {
    return this.source.getUpload(user.id, id);
  }

  @Delete(':projectId/source/upload')
  @HttpCode(204)
  async abortUpload(@CurrentUser() user: AuthUser, @Param('projectId', UuidPipe) id: string): Promise<void> {
    await this.source.abortUpload(user.id, id);
  }

  @Post(':projectId/source/upload/parts')
  @HttpCode(200)
  presignParts(
    @CurrentUser() user: AuthUser,
    @Param('projectId', UuidPipe) id: string,
    @Body(new ZodPipe(PresignPartsSchema)) body: z.infer<typeof PresignPartsSchema>,
  ): Promise<{ parts: { partNumber: number; url: string }[] }> {
    return this.source.presignParts(user.id, id, body.partNumbers);
  }

  @Post(':projectId/source/upload/complete')
  @HttpCode(202)
  completeUpload(
    @CurrentUser() user: AuthUser,
    @Param('projectId', UuidPipe) id: string,
    @Body(new ZodPipe(CompleteUploadSchema)) body: z.infer<typeof CompleteUploadSchema>,
  ): Promise<Dto> {
    return this.source.completeUpload(user.id, id, body);
  }

  @Post(':projectId/source/link')
  @HttpCode(202)
  @RateLimit(START_LIMIT)
  link(
    @CurrentUser() user: AuthUser,
    @Param('projectId', UuidPipe) id: string,
    @Body(new ZodPipe(LinkSchema)) body: z.infer<typeof LinkSchema>,
  ): Promise<Dto> {
    return this.source.ingestFromLink(user.id, id, body.url);
  }
}
