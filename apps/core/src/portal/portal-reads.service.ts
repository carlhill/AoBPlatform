import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CONFIRMABLE_DETAIL_TYPES,
  ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY,
  ENDURING_TERMINATION_NOTICE_VERSION,
  TERMINATION_NOTICE_DRAFT_STATUS,
  isConfirmableDetailType,
} from '@aobplatform/domain';
import type {
  PortalAccessLogEntry,
  PortalAgreement,
  PortalAssignorOfMine,
  PortalAssignors,
  PortalCorrectionRequestResult,
  PortalDetails,
  PortalEnduring,
  PortalLink,
  PortalMessage,
  PortalNotice,
  PortalTerminationResult,
  PortalVisit,
} from '@aobplatform/contracts';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { RendererRegistry } from '../render/renderer-registry';
import { EnduringService } from '../enduring/enduring.service';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';
import { PortalScope } from './portal-scope';
import { PortalService } from './portal.service';

/**
 * WHAT THE PATIENT CAN SEE — the reads half of C8.
 *
 * ONE RULE RUNS THROUGH EVERY METHOD HERE AND IT IS WORTH STATING ONCE. No
 * endpoint takes a practice id or a patient id from the caller and trusts it.
 * Each read starts from `PortalService.linksFor(accountId)` — the (practice,
 * patient) pairs this account activated for itself — and then runs each pair
 * through `prisma.withPractice`, so the practice's own RLS scope is the floor
 * under the application's filter. That is why cross-account access fails
 * closed twice: the account's link set does not contain the other person's
 * pair, and even a bug that got past that would be querying under the wrong
 * `app.practice_id`.
 *
 * PER LINK, NOT MERGED. Two practices may hold different addresses for the same
 * person, legitimately — the PMS is the master (REQ-DATA-10). Merging them
 * would invent a single truth the platform does not have, so the details card
 * is a list and the screen says which practice each row came from.
 */
@Injectable()
export class PortalReadsService {
  private readonly logger = new Logger(PortalReadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScope,
    private readonly portal: PortalService,
    private readonly renderers: RendererRegistry,
    private readonly enduring: EnduringService,
    private readonly reviewTasks: ReviewTasksService,
  ) {}

  // -------------------------------------------------------------------------
  // My details
  // -------------------------------------------------------------------------

  /**
   * The five details, as each practice holds them.
   *
   * THERE IS NO MEDICARE NUMBER HERE AND NOWHERE TO PUT ONE. `PortalDetails`
   * has no such field, this method selects no such column, and the patient row
   * does not carry one (HARD-03). The card number is not an identity identifier
   * and its exclusion is not configurable (hard rule 1, REQ-VER-02) — showing
   * it on a portal page would be the same mistake wearing a different hat.
   */
  async details(accountId: string): Promise<PortalDetails[]> {
    const links = await this.portal.linksFor(accountId);
    const out: PortalDetails[] = [];
    for (const link of links) {
      const patient = await this.prisma.withPractice(link.practiceId, (tx) =>
        tx.patient.findFirst({
          where: { id: link.patientId },
          select: {
            familyName: true,
            givenNames: true,
            dateOfBirth: true,
            address: true,
            mobile: true,
            email: true,
            patientRecordNumber: true,
          },
        }),
      );
      if (!patient) continue;
      out.push({
        practiceId: link.practiceId,
        practiceName: link.practiceName,
        patientId: link.patientId,
        familyName: patient.familyName,
        givenNames: patient.givenNames,
        dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
        address: patient.address,
        mobile: patient.mobile,
        email: patient.email,
        patientRecordNumber: patient.patientRecordNumber,
      });
    }
    return out;
  }

