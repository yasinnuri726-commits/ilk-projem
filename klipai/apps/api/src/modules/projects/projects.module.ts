// Yol: klipai/apps/api/src/modules/projects/projects.module.ts
import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SourceService } from './source.service';

@Module({
  imports: [PipelineModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, SourceService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
