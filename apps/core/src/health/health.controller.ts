import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

export interface HealthResponse {
  status: 'ok';
  service: 'core';
  timestamp: string;
}

/**
 * Liveness/readiness endpoint. docker-compose healthchecks and the CI smoke
 * test both hit this — see CONVENTIONS.md ("Testing"). Deliberately
 * unauthenticated; never put anything sensitive in this response.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): HealthResponse {
    return { status: 'ok', service: 'core', timestamp: new Date().toISOString() };
  }
}
