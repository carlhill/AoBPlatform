/**
 * The practitioner-to-location affiliation.
 *
 * THE STRUCTURAL FACT THIS EXISTS FOR: a Medicare provider number is not a
 * property of a doctor. FR-1.8 — "provider number PER LOCATION (a practitioner
 * has one per place of practice)". REQ-REG-02 identifies a provider by name
 * plus the address of the place of practice, OR by the provider number FOR
 * THAT PLACE OF PRACTICE.
 *
 * So the provider number lives on the edge between a practitioner and a
 * location, and that edge is this. An agreement anchors to the affiliation,
 * which makes REQ-XFER-01 (the practitioner is immutable, there is no transfer
 * path) fall out for free: a practitioner who moves gets a NEW affiliation,
 * therefore a NEW agreement. Not an edit.
 */

export class AffiliationError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'AffiliationError';
  }
}

/**
 * `invited` — the practice has added them; the practitioner has not answered.
 * `active` — accepted. Capture proceeds.
 * `ending`  — notice given, end date set. STILL ACTIVE until that date.
 * `ended`   — the practitioner has left. Agreements at this location cease.
 * `rejected`— the practitioner declined the invitation.
 */
export const AFFILIATION_STATUSES = ['invited', 'active', 'ending', 'ended', 'rejected'] as const;
export type AffiliationStatus = (typeof AFFILIATION_STATUSES)[number];

export interface Affiliation {
  readonly status: AffiliationStatus;
  /** Optional by design — s 65C(5)(a) name+address OR (b) provider number. */
  readonly providerNumber?: string | null;
  readonly startedAt?: Date | null;
  readonly noticeGivenAt?: Date | null;
  readonly endsAt?: Date | null;
  /** Set the moment AHPRA registration lapses — bypasses every notice period. */
  readonly deregisteredAt?: Date | null;
}

const TRANSITIONS: Record<AffiliationStatus, readonly AffiliationStatus[]> = {
  invited: ['active', 'rejected'],
  active: ['ending', 'ended'],
  ending: ['ended', 'active'], // notice can be withdrawn while it is still running
  ended: [],
  rejected: [],
};

