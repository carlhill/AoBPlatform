/**
 * What a PERSON at the practice did about an unanswered agreement.
 *
 * The platform already records what IT did: a capture request per automated
 * attempt, a correspondence row per message, both banded by `chase.ts`. What
 * nothing records is the half of the chase that happens off the platform --
 * the receptionist who rang and got voicemail, the practice manager who
 * caught the patient at the desk, the letter that went out on Friday.
 *
 * Carl, 3 Sep 2026: "Where we have a Close (because we tried 3 times and so
 * on) - we need an audit trail to show that this was done. So we need an
 * audit-trail to show that a practice-user called the Patient, sent SMS /
 * email and so on. Note: The Practice will chase as they will not get paid
 * otherwise."
 *
 * That last sentence is the whole reason this record exists. The practice is
 * the party that loses the benefit, so the practice is the party that has to
 * be able to SHOW it tried -- and a queue item that closes as "revenue
 * forgone" with three unanswered capture links beside it evidences that the
 * platform tried, not that anybody did.
 *
 * WHAT THIS FILE DECIDES, and what it deliberately leaves to `chase.ts`:
 *
 *   1. THE VOCABULARY. How a person reached out, and what came of it. The two
 *      channels that overlap with the platform's own senders keep the
 *      platform's words -- `email` and `sms`, not "e-mail" or "text" -- so one
 *      screen can show a human attempt and a machine attempt in one column
 *      without translating between two vocabularies.
 *   2. WHAT MAY BE CHASED AT ALL. An 89AA notice is never chased, on any
 *      surface, by anybody (CLAUDE.md rule 7, REQ-END-05, REQ-CHASE-02). The
 *      notice tells a patient a service was billed; it asks for nothing, so
 *      there is nothing to chase, and a chase attempt recorded against one
 *      would be a record of a thing that must not have happened.
 *   3. WHAT A RECORD NEEDS TO COUNT AS ONE. A person, from a session; a
 *      channel; an outcome that channel can actually produce; and, for a
 *      correction, a reason.
 *
 * IT DOES NOT RESTATE THE LADDER. Whether another attempt is permitted at all
 * is `attemptAllowed()` in `chase.ts` -- the same function the automated
 * cascade asks -- because a human attempt and an AI attempt sit on ONE ladder
 * (REQ-CHASE-05's escalation column literally alternates between them). Two
 * copies of a band rule is how they come to disagree.
 *
 * NO IDENTIFIER VALUES LIVE HERE (REQ-VER-04, REQ-LOG-08). The record says
 * WHICH KIND of contact was used and WHO was contacted by role -- never the
 * number, never the address, never a card. There is no dollar amount either
 * (rule 4): what the item is worth is not part of the evidence that somebody
 * chased it.
 */
import { attemptAllowed, chaseBandFor } from './chase';

/**
 * How a person reached out.
 *
 * `email` and `sms` are the platform's own outbound words (OUTBOUND_CHANNELS
 * in `outbound-queue.ts`) reused deliberately: a staff member who sends a text
 * from the practice's own phone did the same THING the platform does, and
 * calling it something else here would make "how was this patient contacted"
 * two questions instead of one. `phone`, `in_person` and `post` have no
 * platform equivalent -- the platform cannot ring anybody, stand at a desk, or
 * post a letter -- so they are new, and they are the reason this record exists.
 */
export const CHASE_ATTEMPT_CHANNELS = ['phone', 'sms', 'email', 'in_person', 'post'] as const;
export type ChaseAttemptChannel = (typeof CHASE_ATTEMPT_CHANNELS)[number];

/**
 * What came of it.
 *
 * Carl's list, with one generalisation. "Wrong number" is `wrong_contact`
 * because the same outcome arrives at an email address that bounces and a
 * letter returned to sender, and an evidence table that can only say it about
 * a phone forces staff to record "no answer" for a detail that was simply
 * wrong -- which is a materially different fact when somebody later asks why
 * the patient was never reached.
 *
 * There is deliberately no `agreement_signed` outcome. Whether an agreement
 * exists is the agreement's own record; an attempt says what HAPPENED IN THE
 * CONTACT, and inferring consent from a staff member's note about a phone call
 * is exactly the shortcut this regime punishes.
 */
