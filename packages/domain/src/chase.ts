/**
 * Managed follow-up — the deadline-driven stop rule (REQ-CHASE-05..09).
 *
 * A bulk-billed claim must be lodged within TWELVE MONTHS of the service
 * date; after that the item is unbillable, permanently. Chase intensity is
 * therefore banded by DAYS REMAINING on that window — never by elapsed days
 * since first contact. Band boundaries are configurable per practice, but
 * the DIRECTION is not: intensity rises and handback accelerates as the
 * deadline nears (REQ-CHASE-06), and nothing is ever chased past the
 * deadline (REQ-CHASE-08).
 */

export const LODGEMENT_WINDOW_DAYS = 365;

export type ChaseBand = 'standard' | 'compressed' | 'urgent' | 'last_chance' | 'expired';

export interface ChaseBandPolicy {
  readonly band: ChaseBand;
  /** Inclusive bounds in days remaining. */
  readonly minDaysRemaining: number;
  readonly maxDaysRemaining: number;
  readonly attempts: number;
  readonly attemptWindowHours: number | null;
  readonly escalation: readonly ('ai' | 'human')[];
  readonly handback: string;
}

/** REQ-CHASE-05, verbatim from the table. */
export const CHASE_BAND_POLICIES: readonly ChaseBandPolicy[] = [
  {
    band: 'standard',
    minDaysRemaining: 180,
    maxDaysRemaining: 365,
    attempts: 3,
    attemptWindowHours: 7 * 24,
    escalation: ['ai', 'ai', 'human'],
    handback: 'after attempt 3',
  },
  {
    band: 'compressed',
    minDaysRemaining: 90,
    maxDaysRemaining: 179,
    attempts: 3,
    attemptWindowHours: 3 * 24,
    escalation: ['ai', 'human', 'human'],
    handback: 'after attempt 3',
  },
  {
    band: 'urgent',
    minDaysRemaining: 30,
    maxDaysRemaining: 89,
    attempts: 3,
    attemptWindowHours: 48,
    escalation: ['human', 'ai', 'human'], // human FIRST — skip AI attempt 2
    handback: 'immediate on attempt 3',
  },
  {
    band: 'last_chance',
    minDaysRemaining: 7,
    maxDaysRemaining: 29,
    attempts: 1,
    attemptWindowHours: 24,
    escalation: ['human'],
    handback: 'immediate, to the practice principal',
  },
  {
    band: 'expired',
    minDaysRemaining: Number.NEGATIVE_INFINITY,
    maxDaysRemaining: 6,
    attempts: 0, // REQ-CHASE-08: never chase past the deadline
    attemptWindowHours: null,
    escalation: [],
    handback: 'close the item; record as revenue forgone with a reason code',
  },
];

export function daysRemainingInLodgementWindow(serviceDate: string | Date, now: Date = new Date()): number {
  const service = typeof serviceDate === 'string' ? new Date(serviceDate) : serviceDate;
  const elapsedDays = Math.floor((now.getTime() - service.getTime()) / 86_400_000);
  return LODGEMENT_WINDOW_DAYS - elapsedDays;
}

export function chaseBandFor(daysRemaining: number): ChaseBandPolicy {
  const policy = CHASE_BAND_POLICIES.find(
    (p) => daysRemaining >= p.minDaysRemaining && daysRemaining <= p.maxDaysRemaining,
  );
  // > 365 days remaining (future-dated service) sits in standard.
  return policy ?? CHASE_BAND_POLICIES[0];
}

/**
 * REQ-CHASE-09/-10 — the economics guard. No item is chased beyond the point
 * where the cumulative cost of contact is disproportionate to the benefit at
 * stake; raising the cap requires the practice's explicit recorded
 * instruction.
 */
export const DEFAULT_ATTEMPT_CAP = 3;

/**
 * What the ladder says comes next, given what has already been tried.
 *
 * Read off the band's escalation sequence by position: the attempts made so
 * far index into it. Past the end of the sequence — or on the expired band,
 * which has none — the answer is the band's handback. `null` means nothing:
 * the item is not chased at all (REQ-CHASE-08).
 */
export type ChaseNextStep = 'ai' | 'human' | 'handback' | null;

export function chaseNextStep(policy: ChaseBandPolicy, attemptsMade: number): ChaseNextStep {
  if (policy.band === 'expired') return null;
  if (attemptsMade < 0) return policy.escalation[0] ?? 'handback';
  return policy.escalation[attemptsMade] ?? 'handback';
}

export function attemptAllowed(input: {
  readonly attemptsMade: number;
  readonly daysRemaining: number;
  /** Only RAISES the cap, and only on the practice's explicit recorded instruction (REQ-CHASE-10). */
  readonly practiceRaisedCapTo?: number;
}): boolean {
  const band = chaseBandFor(input.daysRemaining);
  if (band.band === 'expired') return false; // REQ-CHASE-08, absolute — no cap raise applies
  const cap = Math.max(band.attempts, input.practiceRaisedCapTo ?? 0);
  return input.attemptsMade < cap;
}
