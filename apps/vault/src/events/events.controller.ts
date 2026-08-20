import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { VaultEventRecord } from '@aobplatform/contracts';
import { EventsService } from './events.service';
import { CreateEventDto } from './create-event.dto';

/**
 * The vault's entire write surface is this one POST. There is deliberately no
 * PUT, PATCH or DELETE route anywhere in this service — "no update path
 * exists" is provable by reading this file (rule 11, ADR A-02).
 *
 * TODO(HUMAN): service-to-service auth guard (Keycloak client-credentials,
 * separate trust domain per REQ-LOG-05) before any non-local deployment.
 */
@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post('events')
  @HttpCode(201)
  append(@Body() dto: CreateEventDto): Promise<VaultEventRecord> {
    return this.events.append(dto);
  }

  @Get('events')
  list(
    @Query('subjectId') subjectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<readonly VaultEventRecord[]> {
    return this.events.list({ subjectId, from, to });
  }

  @Get('artefacts/:sha256/verify')
  verifyArtefact(@Param('sha256') sha256: string): Promise<{ exists: boolean; recordedAt?: string }> {
    return this.events.verifyArtefactHash(sha256);
  }

  @Get('chain/verify')
  verifyChain() {
    return this.events.verifyChain();
  }
}