  /**
   * "Ask the practice to correct this" — APP 13 routed to the record owner.
   *
   * THE REQUEST CARRIES NO NEW VALUE, and the DTO has no field for one. The PMS
   * is the master; reception confirms the right value with the patient in
   * person and types it there. A portal that accepted a replacement value would
   * be an unverified channel writing into a clinical system, and the platform
   * would have no way to tell a correction from a takeover.
   */
  async requestCorrection(
    accountId: string,
    input: { practiceId: string; fieldType: string },
  ): Promise<PortalCorrectionRequestResult> {
    if (!isConfirmableDetailType(input.fieldType)) {
      throw new BadRequestException(
        `"${input.fieldType}" is not a detail this platform holds. One of: ${CONFIRMABLE_DETAIL_TYPES.join(', ')}.`,
      );
    }
    const link = await this.portal.requireLink(accountId, input.practiceId);

    return this.prisma.withPractice(link.practiceId, async (tx) => {
      const task = await this.reviewTasks.raise(tx, {
        practiceId: link.practiceId,
        kind: 'portal_correction_requested',
        subjectType: 'Patient',
        subjectId: link.patientId,
        /*
         * THE SUMMARY NAMES THE FIELD TYPE AND NOBODY. A reviewer opens the
         * patient's own record to see the value; putting it in the summary
         * would copy a detail into a queue table that has no encryption story
         * and gets read across a room (REQ-LOG-08).
         */
        summary: `A patient says the ${input.fieldType.replace(/_/g, ' ')} we hold is wrong.`,
        detail: { fieldType: input.fieldType, raisedFrom: 'patient_portal' },
        raisedBy: 'patient_portal',
      });

      await enqueueVaultEvent(tx, {
        type: 'portal.correction_requested',
        actor: { principalType: 'patient', id: accountId },
        subject: { type: 'Patient', id: link.patientId },
        // The TYPE, never the value shown and never the value they believe is
        // right — they were not asked for one (REQ-VER-04, hard rule 9).
        payload: { fieldType: input.fieldType, reviewTaskId: task.id, valueSupplied: false },
      });

      return { raised: true as const, reviewTaskId: task.id, practiceId: link.practiceId, fieldType: input.fieldType };
    });
  }

  // -------------------------------------------------------------------------
  // My agreements
  // -------------------------------------------------------------------------

  /**
   * Every agreement, across every practice the patient linked (REQ-PORT-01).
   *
   * NO AMOUNT FIELD EXISTS ON THE WAY OUT (hard rule 4). Agreements carry no
   * dollar figure at all — not in the particulars, not on the row — and the
   * response type has nowhere to put one. The one place a benefit amount
   * appears in this whole module is `notices()`, and it is a different card for
   * exactly that reason.
   */
  async agreements(accountId: string): Promise<PortalAgreement[]> {
    const links = await this.portal.linksFor(accountId);
    const out: PortalAgreement[] = [];

    for (const link of links) {
      const rows = await this.prisma.withPractice(link.practiceId, async (tx) => {
        const agreements = await tx.agreement.findMany({
          where: { patientId: link.patientId },
          orderBy: { createdAt: 'desc' },
        });
        const ids = agreements.map((a) => a.id);
        const signatures = await tx.signatureEvent.findMany({ where: { agreementId: { in: ids } } });
        const captures = await tx.captureRequest.findMany({ where: { agreementId: { in: ids } } });
        const providers = await tx.provider.findMany({
          where: { id: { in: agreements.map((a) => a.providerId).filter((id): id is string => Boolean(id)) } },
        });
        return { agreements, signatures, captures, providers };
      });

      const signatureByAgreement = new Map(rows.signatures.map((s) => [s.agreementId, s]));
      const captureByAgreement = new Map(rows.captures.map((c) => [c.agreementId, c]));
      const providerById = new Map(rows.providers.map((p) => [p.id, p]));

      for (const agreement of rows.agreements) {
        const particulars = (agreement.particulars ?? {}) as Record<string, unknown>;
        const signature = signatureByAgreement.get(agreement.id);
        const capture = captureByAgreement.get(agreement.id);
        out.push({
          id: agreement.id,
          practiceId: link.practiceId,
          practiceName: link.practiceName,
          providerName: agreement.providerId ? (providerById.get(agreement.providerId)?.name ?? null) : null,
          type: agreement.type,
          status: agreement.status,
          serviceDate: typeof particulars.serviceDate === 'string' ? particulars.serviceDate : null,
          serviceDescription:
            agreement.serviceDescription ??
            (typeof particulars.basicServiceDescription === 'string'
              ? particulars.basicServiceDescription
              : null),
          channel: signature?.channel ?? capture?.channel ?? null,
          signedAt: signature?.createdAt.toISOString() ?? null,
          /*
           * FALSE RATHER THAN ABSENT, and it is a real check rather than a
           * "has it locked" shortcut. The artefact is re-rendered on download
           * under the renderer version recorded ON the agreement (rule 13); an
           * agreement locked under a renderer this build no longer registers
           * cannot be re-verified, so the screen must offer no download rather
           * than one that 409s in the patient's hand.
           */
          artefactAvailable:
            Boolean(agreement.renderedArtefactHash) && this.renderers.get(agreement.rendererVersion) !== undefined,
        });
      }
    }
    return out;
  }

