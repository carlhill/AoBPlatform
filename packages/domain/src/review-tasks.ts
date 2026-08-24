/**
 * Work that needs a second look.
 *
 * WHY A SEPARATE QUEUE FROM `outbound_items`. That one carries things LEAVING
 * the platform. This carries work arriving INTO it. Putting them in one table
 * would mean the word "queue" meaning two things in one schema, and the first
 * person to write `WHERE state = 'pending'` would get both.
 *
 * WHY IT EXISTS AT ALL. A practice can now change its own contact details,
 * head office and shared address. Those are amendable precisely because they
 * are not identity evidence — but "not identity evidence" is not the same as
 * "nobody should look". An administrator's email changing the week before a
 * payment run is not suspicious on its own and is worth somebody seeing.
 *
 * THE AI QUESTION, which is the reason this file is careful.
 *
 * Carl's intent is to automate most of this checking. That is right for the
 * volume, and it needs one rule stated before any of it is built:
 *
 *   AN AUTOMATED CHECK MAY CLOSE A LOW-STAKES TASK. IT MAY ONLY ADVISE ON A
 *   HIGH-STAKES ONE.
 *
 * Not because the model is untrustworthy, but because of what the record has
 * to be able to say afterwards. "A person looked at this and accepted it" and
 * "a model scored it 0.94 and nobody looked" are different claims, and a
 * system that cannot tell them apart later has destroyed the distinction for
 * every task it ever closed. The stakes are declared per kind, in code, so the
 * answer is visible rather than configured.
 */

/** How much rides on getting this one wrong. */
export type Stakes = 'low' | 'high';

export interface ReviewTaskKind {
  key: string;
  label: string;
  /** What a reviewer is actually being asked to decide. */
  question: string;
  stakes: Stakes;
  /**
   * Whether an automated check may RESOLVE this, or only annotate it.
   *
   * Derived from stakes rather than set independently, so nobody can quietly
   * mark a high-stakes kind auto-resolvable without changing what "high" means.
   */
  readonly autoResolvable: boolean;
}

function kind(k: Omit<ReviewTaskKind, 'autoResolvable'>): ReviewTaskKind {
  return { ...k, autoResolvable: k.stakes === 'low' };
}

export const REVIEW_TASK_KINDS: readonly ReviewTaskKind[] = [
  kind({
    key: 'practice_amended',
    label: 'A practice changed its own details',
    question: 'Is this change ordinary, or does it look like somebody taking over the account?',
    /*
     * LOW, and the reasoning matters. These are the sixteen AMENDABLE_FIELDS —
     * contacts, head office, the practice name. None of them is identity
     * evidence; the ABN, legal name and entity type cannot be touched here.
     * A model comparing before and after can reasonably close "corrected a
     * typo in a phone number".
     */
    stakes: 'low',
  }),
  kind({
    key: 'admin_contact_changed',
    label: 'The administrator’s email or phone changed',
    question: 'Did the practice ask for this, or is somebody redirecting where our messages go?',
    /*
     * HIGH, and separated from the general amendment for exactly this reason.
     * The administrator's address is where enrolment links and password-shaped
     * things go. Changing it is the single most useful move for somebody
     * taking over a practice account, and it arrives looking like admin.
     */
    stakes: 'high',
  }),
  kind({
    key: 'address_changed_after_confirmation',
    label: 'A confirmed address was changed',
    question: 'Does the confirmation still hold, or does this need checking again?',
    stakes: 'high',
  }),
  kind({
    key: 'acting_as_occurred',
    label: 'Somebody acted as this practice',
    question: 'Was what they did appropriate, and does the practice agree it happened?',
    /*
     * HIGH by construction: CRITICAL-ISSUES §5 rule 7 says the re-approval
     * must be by a DIFFERENT PERSON from the one who acted. A model cannot be
     * that person, and letting one close this would empty the rule.
     */
    stakes: 'high',
  }),
  kind({
    key: 'admin_invite_failed',
    label: 'A practice was approved but nobody was invited',
    question: 'Why did the invitation fail, and can it be sent now?',
    /*
     * HIGH, which is not obvious for what looks like a delivery failure.
     *
     * The practice is APPROVED. It is entitled to capture consent and cannot,
     * because not one person can sign in. Every day it sits here is a day the
     * practice is either doing without consent records or has gone somewhere
     * else — and neither is visible from inside our console, because from in
     * here it looks like a practice that simply has not got started.
     *
     * It is also the shape a genuine problem hides in: "an account already
     * exists with this email" means somebody else already holds the address
     * this practice gave us, which is worth a person looking rather than a
     * retry.
     */
    stakes: 'high',
  }),
  kind({
    key: 'email_change_churn',
    label: 'A personal address was changed too many times',
    question: 'Is this the practitioner genuinely struggling with their address, or is somebody probing?',
    /*
     * HIGH. Until this kind existed, three rapid attempts to move a
     * practitioner's own address were refused at the API and then FORGOTTEN --
     * visible to nobody but whoever tried, which is exactly the audience a
     * genuine attacker is content to be alone with. The domain's own comment
     * on the churn rule says it plainly: "a pattern worth stopping for,
     * whatever each one claimed." Stopping it at the API and not recording it
     * left the stopping without a witness.
     */
    stakes: 'high',
  }),
  kind({
    key: 'recertification_due',
    label: 'A practice is due to recertify',
    question: 'Has the practice confirmed its details are still correct?',
    stakes: 'low',
  }),
] as const;

