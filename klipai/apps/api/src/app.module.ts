import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { AuthService, JwtGuard } from './auth/auth.service';
import { BillingController, BillingService } from './billing/billing';
import { EntitlementsService } from './billing/entitlements.service';
import { ChannelsController } from './channels/channels.controller';
import { ChannelsService } from './channels/channels.service';
import { ClipsController, ClipsService } from './clips/clips';
import { ProblemFilter } from './common/errors';
import { IdempotencyInterceptor } from './common/http';
import { InfraModule } from './infra/infra.module';
import { LearningService } from './learning/learning.service';
import { NotificationsController, NotificationsService } from './notifications/notifications';
import { Orchestrator } from './pipeline/orchestrator.service';
import { QueuesService } from './pipeline/queues';
import { HealthController, InternalController, Workers } from './pipeline/workers';
import { ProjectsController, ProjectsService } from './projects/projects';
import { PublishProcessor } from './publishing/publish.processor';
import { PublishingService } from './publishing/publishing.service';
import { SchedulerService } from './publishing/scheduler.service';
import { YoutubeClient } from './publishing/youtube.client';
import { RealtimeGateway, RealtimeService } from './realtime/realtime';
import { StatsController, TemplatesController } from './stats/stats';
import { UploadsController, UploadsService } from './uploads/uploads';
import { UsersController, UsersService } from './users/users';

@Module({
  imports: [InfraModule, ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }] })],
  controllers: [
    AuthController, UsersController, ChannelsController, UploadsController, ProjectsController, ClipsController, TemplatesController, StatsController,
    BillingController, NotificationsController, InternalController, HealthController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    RealtimeService, RealtimeGateway, NotificationsService, EntitlementsService, AuthService, YoutubeClient, ChannelsService, QueuesService, SchedulerService,
    PublishingService, Orchestrator, UploadsService, ProjectsService, ClipsService, PublishProcessor, LearningService, UsersService, BillingService, Workers,
  ],
})
export class AppModule {}
