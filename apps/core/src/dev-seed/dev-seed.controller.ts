import { BadRequestException, Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';

/** Named honestly: nobody reviewed or composed these rows — a seed wrote them. */
const DEV_SEED_AUTHOR = 'dev seed (not a human review)';

/**
 * A stable id from the practice id plus a label, so re-running the seed
 * rewrites its own rows instead of stacking a second set beside them. Shaped
 * as a v5 UUID because every id column here is `@db.Uuid`.
 */
function devId(practiceId: string, label: string): string {
  const h = createHash('sha1').update(`aob-dev-correspondence:${practiceId}:${label}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** One seeded correspondence row, before it is stamped with the shared fields. */
interface SeededDispatch {
  key: string;
  recipientId: string;
  recipientName: string;
  to: string;
  channel: string;
  mediaType: string;
  subject: string;
  bodyText: string | null;
  subjectType: string;
  subjectId: string;
  state: string;
  queuedAt: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  failureReason?: string;
  contentRemovedAt?: Date;
  /** Set on the 89AA row: the statutory notice this correspondence mirrors. */
  notice?: { agreementId: string; practitionerName: string; patientName: string; serviceDate: Date; benefitAmountCents: number };
}

/**
 * Correspondence state to the transport state behind it. The transport only
 * ever knows it handed the message over; "delivered" is a receipt that comes
 * back afterwards, which is why both map to `sent`.
 */
const TRANSPORT_STATE: Record<string, string> = {
  delivered: 'sent',
  sent: 'sent',
  failed: 'failed',
  dead: 'dead',
  queued: 'pending',
};

@Controller('dev')
export class DevSeedController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  /**
   * A REGISTERED TABLET AND ITS PAIRING CODE, WITHOUT A SIGNED-IN USER — dev
   * only, and the reason it exists is worth stating plainly.
   *
   * `POST /devices` REFUSES an unattributed request by design: registering a
   * tablet hands out the credential that opens a practice's waiting list, and
   * an audit line naming nobody is worse than a refusal. The Playwright kiosk
   * suite has no Keycloak session — the console's sign-in is a passkey
   * ceremony against the dev realm — so it cannot call that endpoint.
   *
   * The wrong fix would be to relax `POST /devices` so a test can pass, which
   * removes the property the test suite exists to protect. So the DEV surface
   * takes the weight instead: behind `NODE_ENV !== 'production'`, in the
   * module that already conjures whole practices out of nothing, attributed
   * honestly to a seed rather than to a person. The code it returns goes
   * through the SAME public `POST /devices/pair` as a real tablet's, so the
   * suite exercises the real pairing path and only the console button is
   * stubbed.
   */
  @Post('kiosk-device')
  async devKioskDevice(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() body: { label?: string } | undefined,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev seeding does not exist in production.');
    }
    if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
    return this.devices.registerForDev(practiceId, body?.label?.trim() || 'Dev tablet');
  }

  /** Creates one sample practice with a GP, a patient and a self-assignor. Dev only. */
  @Post('seed')
  async seed() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev seeding does not exist in production.');
    }
    const practiceId = randomUUID();
    return this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.create({
        data: {
          id: practiceId,
          name: `Sample Practice ${practiceId.slice(0, 8)}`,
          // Marked validated by the seed itself, so the org/affiliation
          // endpoints work against a seeded practice. Named honestly: the
          // record says a seed did this, not that a reviewer did.
          validationState: 'validated',
          validatedByName: DEV_SEED_AUTHOR,
          validatedAt: new Date(),
        },
      });
      /*
       * LINKED TO THE MOCK ADAPTER'S FIXTURES, on purpose. Without
       * `pmsLinkageKey` the seeded patient looked complete and two things
       * silently did not happen in the running stack: write-back
       * (`WriteBackService.attempt` leaves an unlinked patient unwritten —
       * "cannot land the artefact where an auditor looks") and verification
       * against the live PMS record (ADR A-08). The values match
       * apps/connector/src/mock-adapter.ts exactly, so the seeded practice
       * behaves like a connected one end to end. Email and mobile are what
       * let the capture cascade actually send this patient a link.
       */
      const provider = await tx.provider.create({
        data: {
          practiceId,
          name: 'Dr Example Provider',
          providerType: 'general_practitioner',
          placeOfPracticeAddress: '1 Example Street, Sampletown NSW 2000',
          pmsLinkageKey: 'mock-prov-001',
        },
      });
      const patient = await tx.patient.create({
        data: {
          practiceId,
          familyName: 'Testpatient',
          givenNames: 'Alex',
          dateOfBirth: new Date('1957-03-14'),
          genderAsIdentified: 'male',
          address: '1 Example Street, Sampletown NSW 2000',
          patientRecordNumber: 'SAMPLE-0001',
          pmsLinkageKey: 'mock-pat-001',
          email: 'alex.testpatient@example.invalid',
          mobile: '+61400000000',
        },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Alex Testpatient', authorityBasis: 'self' },
      });
      return {
        practiceId: practice.id,
        providerId: provider.id,
        patientId: patient.id,
        assignorId: assignor.id,
      };
    });
  }

  /**
   * REPRESENTATIVE CORRESPONDENCE FOR A PRACTICE THAT ALREADY EXISTS.
   *
   * The log cannot be judged against a practice whose only messages are admin
   * notices: every segment but "all" draws empty and every delivery state but
   * "sent" is unreachable, so the screen looks finished when nothing about it
   * has been seen. This fills the practice the reviewer is signed in as — it
   * never creates one, because the point is to read the log as that user.
   *
   * ONE ROW PER THING THE SCREEN DRAWS: a capture link, the second and third
   * chase after it (the attempt ordinal is read back off these rows, never
   * stored), a signed copy, an 89AA notice — which must render with no chase
   * action, ever (CLAUDE.md rule 7) — a bounced send with its reason, a dead
   * one, a queued postal item on a non-email channel, and one row the
   * retention sweep has already emptied, which must say the text is gone
   * rather than show a blank. Plus a suppressed visit, which is a row here and
   * never a row quietly missing.
   *
   * RE-RUNNABLE. Every id is derived from the practice id, so a second call
   * rewrites the same rows instead of adding a second set of them.
   */
  @Post('seed-correspondence')
  async seedCorrespondence(
    @Headers('x-practice-id') headerPracticeId: string | undefined,
    @Body() body: { practiceId?: string } | undefined,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev seeding does not exist in production.');
    }
    const practiceId = (headerPracticeId ?? body?.practiceId ?? '').trim();
    if (!practiceId) throw new BadRequestException('x-practice-id header (or body.practiceId) is required.');

    const id = (label: string) => devId(practiceId, label);
    /** Fixed offsets from now, so the log always has a recent, readable spread. */
    const ago = (days: number, hour: number, minute: number) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      d.setHours(hour, minute, 0, 0);
      return d;
    };
    const plusTwoYears = (from: Date) => {
      const d = new Date(from);
      d.setFullYear(d.getFullYear() + 2);
      return d;
    };

    return this.prisma.withPractice(practiceId, async (tx) => {
      // RLS is fail-closed, so a wrong id reads as "no practice" rather than as somebody else's.
      const practice = await tx.practice.findFirst({ where: { id: practiceId }, select: { id: true, name: true } });
      if (!practice) throw new BadRequestException('No such practice in this scope — check the practice id.');

      const providerId = id('provider');
      await tx.provider.upsert({
        where: { id: providerId },
        create: {
          id: providerId,
          practiceId,
          name: 'Dr Sample Provider',
          providerType: 'general_practitioner',
          placeOfPracticeAddress: '2 Example Street, Sampletown NSW 2000',
        },
        update: {},
      });

      // Obviously fake identities, .invalid addresses, no Medicare-format numbers (CLAUDE.md §7).
      const people = [
        {
          key: 'p1',
          familyName: 'Sampleton',
          givenNames: 'Jamie',
          dateOfBirth: new Date('1962-08-04'),
          patientRecordNumber: 'DEV-CORR-0001',
          email: 'jamie.sampleton@example.invalid',
          mobile: '+61400000101',
        },
        {
          key: 'p2',
          familyName: 'Placeholder',
          givenNames: 'Morgan',
          dateOfBirth: new Date('1971-11-22'),
          patientRecordNumber: 'DEV-CORR-0002',
          email: 'morgan.placeholder@example.invalid',
          mobile: '+61400000102',
        },
        {
          key: 'p3',
          familyName: 'Notional',
          givenNames: 'Ash',
          dateOfBirth: new Date('1949-02-17'),
          patientRecordNumber: 'DEV-CORR-0003',
          email: 'ash.notional@example.invalid',
          mobile: '+61400000103',
        },
      ];
      for (const person of people) {
        const patientId = id(person.key);
        await tx.patient.upsert({
          where: { id: patientId },
          create: {
            id: patientId,
            practiceId,
            familyName: person.familyName,
            givenNames: person.givenNames,
            dateOfBirth: person.dateOfBirth,
            genderAsIdentified: 'unspecified',
            address: '2 Example Street, Sampletown NSW 2000',
            patientRecordNumber: person.patientRecordNumber,
            email: person.email,
            mobile: person.mobile,
            // The enduring pathway is MyMedicare-gated, and p3 is the one who gets a notice.
            myMedicareRegistered: person.key === 'p3',
          },
          update: {},
        });
        const assignorId = id(`${person.key}-assignor`);
        await tx.assignor.upsert({
          where: { id: assignorId },
          create: {
            id: assignorId,
            practiceId,
            name: `${person.givenNames} ${person.familyName}`,
            dateOfBirth: person.dateOfBirth,
            authorityBasis: 'self',
            contactEmail: person.email,
            contactMobile: person.mobile,
          },
          update: {},
        });
      }

      // The confidentiality-flagged patient has NO agreement and no message.
      // Their suppressed entry reaches the log from the service record below.
      const suppressedPatientId = id('p4');
      await tx.patient.upsert({
        where: { id: suppressedPatientId },
        create: {
          id: suppressedPatientId,
          practiceId,
          familyName: 'Hypothetical',
          givenNames: 'Sam',
          dateOfBirth: new Date('2009-06-30'),
          genderAsIdentified: 'unspecified',
          address: '2 Example Street, Sampletown NSW 2000',
          patientRecordNumber: 'DEV-CORR-0004',
          confidentialityFlag: true,
        },
        update: {},
      });

      const agreements: Array<{ key: string; person: string; type: string; status: string; pathway: string | null }> = [
        { key: 'agA', person: 'p1', type: 'episodic_pre', status: 'stored', pathway: null },
        { key: 'agB', person: 'p2', type: 'episodic_post', status: 'draft', pathway: null },
        { key: 'agC', person: 'p3', type: 'enduring', status: 'stored', pathway: 'mymedicare' },
      ];
      for (const a of agreements) {
        const agreementId = id(a.key);
        await tx.agreement.upsert({
          where: { id: agreementId },
          create: {
            id: agreementId,
            practiceId,
            type: a.type,
            anchorKind: 'provider',
            providerId,
            patientId: id(a.person),
            assignorId: id(`${a.person}-assignor`),
            assignorIsPatient: true,
            enduringPathway: a.pathway,
            status: a.status,
          },
          update: {},
        });
      }

      /*
       * THE ORDINAL IS READ, NOT STORED. CorrespondenceService.withAttempts
       * counts messages per agreement through the capture request, so a chase
       * only reads as "Reminder 2" if a real capture request stands behind it.
       */
      const captureA = id('captureA');
      const captureB = id('captureB');
      await tx.captureRequest.upsert({
        where: { id: captureA },
        create: {
          id: captureA,
          practiceId,
          agreementId: id('agA'),
          channel: 'email_link',
          status: 'completed',
          completedAt: ago(7, 11, 20),
        },
        update: {},
      });
      await tx.captureRequest.upsert({
        where: { id: captureB },
        create: {
          id: captureB,
          practiceId,
          agreementId: id('agB'),
          channel: 'email_link',
          status: 'open',
          expiresAt: ago(-2, 9, 0),
        },
        update: {},
      });

      const serviceRecordId = id('service-suppressed');
      await tx.serviceRecord.upsert({
        where: { id: serviceRecordId },
        create: {
          id: serviceRecordId,
          practiceId,
          pmsInvoiceKey: 'DEV-CORR-INV-0001',
          patientId: suppressedPatientId,
          providerId,
          serviceDate: ago(6, 0, 0),
          mbsItemNumbers: ['23'],
          // The one suppression reason the log shows; the rest belong on the queue.
          captureSuppressedReason: 'confidentiality_flag',
          captureSuppressedAt: ago(6, 8, 5),
        },
        update: {},
      });

      /*
       * NO TRANSPORT IS CLAIMED. `outboundItemId` and `noticeId` stay null
       * because nothing carried these — inventing a transport id would make
       * the seed assert a send that never happened.
       */
      const rows: SeededDispatch[] = [
        {
          key: 'c1',
          recipientId: id('p1'),
          recipientName: 'Jamie Sampleton',
          to: 'jamie.sampleton@example.invalid',
          channel: 'email',
          mediaType: 'email',
          subject: 'Your agreement to assign the Medicare benefit',
          bodyText:
            'Hello Jamie,\n\nDr Sample Provider has asked you to complete an assignment of benefit for your ' +
            'service. Open the link below to read the particulars and sign.\n\nThe link expires in 48 hours.',
          subjectType: 'CaptureRequest',
          subjectId: captureA,
          state: 'delivered',
          queuedAt: ago(12, 9, 5),
          sentAt: ago(12, 9, 5),
          deliveredAt: ago(12, 9, 6),
        },
        {
          key: 'c2',
          recipientId: id('p1'),
          recipientName: 'Jamie Sampleton',
          to: 'jamie.sampleton@example.invalid',
          channel: 'email',
          mediaType: 'email',
          subject: 'Reminder: your agreement is still to sign',
          bodyText: 'Hello Jamie,\n\nYour assignment of benefit is still waiting for a signature.',
          subjectType: 'CaptureRequest',
          subjectId: captureA,
          state: 'sent',
          queuedAt: ago(10, 10, 30),
          sentAt: ago(10, 10, 30),
        },
        {
          key: 'c3',
          recipientId: id('p1'),
          recipientName: 'Jamie Sampleton',
          to: '+61400000101',
          channel: 'sms',
          mediaType: 'text',
          subject: 'Agreement reminder',
          bodyText: 'Sampletown Medical: your assignment of benefit is still to sign. The link expires tomorrow.',
          subjectType: 'CaptureRequest',
          subjectId: captureA,
          state: 'delivered',
          queuedAt: ago(8, 14, 45),
          sentAt: ago(8, 14, 45),
          deliveredAt: ago(8, 14, 46),
        },
        {
          key: 'c4',
          recipientId: id('p1'),
          recipientName: 'Jamie Sampleton',
          to: 'jamie.sampleton@example.invalid',
          channel: 'email',
          mediaType: 'email',
          // No benefit or dollar amount on an agreement artefact (hard rule 4).
          subject: 'Your signed agreement',
          bodyText: 'Hello Jamie,\n\nA copy of the agreement you signed is attached for your records.',
          subjectType: 'Agreement',
          subjectId: id('agA'),
          state: 'delivered',
          queuedAt: ago(7, 11, 25),
          sentAt: ago(7, 11, 25),
          deliveredAt: ago(7, 11, 26),
        },
        {
          key: 'c5',
          recipientId: id('p1'),
          recipientName: 'Jamie Sampleton',
          to: 'jamie.sampleton@example.invalid',
          channel: 'email',
          mediaType: 'email',
          subject: 'Your signed agreement',
          // The retention sweep already took the words. The row stays and says so.
          bodyText: null,
          contentRemovedAt: ago(20, 2, 0),
          subjectType: 'Agreement',
          subjectId: id('agA'),
          state: 'delivered',
          queuedAt: ago(760, 9, 15),
          sentAt: ago(760, 9, 15),
          deliveredAt: ago(760, 9, 16),
        },
        {
          key: 'c6',
          recipientId: id('p2'),
          recipientName: 'Morgan Placeholder',
          to: 'morgan.placeholder@example.invalid',
          channel: 'email',
          mediaType: 'email',
          subject: 'Your agreement to assign the Medicare benefit',
          bodyText: 'Hello Morgan,\n\nOpen the link below to read the particulars and sign.',
          subjectType: 'CaptureRequest',
          subjectId: captureB,
          state: 'failed',
          queuedAt: ago(5, 8, 40),
          failedAt: ago(5, 8, 41),
          failureReason: '550 mailbox unavailable at the receiving server',
        },
        {
          key: 'c7',
          recipientId: id('p2'),
          recipientName: 'Morgan Placeholder',
          to: '+61400000102',
          channel: 'sms',
          mediaType: 'text',
          subject: 'Agreement reminder',
          bodyText: 'Sampletown Medical: we could not reach you by email. Your agreement is still to sign.',
          subjectType: 'CaptureRequest',
          subjectId: captureB,
          state: 'dead',
          queuedAt: ago(4, 16, 10),
          failedAt: ago(4, 16, 12),
          failureReason: 'handset unreachable after five attempts',
        },
        {
          key: 'c8',
          recipientId: id('p2'),
          recipientName: 'Morgan Placeholder',
          // A non-email channel that has not gone anywhere yet: it waits to be printed.
          to: '2 Example Street, Sampletown NSW 2000',
          channel: 'paper',
          mediaType: 'pdf',
          subject: 'Agreement to sign — posted copy',
          bodyText: 'Printed agreement and a reply-paid envelope, for a patient we cannot reach online.',
          subjectType: 'CaptureRequest',
          subjectId: captureB,
          state: 'queued',
          queuedAt: ago(1, 9, 0),
        },
        {
          key: 'c9',
          recipientId: id('p3'),
          recipientName: 'Ash Notional',
          to: 'ash.notional@example.invalid',
          channel: 'email',
          mediaType: 'email',
          /*
           * The 89AA notice — the ONE artefact that carries a benefit amount
           * (hard rule 4), and the one that is never chased on any surface
           * (hard rule 7). It says what was billed and asks for nothing back,
           * so the screen must draw no action beside it.
           */
          subject: 'Notice: a service was billed under your ongoing agreement',
          bodyText:
            'Hello Ash,\n\nDr Sample Provider billed a service under the ongoing agreement you signed. ' +
            'The Medicare benefit assigned was $41.40.\n\nThis notice is for your information only. ' +
            'You do not need to reply.',
          subjectType: 'Notice',
          subjectId: id('notice-c'),
          notice: {
            agreementId: id('agC'),
            practitionerName: 'Dr Sample Provider',
            patientName: 'Ash Notional',
            serviceDate: ago(3, 0, 0),
            benefitAmountCents: 4140,
          },
          state: 'delivered',
          queuedAt: ago(3, 10, 0),
          sentAt: ago(3, 10, 0),
          deliveredAt: ago(3, 10, 2),
        },
      ];

      /*
       * EVERY CORRESPONDENCE ROW MIRRORS AN ORIGINAL, and the database says
       * so: `correspondence_mirrors_a_send` requires an outbound item or a
       * notice. That is the invariant the evidence twin exists for, so the
       * seed creates the original rather than working around the constraint.
       */
      for (const row of rows) {
        const rowId = id(row.key);
        const transportState = TRANSPORT_STATE[row.state];
        let outboundItemId: string | null = null;
        let noticeId: string | null = null;

        if (row.notice) {
          noticeId = row.subjectId;
          await tx.notice.upsert({
            where: { id: noticeId },
            create: {
              id: noticeId,
              practiceId,
              agreementId: row.notice.agreementId,
              claimReference: 'DEV-CORR-CLAIM-0001',
              claimLodgedAt: ago(3, 8, 0),
              practitionerName: row.notice.practitionerName,
              patientName: row.notice.patientName,
              serviceDate: row.notice.serviceDate,
              benefitAmountCents: row.notice.benefitAmountCents,
              // REQ-DEL-02: the dispatch channel must equal the method named in the agreement.
              agreementMethod: row.channel,
              dispatchChannel: row.channel,
              payloadHash: createHash('sha256').update(row.bodyText ?? '').digest('hex'),
              composedAt: ago(3, 9, 55),
              dispatchedAt: row.sentAt ?? null,
              deliveredAt: row.deliveredAt ?? null,
              attempts: 1,
            },
            update: {},
          });
        } else {
          outboundItemId = id(`${row.key}-outbound`);
          await tx.outboundItem.upsert({
            where: { id: outboundItemId },
            create: {
              id: outboundItemId,
              practiceId,
              channel: row.channel,
              destination: row.to,
              subjectType: row.subjectType,
              subjectId: row.subjectId,
              payload: { subject: row.subject, body: row.bodyText, sentBy: DEV_SEED_AUTHOR },
              mediaType: row.mediaType,
              recipientType: 'patient',
              recipientId: row.recipientId,
              recipientName: row.recipientName,
              state: transportState,
              attempts: transportState === 'sent' ? 1 : transportState === 'pending' ? 0 : 4,
              /*
               * PARKED PAST ANY BACKOFF. The worker claims pending and failed
               * items whose availableAt has passed; left at now, it would
               * retry these fixtures and rewrite the very states the reviewer
               * opened the screen to look at. (The `paper` row is safe either
               * way — the worker only claims email, sms and webhook.)
               */
              availableAt: transportState === 'sent' ? (row.sentAt ?? row.queuedAt) : ago(-3650, 9, 0),
              idempotencyKey: `dev-seed-correspondence:${row.key}`,
              createdAt: row.queuedAt,
              sentAt: transportState === 'sent' ? (row.sentAt ?? row.queuedAt) : null,
              lastError: row.failureReason ?? null,
            },
            update: {},
          });
        }

        const data = {
          practiceId,
          recipientType: 'patient',
          recipientId: row.recipientId,
          recipientName: row.recipientName,
          to: row.to,
          channel: row.channel,
          mediaType: row.mediaType,
          subject: row.subject,
          bodyText: row.bodyText,
          bodyHtml: null,
          // Named honestly: a seed made this row, no person composed it.
          sentBy: DEV_SEED_AUTHOR,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          outboundItemId,
          noticeId,
          state: row.state,
          queuedAt: row.queuedAt,
          sentAt: row.sentAt ?? null,
          deliveredAt: row.deliveredAt ?? null,
          failedAt: row.failedAt ?? null,
          failureReason: row.failureReason ?? null,
          contentRemovedAt: row.contentRemovedAt ?? null,
          retentionExpiryDate: plusTwoYears(row.sentAt ?? row.queuedAt),
        };
        await tx.correspondence.upsert({ where: { id: rowId }, create: { id: rowId, ...data }, update: data });
      }

      return {
        practiceId,
        practiceName: practice.name,
        correspondenceRows: rows.length,
        suppressedServiceRecords: 1,
        seededBy: DEV_SEED_AUTHOR,
      };
    });
  }
}
