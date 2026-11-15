// Yol: klipai/apps/api/src/modules/channels/channels.module.ts
import { Global, Module } from '@nestjs/common';
import { ChannelAccessService } from './channel-access.service';
import { ChannelsController } from './channels.controller';

@Global()
@Module({
  controllers: [ChannelsController],
  providers: [ChannelAccessService],
  exports: [ChannelAccessService],
})
export class ChannelsModule {}
