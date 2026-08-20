/**
 * Agreement status lifecycle (REQ-REC-02, design decisions §7) and the
 * change-rejection reducer that enforces HARD-01 (immutable anchor) and
 * HARD-02 (immutable signed content) at the domain layer. The same rules are
 * enforced again at the database layer (no UPDATE grant on anchor columns) —
 * defence in depth, per Addendum v3 §4.
 */
import type { Agreement, AgreementStatus } from './agreement';
import { HardRuleViolation } from './guards';

/** Allowed forward transitions. Anything not listed is rejected. */
export const STATUS_TRANSITIONS: Readonly<Record<AgreementStatus, readonly AgreementStatus[]>> = {
  draft: ['verification_pending', 'awaiting_signature', 'declined', 'expired', 'verbal_recorded'],
  verification_pending: ['verification_failed', 'awaiting_signature', 'expired'],
  verification_failed: ['verification_pending', 'expired', 'declined'],
  awaiting_signature: ['signed', 'declined', 'expired'],
  signed: ['validated'],
  validated: ['stored'],
  stored: ['active', 'claim_linked', 'registration_pending', 'legal_hold', 'retention_expiry_scheduled'],
  active: ['claim_linked', 'ceased', 'void', 'legal_hold', 'registration_pending'],
  claim_linked: ['retention_expiry_scheduled', 'legal_hold', 'ceased'],
  declined: [],
  expired: [],
  verbal_recorded: ['validated'],
  void: [],
  ceased: ['retention_expiry_scheduled', 'legal_hold'],
  legal_hold: ['retention_expiry_scheduled', 'active', 'claim_linked', 'ceased'],
  retention_expiry_scheduled: [],
  registration_pending: ['registered', 'registration_overdue', 'ceased'],
  registered: ['ceased', 'claim_linked'],
  registration_overdue: ['registered', 'ceased'],
};

export function canTransition(from: AgreementStatus, to: AgreementStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function transition(agreement: Agreement, to: AgreementStatus): Agreement {
  if (!canTransition(agreement.status, to)) {
    throw new HardRuleViolation('REQ-REC-02', `Illegal status transition ${agreement.status} → ${to}.`);
  }
  return { ...agreement, status: to };
}

/** Statuses at or beyond which the rendered content is immutable (HARD-02). */
const CONTENT_IMMUTABLE_FROM: readonly AgreementStatus[] = [
  'signed',
  'validated',
  'stored',
  'active',
  'claim_linked',
  'verbal_recorded',
  'registered',
  'registration_pending',
  'registration_overdue',
  'ceased',
  'legal_hold',
  'retention_expiry_scheduled',
];

export function isContentImmutable(status: AgreementStatus): boolean {
  return CONTENT_IMMUTABLE_FROM.includes(status);
}

/**
 * The only sanctioned way to apply a field change to an agreement. Rejects:
 *  - any change to the anchor (HARD-01 — no update path, no admin override);
 *  - any change to particulars or rendered artefact once signed (HARD-02 —
 *    corrections create a superseding agreement instead).
 */
export function applyChange(agreement: Agreement, change: Partial<Agreement>): Agreement {
  if ('anchor' in change || 'id' in change || 'type' in change || 'patientId' in change || 'practiceId' in change) {
    throw new HardRuleViolation(
      'HARD-01',
      'The agreement anchor and identity fields are immutable. Changing provider means terminating this ' +
        'agreement and creating a new one with fresh consent — there is no other code path.',
    );
  }
  if (
    isContentImmutable(agreement.status) &&
    ('particulars' in change || 'renderedArtefactHash' in change || 'renderedLanguages' in change)
  ) {
    throw new HardRuleViolation(
      'HARD-02',
      'A signed agreement is immutable. Create a superseding agreement (supersedesAgreementId) instead.',
    );
  }
  if ('status' in change) {
    throw new HardRuleViolation('REQ-REC-02', 'Use transition() for status changes, not applyChange().');
  }
  return { ...agreement, ...change };
}
