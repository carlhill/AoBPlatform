/**
 * The affiliation invitation, and what answering one actually proves.
 *
 * THE RULE THIS SERVES: a practice may invite; only the practitioner can turn
 * an invitation into an active affiliation. Everything else here exists to keep
 * that rule honest rather than nominal — a rule enforced by a flag that anybody
 * can set is not a rule.
 *
 * WHAT AN EMAILED LINK AND CODE PROVE, EXACTLY. That somebody read a particular
 * email. Not who they are. Both halves travel in the same message, so this is
 * proof of ACCESS TO AN INBOX and it is recorded under that name.
 *
 * That is weaker than it sounds and stronger than nothing:
 *
 *   - weaker, because the practice chose which address to invite, so a practice
 *     willing to commit fraud can invite an address it controls. What stops
 *     that is not this ceremony; it is that inventing the practitioner in the
 *     first place costs an active ABN, a matching registered name and a named
 *     human's approval (CONVENTIONS.md §8b).
 *
 *   - stronger than nothing, because the ordinary failure this prevents is not
 *     fraud at all. It is a practice adding a doctor who never agreed —
 *     through haste, a misunderstanding, or a locum arrangement that fell
 *     through — and then capturing consent in that doctor's name.
 *
 * The honest fix is the practitioner passkey (FR-1.9). Until then the method is
 * recorded per affiliation so that the two never blur together in evidence:
 * "accepted" must not be a single undifferentiated word covering both a
 * biometric assertion and a forwarded email.
 */

export class InvitationError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'InvitationError';
  }
}

/**
 * How long an invitation stays answerable.
 *
 * Longer than the five-day correction window, which is time-boxed because a
 * reviewer is waiting on it. NOTHING IS WAITING ON THIS ONE. A locum on leave,
 * a registrar on nights, a specialist who reads personal mail on Sundays —
 * none of them are holding anybody up, and an invitation that dies before they
 * open it produces a support call and a re-send, not a faster answer.
 *
 * Bounded all the same. An invitation open for a year is a live credential in
 * an old inbox long after the job it referred to has gone.
 */
export const INVITATION_DAYS = 14;

/**
 * Five wrong codes and it stops.
 *
 * THE CAP IS WHAT MAKES THE CODE SAFE, NOT ITS LENGTH. Six digits is a million
 * combinations, which an unthrottled endpoint gives up in minutes. With a cap,
 * the expected number of guesses needed makes it pointless. A six-digit code
 * with unlimited attempts is a four-digit code with extra steps.
 */
export const INVITATION_ATTEMPT_CAP = 5;

/** Exactly six digits. Leading zeros are real — never trim them to a number. */
export const INVITATION_CODE_PATTERN = /^\d{6}$/;

export function isInvitationCodeShaped(code: string): boolean {
  return INVITATION_CODE_PATTERN.test(code.trim());
}

/**
 * How an affiliation came to be accepted. Recorded, never inferred.
 *
 * `console` covers a practitioner with no email answering in front of somebody
 * — legitimate, and the weakest of the three, because the only witness to it is
 * the practice that benefits.
 */
export const ACCEPTANCE_METHODS = ['email_link_and_code', 'passkey', 'console'] as const;
export type AcceptanceMethod = (typeof ACCEPTANCE_METHODS)[number];

/**
 * What each method actually establishes, in words fit to show a reviewer.
 *
 * Written for the person reading evidence two years later who has to decide
 * whether this affiliation is worth anything. "Accepted" tells them nothing.
 */
export const ACCEPTANCE_MEANS: Record<AcceptanceMethod, string> = {
  email_link_and_code:
    'Someone opened the invitation sent to the practitioner’s own email address and typed the code from ' +
    'it. That proves access to that inbox. It does not prove who was at the keyboard.',
  passkey:
    'The practitioner authenticated with their passkey, which required their device and their fingerprint, ' +
    'face or PIN. That is the strongest acceptance we can record.',
  console:
    'The practice recorded the practitioner’s answer on their behalf, because there was no email address ' +
    'to send an invitation to. The only witness is the practice itself.',
};

/** Ranked weakest to strongest, for anything that must compare two records. */
export const ACCEPTANCE_STRENGTH: Record<AcceptanceMethod, number> = {
  console: 1,
  email_link_and_code: 2,
  passkey: 3,
};

