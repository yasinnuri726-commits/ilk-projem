// Yol: klipai/apps/api/src/modules/billing/billing.module.ts
import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';

@Global()
@Module({ providers: [EntitlementsService], exports: [EntitlementsService] })
export class BillingModule {}
