import { Controller, Get } from '@nestjs/common';
import { IdentityDashboardService } from './identity-dashboard.service';
import { PLATFORM_ADMIN, RequireRoles } from '../auth/roles.decorator';

/**
 * The two identity dashboards — PLATFORM OPERATOR ONLY.
 *
 * Both are cross-tenant reads, which is exactly why the role guard is on the
 * controller rather than on each method: a route added here later inherits it
 * by default rather than by remembering. The alternative ordering — guard per
 * method — fails silently the first time somebody adds a route in a hurry, and
 * the failure is that every practice can read every other practice.
 */
@RequireRoles(PLATFORM_ADMIN)
@Controller('identity')
export class IdentityDashboardController {
  constructor(private readonly dashboard: IdentityDashboardService) {}

  /** Which applications are stuck, and on what. */
  @Get('practices')
  practices() {
    return this.dashboard.practices();
  }

  /** Whose verification is going stale, and who is moving unusually. */
  @Get('practitioners')
  practitioners() {
    return this.dashboard.practitioners();
  }
}
