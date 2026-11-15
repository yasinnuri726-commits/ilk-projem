// Yol: klipai/apps/api/src/modules/pipeline/pipeline.module.ts
import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { OrchestratorService } from './orchestrator.service';
import { PipelineService } from './pipeline.service';
import { StubWorkersService } from './stub-workers.service';

@Module({
  providers: [PipelineService, OrchestratorService, MaintenanceService, StubWorkersService],
  exports: [PipelineService, OrchestratorService, MaintenanceService],
})
export class PipelineModule {}