export const CHASE_ATTEMPT_OUTCOMES = [
  /** Spoke to them, or they replied. */
  'reached',
  /** Rang out, no reply, nobody at the desk. */
  'no_answer',
  /** Voicemail, or a message left with whoever answered. */
  'left_message',
  /** They answered and declined -- a real outcome, and the most important one to keep. */
  'refused',
  /** The number, address or letterbox was not theirs. */
  'wrong_contact',
] as const;
export type ChaseAttemptOutcome = (typeof CHASE_ATTEMPT_OUTCOMES)[number];

/**
 * Which outcomes a channel can honestly produce.
 *
 * Narrow, and only where the combination is not merely unusual but
 * meaningless: a letter cannot ring out or take a voicemail, and you cannot
 * have the wrong contact detail for somebody standing in front of you. Every
 * other pairing is allowed, because a validator that second-guesses staff
 * about their own working day is worked around with the nearest wrong answer
 * -- and a wrong answer in an audit trail is worse than a blunt one.
 */
export const CHASE_OUTCOMES_BY_CHANNEL: Readonly<Record<ChaseAttemptChannel, readonly ChaseAttemptOutcome[]>> = {
  phone: ['reached', 'no_answer', 'left_message', 'refused', 'wrong_contact'],
  sms: ['reached', 'no_answer', 'refused', 'wrong_contact'],
  email: ['reached', 'no_answer', 'refused', 'wrong_contact'],
  in_person: ['reached', 'no_answer', 'left_message', 'refused'],
  post: ['reached', 'no_answer', 'refused', 'wrong_contact'],
};

/**
 * WHAT a chase attempt can be recorded against.
 *
 * A service that is waiting for its agreement, or the agreement itself. The
 * list is closed, and `Notice` is not on it -- see `assertChaseSubjectChaseable`.
 */
export const CHASE_ATTEMPT_SUBJECT_TYPES = ['ServiceRecord', 'Agreement'] as const;
export type ChaseAttemptSubjectType = (typeof CHASE_ATTEMPT_SUBJECT_TYPES)[number];

/**
 * WHO was contacted, by ROLE and never by name (REQ-VER-04): the patient
 * themselves, the assignor acting for them, or somebody else who answered --
 * a parent, a carer, the desk at a residential facility.
 */
export const CONTACTED_PARTY_TYPES = ['patient', 'assignor', 'other'] as const;
export type ContactedPartyType = (typeof CONTACTED_PARTY_TYPES)[number];

/** A note is for what was said, not for who was called. The cap bounds the blast radius. */
export const CHASE_NOTE_MAX_LENGTH = 1000;

export class ChaseAttemptError extends Error {}

export function isChaseAttemptChannel(value: string): value is ChaseAttemptChannel {
  return (CHASE_ATTEMPT_CHANNELS as readonly string[]).includes(value);
}

export function isChaseAttemptOutcome(value: string): value is ChaseAttemptOutcome {
  return (CHASE_ATTEMPT_OUTCOMES as readonly string[]).includes(value);
}

export function isChaseAttemptSubjectType(value: string): value is ChaseAttemptSubjectType {
  return (CHASE_ATTEMPT_SUBJECT_TYPES as readonly string[]).includes(value);
}

export function isContactedPartyType(value: string): value is ContactedPartyType {
  return (CONTACTED_PARTY_TYPES as readonly string[]).includes(value);
}

/**
 * RULE 7, ENFORCED RATHER THAN DOCUMENTED.
 *
 * An 89AA notice is one-way: it never gates payment, it has no approval
 * semantics, and it is NEVER CHASED (REQ-END-05, REQ-CHASE-02). So there is no
 * subject type that names one, asking for one is refused here and at the DTO,
 * and a CHECK constraint on the table refuses it a third time. Three layers
 * because this is the rule that a well-meaning "let's just log everything we
 * sent them" change would break first.
 */
export function assertChaseSubjectChaseable(subjectType: string): asserts subjectType is ChaseAttemptSubjectType {
  if (subjectType === 'Notice') {
    throw new ChaseAttemptError(
      'A reg 89AA notice is never chased (REQ-CHASE-02, REQ-END-05). It tells a patient a service was billed ' +
        'under an enduring agreement; it asks for nothing, so there is nothing to follow up.',
    );
  }
  if (!isChaseAttemptSubjectType(subjectType)) {
    throw new ChaseAttemptError(
      `"${subjectType}" is not something a chase attempt is recorded against. ` +
        `One of: ${CHASE_ATTEMPT_SUBJECT_TYPES.join(', ')}.`,
    );
  }
}

