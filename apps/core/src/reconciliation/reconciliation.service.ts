import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assertDecisionAllowed,
  attemptAllowed,
  chaseBandFor,
  chaseNextStep,
  closesItem,
  daysRemainingInLodgementWindow,
  isReconciliationDecision,
  ReconciliationDecisionError,
  VERBAL_FALLBACK_END_DATE,
  type ChaseBand,
  type ReconciliationDecision,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CaptureService } from '../capture/capture.service';
import { CaptureLinkDispatcher } from '../auto-capture/capture-link.dispatcher';
import { anchorForAgreement, anchorsForAgreements } from '../affiliations/agreement-anchor';
import {
  associationChoices,
  calendarDayOf,
  preAgreementCandidates,
  recordPreAgreementAssociation,
} from '../agreements/pre-agreement-association';

export interface OutstandingItem {
  serviceRecordId: string;
  serviceDate: string;
  mbsItemNumbers: string[];
  daysRemaining: number;
  band: ChaseBand;
  agreementId: string | null;
  agreementStatus: string | null;
  patientId: string | null;
  /** "P. Nguyen" — initial and family name, as the queue wireframe shows it. Never the full given names in a list. */
  patientName: string | null;
  providerName: string | null;
  /** Which channels could carry a link. The screen picks email first; neither means nobody can be sent anything. */
  patientHasEmail: boolean;
  patientHasMobile: boolean;
  needsAgreement: boolean;
  /**
   * Why the cascade left this to a person (AutoCaptureSuppressionReason), if it
   * did. The word beside the item — "under 14", "no way to reach", "window
   * closed" — so the queue says what is left to do rather than only that
   * something is.
   */
  captureSuppressedReason: string | null;
  captureSuppressedAt: string | null;
  /** REQ-CHASE-03: confidentiality-flagged patients are excluded from ALL outbound chase. */
  outboundChaseSuppressed: boolean;
  /** Band expired — unbillable, permanently. Close and record, never contact (REQ-CHASE-08). */
  revenueForgone: boolean;
}

/**
 * WHY A SERVICE IS LISTED FOR A PERSON TO CHOOSE (D-2026-10-10-09). One code
 * today; the console maps it to words and shows any code it has no words for.
 */
export const ASSOCIATION_CHOICE_REASONS = ['unsigned_drafts_match_service'] as const;
export type AssociationChoiceReason = (typeof ASSOCIATION_CHOICE_REASONS)[number];

/**
 * A SERVICE WITH UNSIGNED PRE-AGREEMENTS THAT MATCH IT AND NONE ASSOCIATED
 * (D-2026-10-10-09, option (b)). Every candidate is named, so a person can
 * choose. Nothing was associated automatically: more than one matched when
 * the service arrived, or the draft appeared after the service did.
 */
export interface AssociationChoiceItem {
  serviceRecordId: string;
  serviceDate: string;
  patientId: string | null;
  patientName: string | null;
  providerName: string | null;
  reason: AssociationChoiceReason;
  candidates: {
    agreementId: string;
    type: string;
    status: string;
    /** The day the draft was for, practice-local (`visitDayOf`). */
    forDay: string;
    createdAt: string;
    providerName: string | null;
  }[];
}

function shortName(patient: { givenNames: string; familyName: string } | undefined): string | null {
  if (!patient) return null;
  const initial = patient.givenNames.trim().charAt(0);
  return initial ? `${initial}. ${patient.familyName}` : patient.familyName;
}