  /**
   * The rendered agreement AS SIGNED — REQ-PORT-02, which automates the s 65C
   * copy-on-request obligation.
   *
   * RULE 13 IS THE WHOLE METHOD. The bytes are not fetched from a store: they
   * are RE-RENDERED, deterministically, under the renderer version recorded on
   * the agreement, and the hash is compared with the one recorded at lock. Two
   * renders of the same agreement are byte-identical, so a mismatch is a tamper
   * signal rather than a transient error — and 409 is the honest answer,
   * because the conflict is between the record and the artefact and no retry
   * fixes it.
   *
   * READING EVIDENCE IS ITSELF EVIDENCE (REQ-LOG-07). The event says the
   * patient took their own copy, with the hash they were given.
   */
  async artefact(
    accountId: string,
    agreementId: string,
  ): Promise<{ bytes: Buffer; mediaType: string; filename: string; sha256: string }> {
    const links = await this.portal.linksFor(accountId);

    for (const link of links) {
      const agreement = await this.prisma.withPractice(link.practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId, patientId: link.patientId } }),
      );
      if (!agreement) continue;

      if (!agreement.particularsLockedAt || !agreement.renderedArtefactHash) {
        throw new NotFoundException('This agreement has no signed copy yet.');
      }
      const renderer = this.renderers.get(agreement.rendererVersion);
      if (!renderer) {
        // 409 rather than 500: the record is intact and the platform simply
        // cannot honour rule 13 for it today. Saying so is better than serving
        // bytes whose hash nothing checked.
        throw new ConflictException(
          'This copy cannot be re-verified with the renderer it was made under, so it will not be served.',
        );
      }

      const rendered = await renderer.render(
        agreement.particulars as Record<string, unknown>,
        agreement.renderedLanguages,
      );
      if (rendered.sha256 !== agreement.renderedArtefactHash) {
        this.logger.error(
          `Agreement ${agreementId} re-rendered to ${rendered.sha256}, recorded ${agreement.renderedArtefactHash}. ` +
            'Refusing to serve it.',
        );
        throw new ConflictException(
          'This copy no longer matches the hash recorded when it was signed, so it will not be served. ' +
            'That is a tamper signal, not a transient error.',
        );
      }

      await this.prisma.withPractice(link.practiceId, (tx) =>
        enqueueVaultEvent(tx, {
          type: 'artefact.accessed',
          actor: { principalType: 'patient', id: accountId },
          subject: { type: 'Agreement', id: agreementId },
          payload: { action: 'portal_download', sha256: rendered.sha256, rendererVersion: rendered.rendererVersion },
        }),
      );

      return {
        bytes: rendered.bytes,
        mediaType: rendered.mediaType,
        filename: `agreement-${agreementId}${rendered.mediaType === 'application/pdf' ? '.pdf' : '.json'}`,
        sha256: rendered.sha256,
      };
    }

    // The same 404 an unknown id gets. An agreement belonging to somebody else
    // must not be distinguishable from one that does not exist.
    throw new NotFoundException('That agreement is not on your record.');
  }

  // -------------------------------------------------------------------------
  // Enduring
  // -------------------------------------------------------------------------

  /** REQ-PORT-03 — what is still in force, per provider. Never per practice (hard rule 6). */
  async enduringAgreements(accountId: string): Promise<PortalEnduring[]> {
    const links = await this.portal.linksFor(accountId);
    const now = new Date();
    const out: PortalEnduring[] = [];

    for (const link of links) {
      const rows = await this.prisma.withPractice(link.practiceId, async (tx) => {
        const agreements = await tx.agreement.findMany({
          where: { patientId: link.patientId, type: 'enduring' },
        });
        const details = await tx.enduringDetail.findMany({
          where: { agreementId: { in: agreements.map((a) => a.id) } },
        });
        const providers = await tx.provider.findMany({
          where: { id: { in: agreements.map((a) => a.providerId).filter((id): id is string => Boolean(id)) } },
        });
        return { agreements, details, providers };
      });

      const detailByAgreement = new Map(rows.details.map((d) => [d.agreementId, d]));
      const providerById = new Map(rows.providers.map((p) => [p.id, p]));

      for (const agreement of rows.agreements) {
        const detail = detailByAgreement.get(agreement.id);
        if (!detail) continue;
        if (detail.ceasedAt && detail.ceasedAt <= now) continue;
        // Terminated but not yet effective is still ACTIVE, and the patient
        // must keep seeing it — two business days is a period during which the
        // provider is still bound (FR-5.3).
        if (detail.terminationEffectiveAt && detail.terminationEffectiveAt <= now) continue;
        out.push({
          agreementId: agreement.id,
          practiceId: link.practiceId,
          practiceName: link.practiceName,
          providerName: agreement.providerId ? (providerById.get(agreement.providerId)?.name ?? null) : null,
          activeSince: detail.enteredIntoAt.toISOString().slice(0, 10),
        });
      }
    }
    return out;
  }

  /**
   * REQ-PORT-05 / 65CA(7)(b) — the patient ends it, whether or not they signed.
   *
   * THE BUSINESS-DAY RULE IS THE ENDURING MODULE'S, NOT A SECOND COPY. FR-5.3
   * is two BUSINESS days, and `EnduringService.terminate` already computes it
   * against the practice's own state calendar including public holidays, and
   * records which calendar and which dataset version produced the date. A
   * portal-local "+2 weekdays" would have been a second, worse answer to a
   * question with a statutory effect — and it would have quietly disagreed with
   * the console for every termination in the week of a public holiday.
   *
   * TWO TRANSACTIONS, AND THE ORDER IS DELIBERATE. The termination commits
   * first, with its own `agreement.terminated` event, because the patient's
   * right does not wait on our paperwork; the notice draft, the review task and
   * `portal.enduring_terminated` commit together after it. If the second fails,
   * a terminated agreement exists with no draft notice — recoverable and
   * FINDABLE, since `portal_termination_notices.agreementId` is unique and its
   * absence beside a `terminationNoticeAt` is a query. The reverse ordering
   * would risk a notice for a termination that never happened, which is worse
   * and not detectable at all.
   *
   * THE NOTICE IS A DRAFT AND THE DATABASE SAYS SO. Its wording is
   * human-authored regulatory copy that does not exist yet
   * (packages/domain/content/enduring-termination-notice.json ships empty and
   * marked draft), so the row's only permitted status is
   * `draft_pending_review` and a high-stakes review task is raised beside it.
   */
  async terminateEnduring(accountId: string, agreementId: string): Promise<PortalTerminationResult> {
    const links = await this.portal.linksFor(accountId);
    const link = await this.findLinkOwning(links, agreementId, 'enduring');

    const detail = await this.enduring.terminate(link.practiceId, agreementId, { initiatedBy: 'patient' });
    if (!detail.terminationNoticeAt || !detail.terminationEffectiveAt) {
      throw new InternalServerErrorException('The termination recorded no notice date.');
    }
    // Narrowed once, here, rather than with a `!` at each of the six places
    // these two dates are used below — a non-null assertion is a claim, and one
    // check that produced two local constants is a proof.
    const noticeAt = detail.terminationNoticeAt;
    const effectiveAt = detail.terminationEffectiveAt;

    await this.prisma.withPractice(link.practiceId, async (tx) => {
      const task = await this.reviewTasks.raise(tx, {
        practiceId: link.practiceId,
        kind: 'portal_enduring_terminated',
        subjectType: 'Agreement',
        subjectId: agreementId,
        summary: 'A patient ended an enduring agreement from their own page. The written notice is a draft.',
        detail: {
          effectiveAt: effectiveAt.toISOString(),
          noticeTemplateKey: ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY,
          noticeStatus: TERMINATION_NOTICE_DRAFT_STATUS,
        },
        raisedBy: 'patient_portal',
      });

      await tx.portalTerminationNotice.upsert({
        where: { agreementId },
        create: {
          practiceId: link.practiceId,
          agreementId,
          accountId,
          templateKey: ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY,
          templateVersion: ENDURING_TERMINATION_NOTICE_VERSION,
          status: TERMINATION_NOTICE_DRAFT_STATUS,
          noticeAt,
          effectiveAt,
          calendarState: detail.terminationCalendarState ?? 'unknown',
          reviewTaskId: task.id,
        },
        update: {},
      });

      await enqueueVaultEvent(tx, {
        type: 'portal.enduring_terminated',
        actor: { principalType: 'patient', id: accountId },
        subject: { type: 'Agreement', id: agreementId },
        payload: {
          noticeAt: noticeAt.toISOString(),
          effectiveAt: effectiveAt.toISOString(),
          businessDayCalendar: detail.terminationCalendarState ?? 'unknown',
          noticeTemplateKey: ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY,
          noticeStatus: TERMINATION_NOTICE_DRAFT_STATUS,
          reviewTaskId: task.id,
        },
      });
    });

    return {
      agreementId,
      noticeAt: noticeAt.toISOString(),
      effectiveAt: effectiveAt.toISOString(),
      calendar: detail.terminationCalendarState ?? 'unknown',
      noticeTemplateKey: ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY,
      noticeStatus: TERMINATION_NOTICE_DRAFT_STATUS,
    };
  }

  // -------------------------------------------------------------------------
  // 89AA notices — the one card with an amount on it
  // -------------------------------------------------------------------------

  /**
   * REQ-PORT-04 — every reg 89AA claim notification the patient was sent.
   *
   * THE ONE PLACE A BENEFIT AMOUNT APPEARS in this module (hard rule 4), on its
   * own card so it can never bleed into the agreements list.
   *
   * READ-ONLY, AND THERE IS NO STATE FIELD. A notice is one-way: it never gates
   * payment, never carries approval semantics, and is never chased (hard rule
   * 7, REQ-END-05, REQ-CHASE-02). So the response has no status, no
   * acknowledgement and no action — nothing a screen could render as a
   * decision the patient is being asked to make.
   *
   * ONLY DISPATCHED NOTICES. A composed-but-unsent notice has not been sent to
   * the patient, and showing it here would tell them about a message they never
   * received.
   */
  async notices(accountId: string): Promise<PortalNotice[]> {
    const links = await this.portal.linksFor(accountId);
    const out: PortalNotice[] = [];

    for (const link of links) {
      const rows = await this.prisma.withPractice(link.practiceId, async (tx) => {
        const agreements = await tx.agreement.findMany({
          where: { patientId: link.patientId },
          select: { id: true },
        });
        return tx.notice.findMany({
          where: { agreementId: { in: agreements.map((a) => a.id) }, dispatchedAt: { not: null } },
          orderBy: { serviceDate: 'desc' },
        });
      });
      for (const notice of rows) {
        out.push({
          id: notice.id,
          date: notice.serviceDate.toISOString().slice(0, 10),
          providerName: notice.practitionerName,
          practiceName: link.practiceName,
          benefitAmountCents: notice.benefitAmountCents,
        });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  // -------------------------------------------------------------------------
  // Where I have been
  // -------------------------------------------------------------------------

  /**
   * Practices and dates. Derived from AGREEMENT SERVICE DATES ONLY.
   *
   * NEVER A CLINICAL RECORD (CLAUDE.md §8) and never an appointment: the AoB
   * record knows that a service on a date was assigned at a practice, and that
   * is the whole of what this says. There is no reason, no item, no room and no
   * practitioner note anywhere in the shape.
   */
  async visits(accountId: string): Promise<PortalVisit[]> {
    const links = await this.portal.linksFor(accountId);
    const out: PortalVisit[] = [];

    for (const link of links) {
      const { agreements, location } = await this.prisma.withPractice(link.practiceId, async (tx) => ({
        agreements: await tx.agreement.findMany({
          where: { patientId: link.patientId },
          select: { particulars: true },
        }),
        location: await tx.practiceLocation.findFirst({ orderBy: { createdAt: 'asc' } }),
      }));

      const seen = new Set<string>();
      for (const agreement of agreements) {
        const particulars = (agreement.particulars ?? {}) as Record<string, unknown>;
        const date = typeof particulars.serviceDate === 'string' ? particulars.serviceDate.slice(0, 10) : null;
        if (!date || seen.has(date)) continue;
        seen.add(date);
        out.push({
          date,
          practiceId: link.practiceId,
          practiceName: link.practiceName,
          locationLine: location?.address ?? null,
        });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  // -------------------------------------------------------------------------
  // Messages to me — the anti-phishing surface
  // -------------------------------------------------------------------------

  /**
   * REQ-PORT-06 — "is this message genuine?"
   *
   * THE STRUCTURAL ANSWER IS THE LIST ITSELF. A patient who has signed in can
   * see what we actually sent and what is actually waiting on them; a forged
   * SMS has no row here. That is a better answer than any amount of "we will
   * never ask you for…" copy, because it does not depend on the patient reading
   * it in the moment they are being rushed.
   *
   * NO BODIES, DELIBERATELY. The purpose is verification, not re-reading — and
   * a portal that renders message text is a portal that can be made to render
   * an attacker's text if any part of the pipeline is ever compromised. Channel,
   * date, state, a purpose KEY and whether it is still waiting is all the
   * question needs.
   */
  async messages(accountId: string): Promise<PortalMessage[]> {
    const links = await this.portal.linksFor(accountId);
    const now = new Date();
    /*
     * ORDERED ON `orderAt` AND NOT ON `sentAt`, because a queued message has no
     * sent time and `sentAt` says so honestly rather than borrowing the queue
     * time. The ordering clock is stripped before the response — it is a
     * sorting detail, not something a patient needs a second date column for.
     */
    const out: Array<PortalMessage & { orderAt: string }> = [];

    for (const link of links) {
      const { rows, openCaptureIds } = await this.prisma.withPractice(link.practiceId, async (tx) => {
        const found = await tx.correspondence.findMany({
          where: { recipientType: 'patient', recipientId: link.patientId },
          orderBy: { queuedAt: 'desc' },
          take: 200,
          // An explicit select rather than the correspondence module's list
          // shape: `bodyText`, `bodyHtml` and `subject` must not even be loaded
          // into this process for a patient-facing response.
          select: {
            id: true,
            channel: true,
            state: true,
            queuedAt: true,
            sentAt: true,
            subjectType: true,
            subjectId: true,
            noticeId: true,
          },
        });
        const captureIds = found
          .filter((r) => r.subjectType === 'CaptureRequest')
          .map((r) => r.subjectId);
        const open = await tx.captureRequest.findMany({
          where: { id: { in: captureIds }, status: 'open' },
          select: { id: true, expiresAt: true },
        });
        return {
          rows: found,
          openCaptureIds: new Set(
            open.filter((c) => !c.expiresAt || c.expiresAt > now).map((c) => c.id),
          ),
        };
      });

      for (const row of rows) {
        out.push({
          id: row.id,
          channel: row.channel,
          orderAt: (row.sentAt ?? row.queuedAt).toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null,
          state: row.state,
          purposeKey: purposeKeyFor(row.subjectType, row.noticeId),
          practiceName: link.practiceName,
          /*
           * PENDING MEANS "THIS IS STILL ASKING SOMETHING OF YOU" (REQ-PORT-06)
           * — a capture request that is still open and not expired. A notice is
           * never pending, because a notice never asks for anything and is
           * never chased (hard rule 7).
           */
          pending: row.subjectType === 'CaptureRequest' && openCaptureIds.has(row.subjectId),
        });
      }
    }
    return out
      .sort((a, b) => (a.orderAt < b.orderAt ? 1 : -1))
      .map(({ orderAt: _orderAt, ...message }) => message);
  }

  // -------------------------------------------------------------------------
  // Who acts for me / who I act for
  // -------------------------------------------------------------------------

  /**
   * REQ-PORT-07, both directions.
   *
   * `iActFor` IS EMPTY, AND THAT IS A FACT ABOUT THE SCHEMA RATHER THAN A GAP
   * IN THIS METHOD. `Assignor` holds a name, a relationship and an authority
   * basis, but no link to the acting person's OWN patient record — so "which
   * patients does this person act for" could only be answered by matching on a
   * name, and a carer and a patient who happen to share a surname would find
   * each other's records. FR-1.19 (the standing-assignor tier: the assignor
   * verifies their own channel and, for guardianship or EPOA, uploads the
   * instrument) is the mechanism that creates that link, and it is not built.
   * An empty list is the honest answer; an approximate one would be a
   * disclosure.
   */
  async assignors(accountId: string): Promise<PortalAssignors> {
    const links = await this.portal.linksFor(accountId);
    const actsForMe: PortalAssignorOfMine[] = [];

    for (const link of links) {
      const { assignors, earliest, revoked } = await this.prisma.withPractice(link.practiceId, async (tx) => {
        const agreements = await tx.agreement.findMany({
          where: { patientId: link.patientId, assignorIsPatient: false },
          select: { assignorId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        });
        const first = new Map<string, Date>();
        for (const a of agreements) if (!first.has(a.assignorId)) first.set(a.assignorId, a.createdAt);
        return {
          assignors: await tx.assignor.findMany({ where: { id: { in: [...first.keys()] } } }),
          earliest: first,
          revoked: await tx.portalAssignorRevocation.findMany({ where: { patientId: link.patientId } }),
        };
      });

      const revokedIds = new Set(revoked.map((r) => r.assignorId));
      for (const assignor of assignors) {
        actsForMe.push({
          assignorId: assignor.id,
          practiceId: link.practiceId,
          name: assignor.name,
          relationshipKey: assignor.relationshipToPatient,
          /*
           * WHEN THEY FIRST ACTED, taken from the earliest agreement they
           * signed on this patient's behalf. `Assignor` has no createdAt, and
           * the first agreement is the better answer anyway: an assignor row
           * made ten minutes before a signature and one made a year earlier
           * both begin acting at the same moment.
           */
          since: (earliest.get(assignor.id) ?? new Date()).toISOString(),
          active: !revokedIds.has(assignor.id),
        });
      }
    }

    return { actsForMe, iActFor: [] };
  }

  /**
   * FR-1.23 — remove a nomination, at any time, with NO JUSTIFICATION.
   *
   * There is no reason parameter and there must never be one: a nullable field
   * for a reason becomes a question on a screen, and then a required question.
   *
   * IT DOES NOT TOUCH ANY AGREEMENT. Revoking a nomination says who may act
   * from now on; it does not unmake a contract that was validly signed, and a
   * method that quietly voided past agreements would be rewriting evidence
   * (HARD-02 — corrections supersede, they do not edit).
   */
  async revokeAssignor(accountId: string, assignorId: string): Promise<{ revoked: true; assignorId: string }> {
    const links = await this.portal.linksFor(accountId);

    for (const link of links) {
      const found = await this.prisma.withPractice(link.practiceId, async (tx) => {
        const agreement = await tx.agreement.findFirst({
          where: { patientId: link.patientId, assignorId, assignorIsPatient: false },
        });
        return agreement ? link : null;
      });
      if (!found) continue;

      await this.scope.withAccountAtPractice(accountId, link.practiceId, async (tx) => {
        await tx.portalAssignorRevocation.upsert({
          where: { assignorId_patientId: { assignorId, patientId: link.patientId } },
          create: { practiceId: link.practiceId, accountId, assignorId, patientId: link.patientId },
          update: {},
        });
        await enqueueVaultEvent(tx, {
          type: 'portal.assignor_revoked',
          actor: { principalType: 'patient', id: accountId },
          subject: { type: 'Assignor', id: assignorId },
          // No reason field, by design (FR-1.23). Ids only — never the
          // assignor's name, never the patient's.
          payload: { patientId: link.patientId, practiceId: link.practiceId, agreementsChanged: false },
        });
      });
      return { revoked: true as const, assignorId };
    }

    throw new NotFoundException('That person does not act for you.');
  }

  // -------------------------------------------------------------------------
  // Who has looked
  // -------------------------------------------------------------------------

  /**
   * FR-8.2 — the card that answers Carl's question directly.
   *
   * BUILT FROM THE VAULT OUTBOX, which is the same chain the practice's own
   * evidence is written to. Every access is an event, so a correction by
   * reception, a push to a tablet, a re-send and the patient's own downloads
   * all appear here as one timeline rather than as a curated selection.
   *
   * KEYS ONLY. `actionKey` is the event type; nothing in the shape can carry a
   * value, a name or a note (REQ-VER-04, hard rule 9, REQ-LOG-08). The payloads
   * are deliberately NOT surfaced — they are content-free by rule, but "by
   * rule" is not the same as "by construction", and this endpoint reads events
   * written by forty call sites.
   *
   * THE SUBJECT SET IS EXPLICIT, not a search. Each linked patient contributes
   * their patient id, their agreements and their tablet sessions; an event
   * whose subject is none of those is not about them, and a substring match
   * over subject ids would be a way to read somebody else's timeline.
   */
  async accessLog(accountId: string, limit = 200): Promise<PortalAccessLogEntry[]> {
    const links = await this.portal.linksFor(accountId);
    const practiceBySubject = new Map<string, PortalLink>();

    for (const link of links) {
      practiceBySubject.set(link.patientId, link);
      const { agreements, sessions } = await this.prisma.withPractice(link.practiceId, async (tx) => {
        const found = await tx.agreement.findMany({ where: { patientId: link.patientId }, select: { id: true } });
        return {
          agreements: found,
          sessions: await tx.tabletSession.findMany({
            where: { agreementId: { in: found.map((a) => a.id) } },
            select: { id: true },
          }),
        };
      });
      for (const a of agreements) practiceBySubject.set(a.id, link);
      for (const s of sessions) practiceBySubject.set(s.id, link);
    }
    if (practiceBySubject.size === 0) return [];

    /*
     * `vault_outbox` IS NOT PRACTICE-SCOPED — it is the queue behind the chain
     * and carries no practiceId — so the filter is the explicit subject set
     * built above, and the practice name comes from the link that contributed
     * each subject. Nothing here reads a row the account did not already have a
     * link to.
     */
    const events = await this.prisma.vaultOutbox.findMany({
      where: { subjectId: { in: [...practiceBySubject.keys()] } },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: { type: true, actor: true, subjectId: true, occurredAt: true },
    });

    return events.map((event) => {
      const link = practiceBySubject.get(event.subjectId)!;
      return {
        at: event.occurredAt.toISOString(),
        actorType: actorTypeFor(event.actor),
        practiceId: link.practiceId,
        practiceName: link.practiceName,
        actionKey: event.type,
      };
    });
  }

  // -------------------------------------------------------------------------

  /** Which of the account's links owns this agreement — or a 404 that discloses nothing. */
  private async findLinkOwning(links: PortalLink[], agreementId: string, type?: string): Promise<PortalLink> {
    for (const link of links) {
      const agreement = await this.prisma.withPractice(link.practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId, patientId: link.patientId } }),
      );
      if (!agreement) continue;
      if (type && agreement.type !== type) {
        throw new BadRequestException('That agreement is not an enduring agreement.');
      }
      return link;
    }
    throw new NotFoundException('That agreement is not on your record.');
  }
}

/**
 * What a message was FOR, as a key for the string table (REQ-LANG-01).
 *
 * A key rather than the subject line, because the subject line is text somebody
 * composed and this list exists to be trusted at a glance. Unknown shapes get
 * `other` rather than leaking the internal subject type onto a patient's screen.
 */
function purposeKeyFor(subjectType: string, noticeId: string | null): string {
  if (noticeId) return 'notice_89aa';
  switch (subjectType) {
    case 'CaptureRequest':
      return 'capture_request';
    case 'Agreement':
      return 'agreement_copy';
    case 'Notice':
      return 'notice_89aa';
    /*
     * THE INVITATION TO THIS VERY PAGE. It shows in the list because a patient
     * checking "did that message come from my practice?" is most likely to be
     * checking THAT one — it is the first message we ever send them about
     * their record, and the one carrying a link.
     */
    case 'PortalActivationToken':
      return 'portal_invitation';
    default:
      return 'other';
  }
}

/** The three answers the patient's timeline may give. Anything unrecognised is `system`. */
function actorTypeFor(actor: Prisma.JsonValue): PortalAccessLogEntry['actorType'] {
  const principalType =
    actor && typeof actor === 'object' && !Array.isArray(actor)
      ? (actor as Record<string, unknown>).principalType
      : null;
  if (principalType === 'staff' || principalType === 'provider') return 'practice_staff';
  if (principalType === 'patient') return 'patient';
  return 'system';
}
