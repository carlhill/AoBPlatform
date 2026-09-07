/**
 * Convert-or-forgo — FR-7.3, the queue wireframe's R-3.
 *
 * A service was billed, the patient was seen, and no agreement was ever
 * captured. At some point a person has to decide what happens to the money:
 * bill the patient privately, write the benefit off, or keep trying. The
 * design's words: "Choose explicitly. Nothing happens by default, and either
 * choice is recorded." And: "Care is never blocked by this screen. The
 * patient has already been seen."
 *
 * So these rules are about the RECORD, not about stopping anybody: which
 * choices exist, which of them the deadline still permits, and what a
 * decision must carry to count as one.
 */
import { attemptAllowed } from './chase';

export const RECONCILIATION_DECISIONS = ['convert_to_private', 'forgo_benefit', 'keep_chasing'] as const;
export type ReconciliationDecision = (typeof RECONCILIATION_DECISIONS)[number];

/** The two that close the item. `keep_chasing` records intent and leaves it open. */
export const CLOSING_DECISIONS: readonly ReconciliationDecision[] = ['convert_to_private', 'forgo_benefit'];

export function isReconciliationDecision(value: string): value is ReconciliationDecision {
  return (RECONCILIATION_DECISIONS as readonly string[]).includes(value);
}

export class ReconciliationDecisionError extends Error {}

/**
 * May this decision be recorded now?
 *
 * Converting and forgoing are always allowed — they are the practice's call
 * about its own revenue, and the deadline only makes them more pressing.
 * KEEP CHASING is allowed only while the band still permits an attempt
 * (REQ-CHASE-08, -09): choosing to chase a service that can no longer be
 * billed, or past the economics cap, would be a decision to spend money for
 * no possible return, and the record must not contain one.
 *
 * A decision needs a DECIDER. "Recorded with the deciding person's identity"
 * is the design's footer, and an unattributed decision about revenue is the
 * one kind of record that cannot be questioned later.
 */
export function assertDecisionAllowed(input: {
  readonly decision: ReconciliationDecision;
  readonly decidedBy: string | null | undefined;
  readonly daysRemaining: number;
  readonly attemptsMade: number;
  readonly alreadyClosed: boolean;
}): void {
  if (!input.decidedBy?.trim()) {
    throw new ReconciliationDecisionError(
      'A decision about a service’s benefit records who made it, so it needs a signed-in person.',
    );
  }
  if (input.alreadyClosed) {
    throw new ReconciliationDecisionError(
      'This service has already been converted or forgone. A decision is not undone here; it is superseded, and superseding needs a reason on the record.',
    );
  }
  if (input.decision === 'keep_chasing') {
    if (!attemptAllowed({ attemptsMade: input.attemptsMade, daysRemaining: input.daysRemaining })) {
      throw new ReconciliationDecisionError(
        input.daysRemaining < 7
          ? 'The lodgement window has closed — this service cannot be billed, so there is nothing to chase for. Convert it or forgo it.'
          : 'This band’s attempts are used up. Convert it, forgo it, or hand it back.',
      );
    }
  }
}

/** What the queue does with the item after the decision. */
export function closesItem(decision: ReconciliationDecision): boolean {
  return CLOSING_DECISIONS.includes(decision);
}
