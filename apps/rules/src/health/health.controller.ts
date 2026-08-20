import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  service: 'rules';
  timestamp: string;
}

/**
 * Liveness/readiness endpoint. docker-compose healthchecks and the CI smoke
 * test both hit this — see CONVENTIONS.md ("Testing"). Deliberately
 * unauthenticated; never put anything sensitive in this response.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', service: 'rules', timestamp: new Date().toISOString() };
  }
}