/**
 * M7 — the core operational screen (REQ-REC-01): every service without a
 * stored agreement, ranked by days remaining on the twelve-month lodgement
 * window, banded per REQ-CHASE-05.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capture: CaptureService,
    private readonly links: CaptureLinkDispatcher,
  ) {}

  async outstanding(practiceId: string): Promise<OutstandingItem[]> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const records = await tx.serviceRecord.findMany({});
      const agreementIds = records.map((r) => r.agreementId).filter((id): id is string => id !== null);
      const agreements = agreementIds.length
        ? await tx.agreement.findMany({ where: { id: { in: agreementIds } } })
        : [];
      const agreementById = new Map(agreements.map((a) => [a.id, a]));
      const patientIds = [...new Set(records.map((r) => r.patientId).filter((id): id is string => id !== null))];
      const patients = patientIds.length ? await tx.patient.findMany({ where: { id: { in: patientIds } } }) : [];
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const providerIds = [...new Set(records.map((r) => r.providerId).filter((id): id is string => id !== null))];
      const providers = providerIds.length ? await tx.provider.findMany({ where: { id: { in: providerIds } } }) : [];
      const providerById = new Map(providers.map((p) => [p.id, p]));

      /*
       * FR-7.3: a service somebody has converted to private billing or
       * forgone is DECIDED, and leaves the queue. The decision row is the
       * record; the queue simply no longer asks anybody about it.
       */
      const decisions = await tx.reconciliationDecision.findMany({ orderBy: { decidedAt: 'desc' } });
      const latestDecision = new Map<string, (typeof decisions)[number]>();
      for (const d of decisions) if (!latestDecision.has(d.serviceRecordId)) latestDecision.set(d.serviceRecordId, d);

      const items: OutstandingItem[] = [];
      for (const record of records) {
        const agreement = record.agreementId ? agreementById.get(record.agreementId) : undefined;
        if (agreement && agreement.status === 'stored') continue; // covered — not outstanding
        const decided = latestDecision.get(record.id);
        if (decided && closesItem(decided.decision as ReconciliationDecision)) continue; // converted or forgone — decided
        const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
        const band = chaseBandFor(daysRemaining).band;
        const patient = record.patientId ? patientById.get(record.patientId) : undefined;
        const provider = record.providerId ? providerById.get(record.providerId) : undefined;
        items.push({
          serviceRecordId: record.id,
          serviceDate: record.serviceDate.toISOString().slice(0, 10),
          mbsItemNumbers: record.mbsItemNumbers,
          daysRemaining,
          band,
          agreementId: agreement?.id ?? null,
          agreementStatus: agreement?.status ?? null,
          patientId: record.patientId,
          patientName: shortName(patient),
          providerName: provider?.name ?? null,
          patientHasEmail: Boolean(patient?.email?.trim()),
          patientHasMobile: Boolean(patient?.mobile?.trim()),
          needsAgreement: !agreement,
          captureSuppressedReason: agreement ? null : record.captureSuppressedReason,
          captureSuppressedAt: agreement ? null : (record.captureSuppressedAt?.toISOString() ?? null),
          outboundChaseSuppressed: patient?.confidentialityFlag ?? false,
          revenueForgone: band === 'expired',
        });
      }
      // Most urgent first — a practice must never discover a lost item from
      // the report alone (REQ-CHASE-12).
      return items.sort((a, b) => a.daysRemaining - b.daysRemaining);
    });
  }

  /**
   * One-click resend (REQ-REC-01). Hard stops, in order: never past the
   * deadline (REQ-CHASE-08); never for a confidentiality-flagged patient
   * (REQ-CHASE-03); and an item with no agreement needs a staff decision
   * about the assignor, not an automatic send.
   */
  async resend(practiceId: string, serviceRecordId: string, channel: string) {
    const record = await this.prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findFirst({ where: { id: serviceRecordId } }),
    );
    if (!record) throw new NotFoundException('Service record not found.');

    const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
    if (chaseBandFor(daysRemaining).band === 'expired') {
      throw new BadRequestException(
        'REQ-CHASE-08: the twelve-month lodgement window has closed — this item is unbillable, permanently. ' +
          'Record it as revenue forgone; a further contact is cost with no possible return.',
      );
    }
    const patient = record.patientId
      ? await this.prisma.withPractice(practiceId, (tx) => tx.patient.findFirst({ where: { id: record.patientId! } }))
      : null;
    if (patient?.confidentialityFlag) {
      throw new BadRequestException(
        'REQ-CHASE-03: confidentiality-flagged patients are excluded from all outbound chase.',
      );
    }
    if (!record.agreementId) {
      throw new BadRequestException(
        'No agreement exists for this service yet — create one (choosing the assignor) before sending a capture link.',
      );
    }
    /*
     * THE CONTACT ON FILE, AND ONLY THAT ONE (D-2026-09-11-03; D-2026-10-11-07
     * decision 3). The message goes to the email or mobile the practice's
     * system already holds; nothing in this request can redirect it. A
     * channel with no contact behind it is REFUSED BEFORE ANY LINK IS OPENED,
     * by name: opening one would report a send that never happened, and leave
     * an open request that makes every retry hit FR-2.7's duplicate refusal —
     * the wrong cause, named confidently (wow.md §13).
     */
    const destination = channel === 'sms_link' ? patient?.mobile?.trim() : patient?.email?.trim();
    if (!patient || !destination) {
      throw new BadRequestException({
        message:
          channel === 'sms_link'
            ? 'This patient has no mobile number on their record, so no SMS was sent and no link was opened. ' +
              'Add the number in the practice system; it syncs through.'
            : 'This patient has no email address on their record, so no email was sent and no link was opened. ' +
              'Add the address in the practice system; it syncs through.',
        reason: 'no_contact_for_channel',
      });
    }
    const agreementId = record.agreementId;

    /*
     * OPEN AND SEND ARE ONE TRANSACTION (TELEHEALTH-PLAN §8 step 1, 12 Oct 2026).
     *
     * Until today this opened a capture request, returned its token to the
     * console, and sent nothing: the row said "sent" and nobody was sent
     * anything. The message is the one the post-service chase sends — the
     * same dispatcher, the same words, the same outbound queue (the sandbox
     * gateway and Mailhog in development) — and it is queued in the SAME
     * transaction that opens the link, so a queue that refuses rolls the link
     * back with it and a retry starts clean.
     *
     * THE TOKEN IS NOT RETURNED. It exists for the message, and a console
     * holding a working link to a patient's agreement could open it.
     */
    const opened = await this.prisma.withPractice(practiceId, async (tx) => {
      const request = await this.capture.openWithin(tx, practiceId, { agreementId, channel });
      if (!request.token) throw new Error('A remote capture request opened without a token.');
      const practice = await tx.practice.findFirst({ select: { name: true } });
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      const anchor = agreement ? await anchorForAgreement(tx, agreement) : null;
      await this.links.sendPostAgreementLink(tx, {
        practiceId,
        practiceName: practice?.name ?? '',
        patient,
        providerName: anchor?.name ?? 'your practitioner',
        serviceDate: record.serviceDate,
        mbsItemNumbers: record.mbsItemNumbers,
        captureRequestId: request.captureRequestId,
        channel: channel as 'sms_link' | 'email_link',
        token: request.token,
        expiresAt: request.expiresAt,
      });
      return request;
    });
    return { captureRequestId: opened.captureRequestId, channel: opened.channel, expiresAt: opened.expiresAt };
  }

  /**
   * SERVICES WAITING FOR A PERSON TO SAY WHICH UNSIGNED PRE-AGREEMENT WAS FOR
   * THEIR VISIT (D-2026-10-10-09, option (b)). Read only.
   *
   * SEPARATE FROM `outstanding`, deliberately. That list is "billed without a
   * stored agreement" and feeds the capture rate; a choice is a different
   * task and can be owed on a service that a signed agreement already covers.
   */
  async associationChoices(practiceId: string): Promise<AssociationChoiceItem[]> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const choices = await associationChoices(tx);
      if (choices.length === 0) return [];
      const patientIds = [...new Set(choices.map((c) => c.service.patientId).filter((id): id is string => id !== null))];
      const providerIds = [...new Set(choices.map((c) => c.service.providerId).filter((id): id is string => id !== null))];
      const [patients, providers, anchors] = await Promise.all([
        tx.patient.findMany({ where: { id: { in: patientIds } } }),
        providerIds.length ? tx.provider.findMany({ where: { id: { in: providerIds } } }) : Promise.resolve([]),
        anchorsForAgreements(tx, choices.flatMap((c) => c.candidates)),
      ]);
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const providerById = new Map(providers.map((p) => [p.id, p]));
      return choices.map(({ service, candidates }) => ({
        serviceRecordId: service.id,
        serviceDate: calendarDayOf(service.serviceDate),
        patientId: service.patientId,
        patientName: shortName(service.patientId ? patientById.get(service.patientId) : undefined),
        providerName:
          (service.providerId ? providerById.get(service.providerId)?.name : undefined)
          ?? anchors.get(candidates[0]!.id)?.name
          ?? null,
        reason: 'unsigned_drafts_match_service' as const,
        candidates: candidates.map((c) => ({
          agreementId: c.id,
          type: c.type,
          status: c.status,
          forDay: c.forDay,
          createdAt: c.createdAt.toISOString(),
          providerName: anchors.get(c.id)?.name ?? null,
        })),
      }));
    });
  }

  /**
   * A PERSON CHOSE WHICH UNSIGNED PRE-AGREEMENT WAS FOR THIS SERVICE'S VISIT
   * (D-2026-10-10-09). Associated, never linked: the service record's
   * `agreementId` is not touched. The chooser comes from the session, never
   * the body, and the association and its vault event commit together.
   *
   * REFUSALS SAY WHAT WAS CHECKED (wow.md section 13): an existing association
   * is named; an agreement that is not a current candidate is refused with the
   * conditions it was checked against, because which one it failed is not
   * something to guess at.
   */
  async associate(practiceId: string, serviceRecordId: string, agreementId: string, actor?: Actor) {
    if (!actor) {
      throw new ForbiddenException(
        'Choosing the draft for a service is recorded against a signed-in person; no session was found.',
      );
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: serviceRecordId } });
      if (!record) throw new NotFoundException('Service record not found.');
      const existing = await tx.preAgreementAssociation.findFirst({ where: { serviceRecordId } });
      if (existing) {
        throw new ConflictException(
          `Service record ${serviceRecordId} is already associated with agreement ${existing.agreementId} ` +
            `(${existing.how}). Nothing was changed.`,
        );
      }
      const candidates = await preAgreementCandidates(tx, record);
      if (!candidates.some((c) => c.id === agreementId)) {
        throw new BadRequestException(
          `Agreement ${agreementId} is not one of the unsigned drafts that match service record ${serviceRecordId}. ` +
            'Checked: an episodic pre-agreement for the same patient, servicing provider and practice-local day, ' +
            'unsigned and still open, not linked to a service, not replaced and not already associated. ' +
            `${candidates.length} draft(s) match it now. Nothing was recorded.`,
        );
      }
      const row = await recordPreAgreementAssociation(tx, practiceId, {
        agreementId,
        visit: record,
        how: 'chosen',
        candidateCount: candidates.length,
        chosenBy: { principalType: actor.principalType, id: actor.id },
      });
      return {
        serviceRecordId,
        agreementId,
        how: row.how,
        candidateCount: row.candidateCount,
        associatedAt: row.createdAt.toISOString(),
      };
    });
  }

  /** REQ-MON-01 subset — grows with the metric families as modules land. Exportable by shape (REQ-MON-02). */
  async metrics(practiceId: string) {
    const items = await this.outstanding(practiceId);
    const byBand: Record<ChaseBand, number> = { standard: 0, compressed: 0, urgent: 0, last_chance: 0, expired: 0 };
    for (const item of items) byBand[item.band] += 1;

    return this.prisma.withPractice(practiceId, async (tx) => {
      const storedCount = await tx.agreement.count({ where: { status: 'stored' } });
      const verbalCount = await tx.agreement.count({ where: { status: 'verbal_recorded' } });
      const serviceCount = await tx.serviceRecord.count({});
      const daysToVerbalEnd = Math.ceil(
        (new Date(VERBAL_FALLBACK_END_DATE).getTime() - Date.now()) / 86_400_000,
      );
      return {
        outstanding: items.length,
        byBand,
        revenueForgoneCount: byBand.expired,
        storedAgreements: storedCount,
        serviceRecords: serviceCount,
        captureRate: serviceCount === 0 ? null : Number(((serviceCount - items.length) / serviceCount).toFixed(3)),
        verbalUsage: { count: verbalCount, daysUntilVerbalFallbackEnds: daysToVerbalEnd },
      };
    });
  }

  /**
   * One item, in full — the queue wireframe's R-2: what has been tried, what
   * the band allows, and what comes next.
   *
   * ATTEMPTS ARE WHAT THE RECORDS SAY, not a counter. Every capture request
   * opened for the agreement is an attempt, and every correspondence row
   * about it says whether the message left, arrived or failed. The ladder
   * (REQ-CHASE-05) is read off the band's policy against that count, so the
   * "next step" shown is derived from evidence rather than asserted.
   */
  async detail(practiceId: string, serviceRecordId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: serviceRecordId } });
      if (!record) throw new NotFoundException('Service record not found.');
      const patient = record.patientId ? await tx.patient.findFirst({ where: { id: record.patientId } }) : null;
      const provider = record.providerId ? await tx.provider.findFirst({ where: { id: record.providerId } }) : null;
      const agreement = record.agreementId ? await tx.agreement.findFirst({ where: { id: record.agreementId } }) : null;

      const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
      const policy = chaseBandFor(daysRemaining);

      const requests = agreement
        ? await tx.captureRequest.findMany({ where: { agreementId: agreement.id }, orderBy: { createdAt: 'asc' } })
        : [];
      /*
       * WHY A LINK WAS CLOSED, where the record says (12 Oct 2026). A DB4 link
       * whose challenge locked is cancelled by `verifyLink`; the challenge's
       * `lockedAt` is the observation, so the queue can name it rather than
       * show a bare "cancelled". Every other cancellation stays unnamed here.
       */
      const challengeIds = requests.map((r) => r.verificationChallengeId).filter((id): id is string => id !== null);
      const lockedChallenges = new Set(
        challengeIds.length
          ? (
              await tx.verificationChallenge.findMany({
                where: { id: { in: challengeIds }, lockedAt: { not: null } },
                select: { id: true },
              })
            ).map((c) => c.id)
          : [],
      );
      const correspondence = requests.length
        ? await tx.correspondence.findMany({
            where: { subjectType: 'CaptureRequest', subjectId: { in: requests.map((r) => r.id) } },
            orderBy: { queuedAt: 'asc' },
          })
        : [];
      const byRequest = new Map<string, typeof correspondence>();
      for (const c of correspondence) byRequest.set(c.subjectId, [...(byRequest.get(c.subjectId) ?? []), c]);

      const attemptsMade = requests.length;
      const decisions = await tx.reconciliationDecision.findMany({
        where: { serviceRecordId: record.id },
        orderBy: { decidedAt: 'desc' },
      });
      const latest = decisions[0] ?? null;
      return {
        alreadyClosed: latest ? closesItem(latest.decision as ReconciliationDecision) : false,
        decisions: decisions.map((d) => ({
          id: d.id,
          decision: d.decision,
          reason: d.reason,
          decidedBy: d.decidedBy,
          decidedAt: d.decidedAt.toISOString(),
        })),
        serviceRecordId: record.id,
        serviceDate: record.serviceDate.toISOString().slice(0, 10),
        mbsItemNumbers: record.mbsItemNumbers,
        daysRemaining,
        band: policy.band,
        patient: patient
          ? { id: patient.id, name: `${patient.givenNames} ${patient.familyName}`, hasEmail: Boolean(patient.email), hasMobile: Boolean(patient.mobile), confidentialityFlag: patient.confidentialityFlag }
          : null,
        provider: provider ? { id: provider.id, name: provider.name } : null,
        agreement: agreement
          ? { id: agreement.id, type: agreement.type, status: agreement.status, particularsLocked: agreement.particularsLockedAt !== null, signed: agreement.signatureEventId !== null }
          : null,
        captureSuppressedReason: agreement ? null : record.captureSuppressedReason,
        captureSuppressedAt: agreement ? null : (record.captureSuppressedAt?.toISOString() ?? null),
        policy: {
          band: policy.band,
          attempts: policy.attempts,
          attemptWindowHours: policy.attemptWindowHours,
          escalation: policy.escalation,
          handback: policy.handback,
        },
        attemptsMade,
        attemptAllowed: attemptAllowed({ attemptsMade, daysRemaining }),
        nextStep: chaseNextStep(policy, attemptsMade),
        attempts: requests.map((r) => ({
          captureRequestId: r.id,
          channel: r.channel,
          status: r.status,
          cancelledReason:
            r.status === 'cancelled' && r.verificationChallengeId && lockedChallenges.has(r.verificationChallengeId)
              ? ('verification_locked_out' as const)
              : null,
          openedAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
          messages: (byRequest.get(r.id) ?? []).map((c) => ({
            id: c.id,
            channel: c.channel,
            to: c.to,
            state: c.state,
            subject: c.subject,
            queuedAt: c.queuedAt.toISOString(),
            sentAt: c.sentAt?.toISOString() ?? null,
            deliveredAt: c.deliveredAt?.toISOString() ?? null,
            failedAt: c.failedAt?.toISOString() ?? null,
            failureReason: c.failureReason,
          })),
        })),
      };
    });
  }

  /**
   * FR-7.3 — convert-or-forgo (design R-3). A person decides what happens to
   * a service that never got its agreement. The rules live in
   * `reconciliation-decision.ts`; this records the decision, with the
   * deciding person from their session — never from the request body — and
   * a vault event that carries everything the decision was made against.
   */
  async decide(
    practiceId: string,
    serviceRecordId: string,
    input: { decision: string; reason?: string },
    actor?: Actor,
  ) {
    if (!isReconciliationDecision(input.decision)) {
      throw new BadRequestException(`"${input.decision}" is not a decision. One of: convert_to_private, forgo_benefit, keep_chasing.`);
    }
    const decision = input.decision;

    return this.prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: serviceRecordId } });
      if (!record) throw new NotFoundException('Service record not found.');

      const prior = await tx.reconciliationDecision.findMany({
        where: { serviceRecordId },
        orderBy: { decidedAt: 'desc' },
      });
      const alreadyClosed = prior.length > 0 && closesItem(prior[0].decision as ReconciliationDecision);
      const attemptsMade = record.agreementId
        ? await tx.captureRequest.count({ where: { agreementId: record.agreementId } })
        : 0;
      const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);

      try {
        assertDecisionAllowed({ decision, decidedBy: actor?.name, daysRemaining, attemptsMade, alreadyClosed });
      } catch (err) {
        if (err instanceof ReconciliationDecisionError) throw new BadRequestException(err.message);
        throw err;
      }

      const reason = input.reason?.trim() || null;
      const row = await tx.reconciliationDecision.create({
        data: { practiceId, serviceRecordId, decision, reason, decidedBy: actor!.name },
      });
      await enqueueVaultEvent(tx, {
        type: 'reconciliation.decided',
        actor: { principalType: 'staff', id: actor!.id },
        subject: { type: 'ServiceRecord', id: serviceRecordId },
        payload: {
          decision,
          reason: reason ?? '',
          decidedBy: actor!.name,
          band: chaseBandFor(daysRemaining).band,
          daysRemaining,
          attemptsMade,
          closesItem: closesItem(decision),
          serviceDate: record.serviceDate.toISOString().slice(0, 10),
        },
      });

      return {
        id: row.id,
        decision,
        reason,
        decidedBy: row.decidedBy,
        decidedAt: row.decidedAt.toISOString(),
        closesItem: closesItem(decision),
      };
    });
  }
}
