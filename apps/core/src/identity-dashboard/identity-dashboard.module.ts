import { Module } from '@nestjs/common';
import { IdentityDashboardController } from './identity-dashboard.controller';
import { IdentityDashboardService } from './identity-dashboard.service';

/**
 * Platform-operator identity views. No dependency on the practice-scoped
 * modules, deliberately: everything here reads through SECURITY DEFINER
 * functions, and importing a scoped service would blur which of the two kinds
 * of read a method is doing.
 */
@Module({
  controllers: [IdentityDashboardController],
  providers: [IdentityDashboardService],
})
export class IdentityDashboardModule {}