export const REVIEW_TASK_KEYS = REVIEW_TASK_KINDS.map((k) => k.key);

export function reviewTaskKind(key: string): ReviewTaskKind | undefined {
  return REVIEW_TASK_KINDS.find((k) => k.key === key);
}

export const REVIEW_TASK_STATES = ['open', 'claimed', 'resolved', 'dismissed'] as const;
export type ReviewTaskState = (typeof REVIEW_TASK_STATES)[number];

/** How a task ended. `escalated` is not a resolution — it is a handoff. */
export const REVIEW_RESOLUTIONS = ['no_change_needed', 'corrected', 'escalated', 'not_a_problem'] as const;
export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];

/**
 * How long a claim holds before anybody else may take it.
 *
 * Longer than the outbound lease, because the thing holding it might be a
 * person reading a diff rather than a process opening a socket. Short enough
 * that a browser closed mid-review does not park the task for a day.
 */
export const REVIEW_CLAIM_MINUTES = 20;

export class ReviewTaskError extends Error {}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Is this task available to be picked up? Same lease-expiry logic as the
 * outbound queue — named differently because both are exported from the domain
 * and one `isClaimable` would silently resolve to whichever was imported last.
 */
export function isTaskClaimable(
  task: { state: string; claimExpiresAt?: Date | string | null },
  now: Date,
): boolean {
  if (task.state === 'resolved' || task.state === 'dismissed') return false;
  if (task.state === 'open') return true;
  const expires = asDate(task.claimExpiresAt);
  // A claim with no expiry is a bug, not a permanent hold.
  return !expires || expires <= now;
}

/**
 * May an automated check close this task by itself?
 *
 * THE RULE THIS FILE EXISTS FOR. Three conditions, all required:
 *
 *   1. The KIND is low-stakes.
 *   2. The check is confident.
 *   3. The check found nothing wrong.
 *
 * A confident automated check that DID find something is exactly the case that
 * must reach a person — the model has done its job by flagging it, and closing
 * on its own findings would mean the interesting tasks are the ones nobody
 * sees.
 */
export const AUTO_RESOLVE_CONFIDENCE = 0.9;

export function mayAutoResolve(input: {
  kindKey: string;
  confidence: number;
  foundConcern: boolean;
}): boolean {
  const k = reviewTaskKind(input.kindKey);
  if (!k?.autoResolvable) return false;
  if (input.foundConcern) return false;
  return input.confidence >= AUTO_RESOLVE_CONFIDENCE;
}

/**
 * What the record must say about how a task was closed.
 *
 * Never merely "resolved". A reader in two years has to be able to tell a
 * human decision from an automated one WITHOUT knowing which kinds were
 * automatable at the time — because that list will have changed.
 */
export function resolutionAttribution(input: {
  automated: boolean;
  by: string;
  confidence?: number;
}): string {
  if (!input.automated) return `Reviewed by ${input.by}.`;
  const confidence = typeof input.confidence === 'number' ? ` (confidence ${input.confidence.toFixed(2)})` : '';
  return `Closed automatically by ${input.by}${confidence}. No person reviewed this.`;
}

/**
 * Which fields, if changed, raise the HIGH-stakes contact task rather than the
 * ordinary one.
 *
 * Kept as data rather than an if-statement because it is a security boundary,
 * and a boundary should be readable in one place.
 */
export const SENSITIVE_CONTACT_FIELDS = ['adminEmail', 'adminPhone', 'groupEmail'] as const;

export function kindForAmendment(changedFields: readonly string[]): string {
  const sensitive = changedFields.some((f) => (SENSITIVE_CONTACT_FIELDS as readonly string[]).includes(f));
  return sensitive ? 'admin_contact_changed' : 'practice_amended';
}