// ---------------------------------------------------------------------------
// What the page may do
// ---------------------------------------------------------------------------

/**
 * `not_found` covers a token that never existed AND one already used, because
 * both clear the token. Deliberately the same answer: distinguishing them turns
 * the page into an oracle for "was this a real invitation".
 */
export const INVITATION_STATES = [
  'live',
  'expired',
  'locked',
  'already_accepted',
  'already_declined',
  'ended',
  'deregistered',
  'not_found',
] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];

export function canAnswerInvitation(state: InvitationState): boolean {
  return state === 'live';
}

/**
 * What to tell whoever opened the link.
 *
 * EVERY DEAD END SAYS WHAT TO DO NEXT. A page that says only "this link has
 * expired" leaves a practitioner with no idea whether to ring the practice,
 * ring us, or do nothing — and the commonest outcome is doing nothing, which
 * looks to the practice like a refusal.
 */
export function invitationMessage(state: InvitationState, attemptsLeft = 0): string {
  switch (state) {
    case 'live':
      return attemptsLeft < INVITATION_ATTEMPT_CAP
        ? `That code was not right. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left ` +
            'before this invitation locks and the practice has to send a new one.'
        : 'Enter the six-digit code from the invitation email.';
    case 'expired':
      return (
        `This invitation has expired — they last ${INVITATION_DAYS} days. Ask the practice to send ` +
        'another; nothing is lost by doing so, and the new one supersedes this link.'
      );
    case 'locked':
      return (
        'Too many wrong codes have been entered, so this invitation is locked. Ask the practice to send a ' +
        'new one. This is not a judgement about you — it is what stops somebody guessing their way in.'
      );
    case 'already_accepted':
      return 'You have already accepted this. There is nothing further to do here.';
    case 'already_declined':
      return (
        'This invitation was declined. If that was a mistake, ask the practice to invite you again — a ' +
        'declined invitation cannot be reopened from this link, deliberately.'
      );
    case 'ended':
      return 'This affiliation has ended. Ask the practice to invite you again if you are returning.';
    case 'deregistered':
      return (
        'AHPRA no longer lists this practitioner as registered, so this invitation cannot be accepted. If ' +
        'that is wrong, the place to correct it is the AHPRA register, and we will follow it.'
      );
    case 'not_found':
      return (
        'This invitation link is not valid. It may have already been used, or replaced by a newer one — ' +
        'check for a more recent email, and otherwise ask the practice to send another.'
      );
  }
}

/**
 * What the practitioner is being asked to agree to, in one sentence.
 *
 * NOBODY CAN CONSENT TO AN UNNAMED THING. This is why the invitation page names
 * the practice and the site before asking for a code, rather than after: asking
 * somebody to prove they read an email before telling them what it was about is
 * both useless and slightly sinister.
 */
export function invitationSummary(input: {
  practiceName: string;
  locationCode?: string | null;
  locationAddress: string;
  departmentName?: string | null;
}): string {
  const where = input.locationCode
    ? `${input.locationCode} (${input.locationAddress})`
    : input.locationAddress;
  const department = input.departmentName ? `, in ${input.departmentName}` : '';
  return `${input.practiceName} is asking to record you as practising at ${where}${department}.`;
}

/**
 * What accepting DOES, and what it does not.
 *
 * The second half matters more than the first. A practitioner who thinks they
 * have signed something for a patient will not read the next thing we send
 * them, and this is the moment to be clear that they have not.
 */
export const INVITATION_CONSEQUENCES = [
  'This practice can record patient consent naming you as the practitioner at that location.',
  'Your Medicare provider number for that location, if the practice holds one, becomes part of those records.',
  'You can end it at any time by telling the practice, and they must record the date you leave.',
] as const;

/**
 * The caveat, held apart from the list ON PURPOSE.
 *
 * It is the sentence most likely to be skimmed and the one most costly to
 * misunderstand, so every surface gives it its own weight rather than letting
 * it sit as the third bullet of four. Keeping it here, rather than as page
 * copy, is what stops the page and the email drifting into saying two slightly
 * different things about the same limit.
 */
export const INVITATION_NOT_CONSENT =
  'This is not consent on any patient’s behalf, and you are not signing an agreement here.';

export function assertCanAnswer(state: InvitationState): void {
  if (!canAnswerInvitation(state)) {
    throw new InvitationError('FR-1.8', invitationMessage(state));
  }
}
