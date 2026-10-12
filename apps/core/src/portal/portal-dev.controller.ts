import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  NotFoundException,
  Post,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PortalScope } from './portal-scope';
import { PortalService } from './portal.service';
import { DevPortalSessionDto } from './portal.dto';
import { setPortalCookie } from './portal-cookie';

/**
 * A PORTAL SESSION WITHOUT A SIGNATURE — dev only.
 *
 * WHY IT EXISTS. The real front door is `POST /portal/activate`, and it needs a
 * signed agreement, a minted invitation and three correct identifiers before it
 * will issue anything. That is right, and it makes every portal screen
 * unreachable for anybody building one: a Playwright test would have to walk a
 * whole capture ceremony to look at the details card. So this endpoint links an
 * account to named patients and hands back the cookie — the same shape the real
 * path produces, arrived at by a door that does not exist in production.
 *
 * IT REFUSES TO RUN IN PRODUCTION, on the same `NODE_ENV` guard as every other
 * `/dev` endpoint in this service. There is no seeded portal path in a deployed
 * environment.
 *
 * IT STILL WRITES THE EVENT. `issueSession` emits `portal.accessed` exactly as
 * the real path does, so a dev session appears in the access log rather than
 * being a hole in it — and a screen built against seeded data shows the same
 * timeline the real one will.
 *
 * IT DOES NOT DEFEAT RLS, and it was worth finding out that it could not. The
 * service connects as `aob_app`, which holds neither SUPERUSER nor BYPASSRLS —
 * only the migration role does — so a patient id cannot be turned into a
 * practice id without already being scoped to that practice, in development
 * exactly as in production. So the caller names the practices to look in (or
 * sends the usual `x-practice-id` for the single-practice case) and each
 * lookup runs inside that practice's own scope. A seam that had to be given a
 * back door into the fence would have been the wrong seam.
 */
@Controller('dev')
export class PortalDevController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScope,
    private readonly portal: PortalService,
  ) {}

  @Public()
  @Post('portal-session')
  async portalSession(
    @Headers('x-practice-id') headerPracticeId: string | undefined,
    @Body() dto: DevPortalSessionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev seeding does not exist in production.');
    }

    const practiceIds = dto.practiceIds?.length
      ? dto.practiceIds
      : headerPracticeId
        ? [headerPracticeId]
        : [];
    if (practiceIds.length === 0) {
      throw new BadRequestException(
        'Say which practices to look in — `practiceIds` in the body, or the x-practice-id header. ' +
          'A patient id cannot be resolved to a practice without being scoped to one first.',
      );
    }

    const found: Array<{ patientId: string; practiceId: string }> = [];
    for (const practiceId of practiceIds) {
      const patients = await this.prisma.withPractice(practiceId, (tx) =>
        tx.patient.findMany({ where: { id: { in: dto.patientIds } }, select: { id: true } }),
      );
      for (const patient of patients) found.push({ patientId: patient.id, practiceId });
    }
    if (found.length === 0) throw new NotFoundException('None of those patients are in those practices.');

    const accountId = randomUUID();
    await this.scope.withAccount(accountId, async (tx) => {
      await tx.portalAccount.create({ data: { id: accountId, lastSeenAt: new Date() } });
    });
    for (const link of found) {
      await this.scope.withAccountAtPractice(accountId, link.practiceId, (tx) =>
        tx.portalAccountPatient.upsert({
          where: { accountId_patientId: { accountId, patientId: link.patientId } },
          create: { accountId, patientId: link.patientId, practiceId: link.practiceId },
          update: {},
        }),
      );
    }

    const sessionId = await this.portal.issueSession(accountId, 'dev_seed');
    setPortalCookie(res, sessionId);
    return { accountId, sessionId, links: await this.portal.linksFor(accountId) };
  }
}
