import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  MAX_PAYLOAD_BYTES,
  OutboundQueueError,
  afterFailure,
  afterPermanentFailure,
  assertQueueable,
  idempotencyKey,
  isPullChannel,
  leaseSecondsFor,
  REPORT_GRAINS,
  REPORT_MATRICES,
  REPORT_MAX_YEARS,
  REPORT_TIMEZONE,
  ReportingError,
  type ReportScope,
  bucketKey,
  isReportGrain,
  matrix,
  mayGroupByOrganisation,
  reportWindow,
  scopeFor,
  summarise,
  MIN_RESEND_REASON_WORDS,
  assertResendNote,
} from '@aobplatform/domain';
import type { Prisma } from '@prisma/client';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../auth/actor.decorator';

/**
 * The outbound queue.
 *
 * READ THE HEADER OF packages/domain/src/outbound-queue.ts for why this
 * exists. In one line: a notice is evidence, and evidence must not evaporate
 * because a provider was down for twenty minutes.
 *
 * THE ENQUEUE TAKES A TRANSACTION, and that is the single most important thing
 * about this class. A caller writes its Notice row and enqueues the dispatch
 * in the SAME transaction, so it is impossible to end up with a notice nobody
 * sent, or a send with no notice behind it. Every other design — a broker, a
 * job server, an in-memory list — reintroduces both failures and then needs an
 * outbox table to fix them, which is exactly this table.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Queue something to leave the platform.
   *
   * TAKES THE TRANSACTION rather than opening its own. See the class comment —
   * this is the whole point, not a convenience.
   *
   * IDEMPOTENT BY CONSTRUCTION. The unique key means a caller that retries
   * after a crash — or two racing requests — produce one row, not two. Re-sending
   * a statutory notice is not a duplicate email; it is a second assertion that
   * notice was given.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      practiceId: string;
      channel: string;
      destination?: string | null;
      subjectType: string;
      subjectId: string;
      payload: Record<string, unknown>;
      /** Distinguishes a deliberate re-send from a retry of the same send. */
      attemptGroup?: string;
      /** Hold it until this time. Used for scheduled reminders. */
      availableAt?: Date;
      /** email | json | xml | pdf | markdown. What the recipient opens. */
      mediaType?: string;
      /*
       * WHERE and WHO. Optional, but a caller that omits them is queueing
       * a message that cannot be found by anybody answering a support
       * call — which at 375,000 a day means it cannot be found at all.
       */
      locationId?: string | null;
      departmentId?: string | null;
      recipientType?: string | null;
      recipientId?: string | null;
      recipientName?: string | null;
    },
  ) {
    const serialised = JSON.stringify(input.payload ?? {});
    let channel;
    try {
      channel = assertQueueable({
        channel: input.channel,
        payloadBytes: Buffer.byteLength(serialised, 'utf8'),
        destination: input.destination,
      });
    } catch (err) {
      if (err instanceof OutboundQueueError) throw new BadRequestException(err.message);
      throw err;
    }

    const key = idempotencyKey({
      practiceId: input.practiceId,
      channel,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      attemptGroup: input.attemptGroup,
    });

    /*
     * upsert rather than create, so a caller retrying a whole transaction does
     * not fail on the unique key. The update is deliberately EMPTY: an item
     * already queued must not be reset, rescheduled or have its attempt count
     * cleared by a duplicate enqueue.
     */
    return tx.outboundItem.upsert({
      where: { practiceId_idempotencyKey: { practiceId: input.practiceId, idempotencyKey: key } },
      create: {
        practiceId: input.practiceId,
        channel,
        destination: input.destination ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: input.payload as Prisma.InputJsonValue,
        idempotencyKey: key,
        availableAt: input.availableAt ?? new Date(),
        mediaType: input.mediaType ?? 'email',
        locationId: input.locationId ?? null,
        departmentId: input.departmentId ?? null,
        recipientType: input.recipientType ?? null,
        recipientId: input.recipientId ?? null,
        recipientName: input.recipientName ?? null,
      },
      update: {},
    });
  }

  /**
   * Take up to `limit` items for this channel, leasing them.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes this safe with many workers and no
   * coordinator. Each transaction locks the rows it selects and SKIPS any
   * another worker already holds, so two workers never take the same item and
   * neither waits for the other. It is the reason this queue needs no broker.
   *
   * A LEASED ROW WHOSE LEASE HAS EXPIRED IS INCLUDED, which is the recovery
   * path for a worker that died mid-send. Nothing detects the death; the lease
   * simply stops being true. The consequence — an item may be sent twice if
   * the first send succeeded and the worker died before recording it — is why
   * this is honestly at-least-once, and why the payload carries an idempotency
   * key for the provider.
   */
  async claim(practiceId: string, channel: string, workerId: string, limit = 50) {
    const leaseSeconds = leaseSecondsFor(channel);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE core.outbound_items SET
          "state" = 'leased',
          "leasedBy" = ${workerId},
          "leaseExpiresAt" = now() + make_interval(secs => ${leaseSeconds}::double precision)
        WHERE "id" IN (
          SELECT "id" FROM core.outbound_items
          WHERE "practiceId" = ${practiceId}::uuid
            AND "channel" = ${channel}
            AND (
              ("state" IN ('pending', 'failed') AND "availableAt" <= now())
              OR ("state" = 'leased' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now()))
            )
          ORDER BY "availableAt"
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        RETURNING "id"
      `;
      if (rows.length === 0) return [];
      return tx.outboundItem.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    });
  }

  /** It went. Records when, and the provider's reference if there was one. */
  async markSent(practiceId: string, id: string, providerRef?: string) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.outboundItem.update({
        where: { id },
        data: {
          state: 'sent',
          sentAt: new Date(),
          providerRef: providerRef ?? null,
          leasedBy: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      }),
    );
  }

  /**
   * It did not go.
   *
   * `permanent` separates a bad address from a provider hiccup. Eight retries
   * against an address with a typo is six hours of pointless load and six
   * hours before a human is told the thing they need to fix.
   */
  async markFailed(practiceId: string, id: string, error: string, permanent = false) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const item = await tx.outboundItem.findFirst({ where: { id } });
      if (!item) return null;

      const outcome = permanent ? afterPermanentFailure(item) : afterFailure(item, new Date());
      const updated = await tx.outboundItem.update({
        where: { id },
        data: {
          state: outcome.state,
          attempts: outcome.attempts,
          availableAt: outcome.availableAt ?? item.availableAt,
          lastError: error.slice(0, 2000),
          leasedBy: null,
          leaseExpiresAt: null,
        },
      });

      if (outcome.exhausted) {
        /*
         * Loud, because this is the platform failing to deliver a statutory
         * notice. The row is KEPT — it is the record that we tried and could
         * not, which is precisely what somebody will need to explain later.
         */
        this.logger.error(
          `ALERT: outbound ${item.channel} item ${id} for ${item.subjectType} ${item.subjectId} is DEAD after ` +
            `${outcome.attempts} attempts. Last error: ${error.slice(0, 200)}`,
        );
      }
      return updated;
    });
  }

  /**
   * What a kiosk or tablet asks for.
   *
   * Same leasing, longer window — a tablet may be picked up, carried to a
   * patient and put down again before it confirms. Refuses a push channel
   * outright: a device asking for the email queue would be reading the content
   * of notices addressed to people.
   */
  async pullForDevice(practiceId: string, deviceId: string, limit = 20) {
    if (!isPullChannel('device')) throw new BadRequestException('Device pull is not enabled.');
    return this.claim(practiceId, 'device', `device:${deviceId}`, limit);
  }

  /**
   * The queue, for a screen.
   *
   * REQUIRES A PRACTICE. There is deliberately no all-practices listing: these
   * payloads carry patient names and consent details, and a screen that
   * renders every practice at once is a cross-tenant disclosure waiting for
   * one missing WHERE clause. A platform operator picks a practice and looks
   * at that practice, which is also how they actually work.
   *
   * PAYLOADS ARE NOT RETURNED HERE. A list of two hundred emails would ship
   * two hundred patient-bearing bodies to a browser in order to render a table
   * that shows none of them. The viewer fetches one at a time.
   */
  async list(
    practiceId: string | undefined,
    filter: {
      mediaType?: string;
      state?: string;
      channel?: string;
      locationId?: string;
      departmentId?: string;
      recipientType?: string;
      recipientId?: string;
      search?: string;
      take?: number;
    },
  ) {
    if (!practiceId) {
      throw new BadRequestException(
        'Choose a practice first. The queue is read one practice at a time, because these messages carry ' +
          'patient details.',
      );
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const where: Record<string, unknown> = { practiceId };
      if (filter.mediaType) where.mediaType = filter.mediaType;
      if (filter.state) where.state = filter.state;
      if (filter.channel) where.channel = filter.channel;
      if (filter.locationId) where.locationId = filter.locationId;
      if (filter.departmentId) where.departmentId = filter.departmentId;
      if (filter.recipientType) where.recipientType = filter.recipientType;
      if (filter.recipientId) where.recipientId = filter.recipientId;
      if (filter.search?.trim()) {
        /*
         * Destination and subject only. NOT the payload — searching inside
         * message bodies would let somebody trawl for a patient name across a
         * practice, which is a different capability from operating a queue and
         * should not arrive as a side effect of a search box.
         */
        where.OR = [
          { destination: { contains: filter.search.trim(), mode: 'insensitive' } },
          { recipientName: { contains: filter.search.trim(), mode: 'insensitive' } },
          { subjectType: { contains: filter.search.trim(), mode: 'insensitive' } },
        ];
      }

      const items = await tx.outboundItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.take ?? 50,
        select: {
          id: true,
          channel: true,
          mediaType: true,
          destination: true,
          subjectType: true,
          subjectId: true,
          state: true,
          attempts: true,
          availableAt: true,
          lastError: true,
          createdAt: true,
          sentAt: true,
          artefactId: true,
          locationId: true,
          departmentId: true,
          recipientType: true,
          recipientId: true,
          recipientName: true,
          resendOfId: true,
          resendCount: true,
          resendByName: true,
        },
      });
      return { items, count: items.length };
    });
  }

  /**
   * One item WITH its payload, for the viewer.
   *
   * Reading a queued message is reading something written about a patient, so
   * it is logged exactly as opening evidence is. An operator browsing notice
   * contents should leave the same trail as one opening a document — otherwise
   * the queue becomes the unaudited way to read what the audited path protects.
   */
  async item(practiceId: string | undefined, id: string, actor?: Actor) {
    if (!practiceId) throw new BadRequestException('Choose a practice first.');
    return this.prisma.withPractice(practiceId, async (tx) => {
      const found = await tx.outboundItem.findFirst({ where: { id } });
      if (!found) throw new NotFoundException('That queued item is not in this practice.');

      await enqueueVaultEvent(tx, {
        type: 'access.read',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'OutboundItem', id },
        payload: {
          readBy: actor?.name ?? 'unattributed',
          mediaType: found.mediaType,
          about: `${found.subjectType}:${found.subjectId}`,
        },
      });

      return found;
    });
  }

  /**
   * Send it again.
   *
   * A RESEND IS A NEW ROW, NOT A MUTATED ONE. Carl asked whether to copy the
   * record or increment a counter; the answer is copy, and here is why. A
   * counter tells you it went three times. A copy tells you WHEN each went,
   * WHO asked, whether the first actually succeeded, and what the provider
   * said each time — which is the shape of every question a support call
   * brings. It also matches how the rest of this system works: append, do not
   * overwrite.
   *
   * The count is kept as well, on the original, so a list can show "sent 3
   * times" without a subquery per row. Both, because they answer different
   * questions.
   *
   * PRACTICE OR PLATFORM. Carl was explicit that either may do this. It is a
   * repair, not a privilege — the practice is usually the one being told the
   * message never arrived.
   *
   * ⚠ IT DOES NOT RESURRECT THE ORIGINAL. The original keeps whatever state it
   * reached, including `dead`. That row is the record of an attempt that
   * failed, and a resend does not make that untrue.
   */
  /**
   * The reasons somebody may choose from, read from the table.
   *
   * Served to the screen so it offers exactly what the server accepts. A screen
   * with its own copy of the list is a screen that drifts from it the first
   * time somebody adds a sixth reason and forgets one of the two places.
   */
  async resendReasons() {
    const reasons = await this.prisma.resendReason.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    return { reasons, minWords: MIN_RESEND_REASON_WORDS };
  }

  async resend(
    practiceId: string | undefined,
    id: string,
    input: { reason?: string; note?: string },
    actor?: Actor,
  ) {
    /*
     * CHECKED HERE AS WELL AS ON THE SCREEN, because a disabled button is a
     * suggestion. The key is checked against the TABLE — only the server can
     * see it — and the note against the rule, which lives in the domain
     * precisely so it cannot be edited away by whoever maintains the table.
     */
    const chosen = await this.prisma.resendReason.findFirst({
      where: { key: input.reason ?? '', active: true },
    });
    if (!chosen) {
      throw new BadRequestException(
        'Choose a reason for sending this again. A resend is a second time we assert that notice was given, ' +
          'so the record needs to say why somebody decided to.',
      );
    }

    try {
      assertResendNote(input.note ?? '');
    } catch (err) {
      if (err instanceof OutboundQueueError) throw new BadRequestException(err.message);
      throw err;
    }

    if (!practiceId) throw new BadRequestException('Choose a practice first.');
    return this.prisma.withPractice(practiceId, async (tx) => {
      const original = await tx.outboundItem.findFirst({ where: { id } });
      if (!original) throw new NotFoundException('That queued item is not in this practice.');

      /*
       * Refusing to resend something still in flight. A message that is
       * pending or leased has not failed yet, and sending a second copy of a
       * statutory notice because somebody was impatient is the failure mode
       * this whole table exists to avoid.
       */
      if (original.state === 'pending' || original.state === 'leased') {
        throw new BadRequestException(
          'This one has not been sent yet — it is still queued. Wait for it to finish before sending ' +
            'another copy, or you will have sent the same notice twice.',
        );
      }

      // Walk to the root, so a resend of a resend still counts against the
      // original rather than starting a new chain nobody can follow.
      const rootId = original.resendOfId ?? original.id;
      const root = rootId === original.id ? original : await tx.outboundItem.findFirst({ where: { id: rootId } });
      const attempt = (root?.resendCount ?? 0) + 1;

      const copy = await tx.outboundItem.create({
        data: {
          practiceId: original.practiceId,
          channel: original.channel,
          mediaType: original.mediaType,
          destination: original.destination,
          subjectType: original.subjectType,
          subjectId: original.subjectId,
          payload: original.payload as never,
          locationId: original.locationId,
          departmentId: original.departmentId,
          recipientType: original.recipientType,
          recipientId: original.recipientId,
          recipientName: original.recipientName,
          artefactId: original.artefactId,
          // A new key, or the unique index would refuse the copy — which is
          // exactly what `attemptGroup` was built for.
          idempotencyKey: `${original.idempotencyKey}:resend:${attempt}`,
          resendOfId: rootId,
          resendReason: input.reason?.trim() || null,
          resendNote: input.note?.trim() || null,
          resendByName: actor?.name ?? 'practice',
          state: 'pending',
          attempts: 0,
          availableAt: new Date(),
        },
      });

      if (root) {
        await tx.outboundItem.update({ where: { id: root.id }, data: { resendCount: attempt } });
      }

      await enqueueVaultEvent(tx, {
        type: 'access.read',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'OutboundItem', id: copy.id },
        payload: {
          resendOf: rootId,
          attempt,
          requestedBy: actor?.name ?? 'practice',
          ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        },
      });

      return { id: copy.id, resendOf: rootId, attempt, state: copy.state };
    });
  }

  /**
   * The sites, departments and people this practice's messages can be
   * filtered by.
   *
   * FROM THE ORGANISATION, not from the queue. I built it the other way
   * first, reasoning that every option should match something — but Carl is
   * right that a site with NO messages is itself an answer. "Did anything
   * go to Yagoona?" needs Yagoona in the list so the empty result can be
   * seen, rather than the site being absent and the question unanswerable.
   */
  async filterOptions(practiceId: string | undefined) {
    if (!practiceId) throw new BadRequestException('Choose a practice first.');
    return this.prisma.withPractice(practiceId, async (tx) => {
      const [locations, departments, practitioners, recipients] = await Promise.all([
        tx.practiceLocation.findMany({
          where: { practiceId },
          select: { id: true, code: true, address: true, active: true },
          orderBy: { code: 'asc' },
        }),
        tx.department.findMany({
          where: { practiceId },
          select: { id: true, name: true, locationId: true },
          orderBy: { name: 'asc' },
        }),
        /*
         * Everyone the practice could have written to. From affiliations
         * rather than the whole practitioner directory, because the
         * directory is global and a practice must never be handed a list of
         * practitioners who have nothing to do with it.
         */
        tx.affiliation.findMany({
          where: { practiceId },
          distinct: ['practitionerId'],
          select: { practitionerId: true },
        }),
        // Anybody already written to who is not in the lists above --
        // a practice, an assignor, somebody added later.
        tx.outboundItem.findMany({
          where: { practiceId, recipientId: { not: null } },
          distinct: ['recipientId'],
          select: { recipientId: true, recipientType: true, recipientName: true },
          take: 500,
        }),
      ]);

      const practitionerIds = practitioners.map((a) => a.practitionerId);
      const people = practitionerIds.length
        ? await tx.practitioner.findMany({
            where: { id: { in: practitionerIds } },
            select: { id: true, familyName: true, givenNames: true },
          })
        : [];

      const byId = new Map<string, { id: string; type: string; name: string }>();
      for (const p of people) {
        byId.set(p.id, {
          id: p.id,
          type: 'practitioner',
          name: [p.familyName, p.givenNames].filter(Boolean).join(', '),
        });
      }
      for (const r of recipients) {
        if (!r.recipientId || byId.has(r.recipientId)) continue;
        byId.set(r.recipientId, {
          id: r.recipientId,
          type: r.recipientType ?? 'other',
          name: r.recipientName ?? r.recipientId,
        });
      }

      return {
        locations: locations.map((l) => ({
          id: l.id,
          label: l.code ?? l.address,
          active: l.active,
        })),
        departments: departments.map((d) => ({ id: d.id, label: d.name, locationId: d.locationId })),
        recipients: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  }
  /**
   * Every practice, for the organisation filter.
   *
   * PRE-TENANT, like the application list it borrows from: an operator
   * choosing which practice to look at has not chosen one yet, so there is no
   * scope to run inside. It returns NAMES AND IDS ONLY — nothing about what
   * is queued, and nothing that would make this a way to read across
   * practices.
   */
  async practicesForChooser() {
    /*
     * THROUGH list_organisations, the existing pre-tenant function.
     *
     * A plain SELECT on core.practices returns ZERO ROWS: RLS is fail-closed
     * and an operator choosing which practice to look at has not chosen one
     * yet, so there is no scope to run inside. That is the third time today
     * the same trap has bitten — the worker, the raw constraint test, and now
     * this.
     *
     * Reusing the function rather than adding another SECURITY DEFINER: every
     * one of those is an individually-justified hole in the tenancy boundary
     * (CONVENTIONS.md §6), and this question is already answered by one that
     * exists.
     */
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM list_organisations('all') ORDER BY "name" LIMIT 500`;
    return { practices: rows };
  }

  /**
   * Totals for every practice, by message type and state.
   *
   * PLATFORM-WIDE, and safe to be so because it returns COUNTS. No payload, no
   * destination, no recipient. Knowing a practice sent 412 emails yesterday
   * tells an operator whether the platform is working; it tells them nothing
   * about any patient, practitioner or consent record.
   *
   * That is a materially different disclosure from the item list, which is why
   * the item list stays scoped to one practice and this does not.
   */
  /**
   * Volumes over time, for the summary reports.
   *
   * THE SCOPE COMES FROM THE CALLER'S IDENTITY, not from a query parameter.
   * `scopeFor` reads it off the principal and throws rather than defaulting
   * when it cannot tell, because a report with no scope is everybody's report.
   * The SQL then narrows by it, so there is no path that fetches everything
   * and leaves the filtering to whatever renders it.
   *
   * The bucketing is done in the domain rather than in SQL. Doing it in both
   * would put the same week-of-month arithmetic in two languages, which is how
   * two screens come to disagree about a total.
   */
  async timeseries(
    principal: { roles?: string[]; practiceId?: string | null },
    options: {
      grain?: string;
      groupBy?: string;
      matrix?: string;
      practiceId?: string;
      locationId?: string;
      departmentId?: string;
      from?: string;
    } = {},
  ) {
    let scope: ReportScope;
    try {
      scope = scopeFor(principal);
    } catch (err) {
      if (err instanceof ReportingError) throw new BadRequestException(err.message);
      throw err;
    }

    /*
     * A platform operator may narrow to one organisation; nobody else may
     * widen. An organisation-scoped caller's practice comes from their claim,
     * and a practiceId in the query string is ignored rather than trusted --
     * it is the obvious thing to edit.
     */
    const practiceId = scope === 'platform' ? options.practiceId : (principal.practiceId ?? undefined);

    if (scope !== 'platform' && scope !== 'organisation') {
      throw new BadRequestException(
        'These figures come from what was sent to and by a practice. Your own messages are a different ' +
          'report, over your notices rather than the outbound queue.',
      );
    }

    const now = new Date();
    const window = reportWindow(now, options.from ? new Date(options.from) : null);

    const rows = await this.prisma.$queryRaw<
      Array<{
        at: Date;
        count: bigint;
        practiceId: string;
        practiceName: string;
        locationId: string | null;
        locationName: string | null;
        departmentId: string | null;
        departmentName: string | null;
        mediaType: string;
        state: string;
      }>
    >`SELECT * FROM core.outbound_timeseries(
        ${scope}, ${practiceId ?? null}::uuid, ${options.locationId ?? null}::uuid,
        ${options.departmentId ?? null}::uuid, ${window.from}, ${window.to})`;

    const counted = rows.map((r) => ({ at: r.at, count: Number(r.count) }));
    const grain = options.grain && isReportGrain(options.grain) ? options.grain : 'month';

    /*
     * THE SAME NUMBERS, BROKEN DOWN BY WHERE THEY WENT.
     *
     * Without this a page showed "165 messages" beside a table saying "10" --
     * one answering across every practice, the other about this one, and
     * nothing on screen saying which was which. Two totals that look like they
     * should agree are worse than one, because the reader assumes one of them
     * is wrong rather than that they are answering different questions.
     *
     * `org` groups by practice; `site` groups by practice, site and department
     * together, because a department only means anything inside its site.
     */
    const groupBy = options.groupBy === 'site' ? 'site' : 'org';
    const periods = [...new Set(counted.map((r) => bucketKey(r.at, grain)))].sort();

    const lines = new Map<
      string,
      { organisation: string; site: string | null; department: string | null; byPeriod: Record<string, number>; total: number }
    >();

    for (const row of rows) {
      const key =
        groupBy === 'org'
          ? row.practiceId
          : `${row.practiceId}|${row.locationId ?? ''}|${row.departmentId ?? ''}`;

      const line = lines.get(key) ?? {
        organisation: row.practiceName,
        // NULL is a real answer, not missing data: a message addressed to the
        // practice itself has no site. The screen says so in words.
        site: groupBy === 'site' ? row.locationName : null,
        department: groupBy === 'site' ? row.departmentName : null,
        byPeriod: {} as Record<string, number>,
        total: 0,
      };

      const bucket = bucketKey(row.at, grain);
      const n = Number(row.count);
      line.byPeriod[bucket] = (line.byPeriod[bucket] ?? 0) + n;
      line.total += n;
      lines.set(key, line);
    }

    const breakdown = [...lines.values()].sort(
      (a, b) =>
        a.organisation.localeCompare(b.organisation) ||
        (a.site ?? '').localeCompare(b.site ?? '') ||
        (a.department ?? '').localeCompare(b.department ?? ''),
    );

    return {
      scope,
      grain,
      // Stated rather than assumed. A reader comparing this against their own
      // records needs to know which midnight we used.
      timezone: REPORT_TIMEZONE,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      // TRUE only when somebody asked for more than we keep. Silence here would
      // make a truncated report look complete.
      capped: window.capped,
      maxYears: REPORT_MAX_YEARS,
      total: counted.reduce((sum, r) => sum + r.count, 0),
      groupBy,
      periods,
      breakdown,
      series: summarise(counted, grain),
      matrices: {
        month_by_week: matrix(counted, 'month_by_week'),
        month_by_day: matrix(counted, 'month_by_day'),
      },
      mayGroupByOrganisation: mayGroupByOrganisation(scope),
      grains: REPORT_GRAINS,
      matrixKinds: REPORT_MATRICES,
    };
  }

  async totalsByOrg() {
    const rows = await this.prisma.$queryRaw<
      Array<{ practiceId: string; practiceName: string; mediaType: string; state: string; total: bigint }>
    >`SELECT * FROM core.outbound_totals_by_org()`;

    /*
     * Pivoted here rather than in the browser. The shape a table wants — one
     * row per practice, one column per type — is not the shape a GROUP BY
     * produces, and doing it twice (once per screen) is how two screens come
     * to disagree about a total.
     */
    const byPractice = new Map<
      string,
      { practiceId: string; practiceName: string; byType: Record<string, number>; byState: Record<string, number>; total: number }
    >();

    for (const row of rows) {
      const count = Number(row.total);
      const entry = byPractice.get(row.practiceId) ?? {
        practiceId: row.practiceId,
        practiceName: row.practiceName,
        byType: {},
        byState: {},
        total: 0,
      };
      entry.byType[row.mediaType] = (entry.byType[row.mediaType] ?? 0) + count;
      entry.byState[row.state] = (entry.byState[row.state] ?? 0) + count;
      entry.total += count;
      byPractice.set(row.practiceId, entry);
    }

    const practices = [...byPractice.values()].sort((a, b) => b.total - a.total);
    return {
      practices,
      mediaTypes: [...new Set(rows.map((r) => r.mediaType))].sort(),
      states: [...new Set(rows.map((r) => r.state))].sort(),
      grandTotal: practices.reduce((sum, p) => sum + p.total, 0),
    };
  }

  /**
   * Totals within one practice, broken down by site and department.
   *
   * NO SECURITY DEFINER HERE, and the asymmetry is deliberate: this runs
   * inside the practice scope like every other read, so RLS does the work and
   * no hole is opened. Only the cross-practice question needed one.
   */
  async totalsBySite(practiceId: string | undefined) {
    if (!practiceId) throw new BadRequestException('Choose a practice first.');
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.outboundItem.groupBy({
        by: ['locationId', 'departmentId', 'mediaType', 'state'],
        where: { practiceId },
        _count: { _all: true },
      });

      const [locations, departments] = await Promise.all([
        tx.practiceLocation.findMany({ where: { practiceId }, select: { id: true, code: true, address: true } }),
        tx.department.findMany({ where: { practiceId }, select: { id: true, name: true, locationId: true } }),
      ]);
      const locationName = new Map(locations.map((l) => [l.id, l.code ?? l.address]));
      const departmentName = new Map(departments.map((d) => [d.id, d.name]));

      const groups = new Map<
        string,
        {
          key: string;
          locationId: string | null;
          locationName: string | null;
          departmentId: string | null;
          departmentName: string | null;
          byType: Record<string, number>;
          byState: Record<string, number>;
          total: number;
        }
      >();

      for (const row of rows) {
        const key = `${row.locationId ?? '-'}:${row.departmentId ?? '-'}`;
        const count = row._count._all;
        const entry = groups.get(key) ?? {
          key,
          locationId: row.locationId,
          /*
           * A message with no site is not an error — acting-as notices go to
           * the practice itself. Named so, rather than left blank, because a
           * blank row in a total invites somebody to think it is a bug.
           */
          locationName: row.locationId ? (locationName.get(row.locationId) ?? row.locationId.slice(0, 8)) : null,
          departmentId: row.departmentId,
          departmentName: row.departmentId ? (departmentName.get(row.departmentId) ?? null) : null,
          byType: {},
          byState: {},
          total: 0,
        };
        entry.byType[row.mediaType] = (entry.byType[row.mediaType] ?? 0) + count;
        entry.byState[row.state] = (entry.byState[row.state] ?? 0) + count;
        entry.total += count;
        groups.set(key, entry);
      }

      const sites = [...groups.values()].sort((a, b) => b.total - a.total);
      return {
        sites,
        mediaTypes: [...new Set(rows.map((r) => r.mediaType))].sort(),
        states: [...new Set(rows.map((r) => r.state))].sort(),
        grandTotal: sites.reduce((sum, s) => sum + s.total, 0),
      };
    });
  }

  /** What an operator wants to see: what is stuck, and how badly. */
  async health(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.outboundItem.groupBy({
        by: ['state', 'channel'],
        where: { practiceId },
        _count: { _all: true },
      });
      const oldestPending = await tx.outboundItem.findFirst({
        where: { practiceId, state: { in: ['pending', 'failed'] } },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true, channel: true },
      });
      return {
        counts: rows.map((r) => ({ state: r.state, channel: r.channel, count: r._count._all })),
        oldestWaiting: oldestPending?.availableAt ?? null,
        oldestWaitingChannel: oldestPending?.channel ?? null,
        maxPayloadBytes: MAX_PAYLOAD_BYTES,
      };
    });
  }

  /**
   * Remove sent items older than `days`.
   *
   * SAFE ONLY BECAUSE THIS IS NOT THE EVIDENCE STORE. `Notice` and
   * `NoticeDeliveryEvent` hold what was sent and what happened to it, for the
   * full statutory period. This row's job ended when the item left.
   *
   * It is also necessary rather than tidy: at the modelled volume the table
   * gains 274 million rows a year, and a queue that is never pruned stops
   * being a queue.
   *
   * DEAD ITEMS ARE NEVER PRUNED HERE. They are the record of a delivery we
   * could not make.
   */
  async pruneSent(practiceId: string, days = 30) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const result = await tx.outboundItem.deleteMany({
        where: { practiceId, state: 'sent', sentAt: { lt: cutoff } },
      });
      return { removed: result.count, olderThan: cutoff };
    });
  }
}