export interface ChaseAttemptInput {
  readonly subjectType: string;
  readonly channel: string;
  readonly outcome: string;
  readonly contactedPartyType?: string | null;
  /** From the session. Never from the request body. */
  readonly attemptedBy: string | null | undefined;
  readonly note?: string | null;
  /** Set when this row corrects an earlier one. A correction says what was wrong. */
  readonly supersedes?: string | null;
  /** Attempts already on the ladder -- automated and human together, superseded rows excluded. */
  readonly attemptsMade: number;
  readonly daysRemaining: number;
  /** REQ-CHASE-10: only ever RAISES the cap, and only on the practice's recorded instruction. */
  readonly practiceRaisedCapTo?: number;
}

/**
 * May this attempt be recorded?
 *
 * NOTE WHAT THIS DOES NOT DO: it does not stop anybody ringing a patient, and
 * it could not -- a phone call happens in the world, not in this system
 * (REQ-REC-04: the platform never blocks care, and never blocks the practice's
 * own work either). It decides what the EVIDENCE TABLE will accept, and it
 * refuses the two records that would be evidence of a rule being broken: a
 * chase past the lodgement deadline (REQ-CHASE-08 -- the item cannot be
 * billed, so a contact is cost with no possible return) and a chase past the
 * band's attempt cap (REQ-CHASE-09). Both answers come from `chase.ts`,
 * unchanged, because the automated cascade asks the same function.
 *
 * A CORRECTION IS ALWAYS PERMITTED. It supersedes a row rather than adding
 * one, so the ladder count is unchanged -- and a table where the last attempt
 * can never be corrected is a table that holds a known-wrong row forever.
 */
export function assertChaseAttemptAllowed(input: ChaseAttemptInput): void {
  assertChaseSubjectChaseable(input.subjectType);

  if (!input.attemptedBy?.trim()) {
    throw new ChaseAttemptError(
      'A chase attempt records who made it, so it needs a signed-in person. An unattributed attempt proves nothing.',
    );
  }
  if (!isChaseAttemptChannel(input.channel)) {
    throw new ChaseAttemptError(
      `"${input.channel}" is not a way of contacting somebody. One of: ${CHASE_ATTEMPT_CHANNELS.join(', ')}.`,
    );
  }
  if (!isChaseAttemptOutcome(input.outcome)) {
    throw new ChaseAttemptError(
      `"${input.outcome}" is not an outcome. One of: ${CHASE_ATTEMPT_OUTCOMES.join(', ')}.`,
    );
  }
  if (!CHASE_OUTCOMES_BY_CHANNEL[input.channel].includes(input.outcome)) {
    throw new ChaseAttemptError(
      `A ${input.channel} attempt cannot end in "${input.outcome}". ` +
        `One of: ${CHASE_OUTCOMES_BY_CHANNEL[input.channel].join(', ')}.`,
    );
  }
  if (input.contactedPartyType != null && !isContactedPartyType(input.contactedPartyType)) {
    throw new ChaseAttemptError(
      `"${input.contactedPartyType}" is not who was contacted. One of: ${CONTACTED_PARTY_TYPES.join(', ')}.`,
    );
  }
  if (input.note != null && input.note.length > CHASE_NOTE_MAX_LENGTH) {
    throw new ChaseAttemptError(`A note is at most ${CHASE_NOTE_MAX_LENGTH} characters.`);
  }

  if (input.supersedes?.trim()) {
    if (!input.note?.trim()) {
      throw new ChaseAttemptError(
        'A correction replaces a record somebody may already have relied on, so it says what was wrong with it.',
      );
    }
    return; // replaces a rung; adds none.
  }

  if (
    !attemptAllowed({
      attemptsMade: input.attemptsMade,
      daysRemaining: input.daysRemaining,
      practiceRaisedCapTo: input.practiceRaisedCapTo,
    })
  ) {
    throw new ChaseAttemptError(
      chaseBandFor(input.daysRemaining).band === 'expired'
        ? 'The twelve-month lodgement window has closed (REQ-CHASE-08) -- this service cannot be billed, so it is ' +
          'not chased. Record it as revenue forgone instead.'
        : "This band's attempts are used up (REQ-CHASE-09). Convert the item, forgo it, or hand it back.",
    );
  }
}

/** Which rung this attempt is, for display and for the vault payload. */
export function chaseAttemptOrdinal(attemptsMade: number): number {
  return Math.max(0, attemptsMade) + 1;
}