export function canAffiliationTransition(from: AffiliationStatus, to: AffiliationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertAffiliationTransition(from: AffiliationStatus, to: AffiliationStatus): void {
  if (!canAffiliationTransition(from, to)) {
    throw new AffiliationError('FR-1.8', `An affiliation cannot go from ${from} to ${to}.`);
  }
}

/**
 * Can consent be captured under this affiliation right now?
 *
 * `ending` is deliberately TRUE. Notice runs BEFORE the end date: during the
 * notice period the practitioner is still working and still bulk billing, and
 * blocking capture then would break a practice that has done nothing wrong.
 */
export function canCaptureUnder(affiliation: Affiliation, now: Date = new Date()): boolean {
  if (affiliation.deregisteredAt && affiliation.deregisteredAt <= now) return false;
  if (affiliation.status === 'active') return true;
  if (affiliation.status === 'ending') {
    return !affiliation.endsAt || affiliation.endsAt > now;
  }
  return false;
}

/** The same question, with the reason — for surfacing in a console. */
export function captureBlockReason(affiliation: Affiliation, now: Date = new Date()): string | null {
  if (affiliation.deregisteredAt && affiliation.deregisteredAt <= now) {
    return (
      'REQ-XFER-08: this practitioner is no longer registered with AHPRA. Access stops immediately — ' +
      'there is no notice period for deregistration.'
    );
  }
  if (canCaptureUnder(affiliation, now)) return null;
  switch (affiliation.status) {
    case 'invited':
      return 'The practitioner has not yet accepted this affiliation. Nothing can be captured in their name until they do.';
    case 'rejected':
      return 'The practitioner declined this affiliation.';
    case 'ending':
    case 'ended':
      return (
        'This affiliation has ended. Enduring agreements at this location ceased under reg 65CA(8) — ' +
        'they are not blocked, they have CEASED, and the evidence is retained in full.'
      );
    default:
      return 'This affiliation is not active.';
  }
}

// ---------------------------------------------------------------------------
// Offboarding — notice BEFORE the end date
// ---------------------------------------------------------------------------

export interface NoticeOfDeparture {
  readonly noticeGivenAt: Date;
  readonly endsAt: Date;
}

/**
 * Notice must PRECEDE the end date.
 *
 * Under 65CA(8) an enduring agreement ceases when the practitioner leaves the
 * nominated practice location — on that event, not some days after it. A
 * "cool-off" AFTER departure would keep processing agreements that had already
 * ceased, producing claims against consent that no longer exists: exactly the
 * silent-invalidation failure mode the design docs warn about.
 *
 * A ten-day notice period is a perfectly sensible COMMERCIAL term. It belongs
 * in the practice's service agreement with the practitioner, and the platform
 * records the agreed end date. What the platform must not do is keep
 * processing after the practitioner has actually gone.
 */
export function assertNoticeValid(notice: NoticeOfDeparture): void {
  if (notice.endsAt < notice.noticeGivenAt) {
    throw new AffiliationError(
      'REQ-OFF-01',
      'Notice must be given BEFORE the affiliation ends. An end date in the past means the practitioner has ' +
        'already left, and agreements at that location have already ceased under reg 65CA(8) — ' +
        'backdating the notice does not un-cease them.',
    );
  }
}

export function noticeDays(notice: NoticeOfDeparture): number {
  return Math.round((notice.endsAt.getTime() - notice.noticeGivenAt.getTime()) / 86_400_000);
}

/** What actually happens when the end date arrives. Named, so it is testable. */
export interface EndOfAffiliationEffects {
  readonly enduringAgreementsCease: boolean;
  readonly cessationReason: string;
  readonly newCaptureBlocked: boolean;
  /** Claims for services rendered BEFORE the end date remain valid. */
  readonly priorClaimsRemainValid: boolean;
  /** Evidence is retained for the full statutory period regardless. */
  readonly evidenceRetained: boolean;
}

export function endOfAffiliationEffects(): EndOfAffiliationEffects {
  return {
    enduringAgreementsCease: true,
    cessationReason: 'practitioner_left_location',
    newCaptureBlocked: true,
    priorClaimsRemainValid: true,
    evidenceRetained: true,
  };
}

/**
 * REQ-XFER-08 — deregistration is an immediate hard stop. No notice period, no
 * end date, no waiting for the practice to tell us. Returns the effective
 * moment access ends, which is the moment we learn.
 */
export function deregistrationTakesEffect(learnedAt: Date): Date {
  return learnedAt;
}

// ---------------------------------------------------------------------------
// Multiple affiliations
// ---------------------------------------------------------------------------

/**
 * There is NO CAP on how many practices a practitioner may be affiliated with.
 *
 * Working across several practices is the ordinary state of Australian
 * medicine, not an anomaly. An arbitrary limit generates support tickets from
 * legitimate locums and stops nothing — an attacker simply stops one short of
 * it. The signal worth acting on is the RATE of change, not the total.
 */
export interface AffiliationVelocity {
  readonly activeCount: number;
  readonly addedInLastDays: number;
  readonly windowDays: number;
}

/** ⚠ DRAFT PARAMETER — the threshold wants a look at real data before GA. */
export const AFFILIATION_VELOCITY_THRESHOLD = 5;
export const AFFILIATION_VELOCITY_WINDOW_DAYS = 7;

/**
 * REQ-ANOM-01 — surface, never block. A practitioner going from two
 * affiliations to thirty in a week is worth a human looking at it; it is not
 * grounds for the platform to refuse them mid-clinic.
 */
export function isAffiliationVelocityAnomalous(
  velocity: AffiliationVelocity,
  threshold: number = AFFILIATION_VELOCITY_THRESHOLD,
): boolean {
  return velocity.addedInLastDays >= threshold;
}
