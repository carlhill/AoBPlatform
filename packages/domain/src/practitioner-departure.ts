/**
 * A practitioner leaving a practice, on their own say-so.
 *
 * WHY UNILATERAL, AND WHY THAT IS THE WHOLE POINT.
 *
 * The practice can already record a departure. If that were the only way out,
 * a practice could keep somebody listed after they had gone — and a listed
 * practitioner is one under whose name consent can still be captured. That is
 * not an inconvenience, it is the fraud this platform exists to make
 * impossible: an assignment of benefit signed against a practitioner who was
 * not there.
 *
 * So a practitioner may end their own affiliation without anybody agreeing to
 * it. The practice is told; the practice is not asked.
 *
 * THE SYMMETRY IS DELIBERATE AND IT IS NOT SYMMETRICAL. A practice giving
 * notice is a commercial arrangement with a negotiated end date, and the rules
 * in `departure-notice.ts` govern it. A practitioner leaving is a statement of
 * fact about where they work, and a fact does not need a notice period.
 */

export class PractitionerDepartureError extends Error {}

/**
 * Why they are leaving, chosen from a list rather than typed.
 *
 * Not for the practice's benefit — it does not change what happens. It is so
 * that "practitioners leaving because they never worked here" can be counted
 * separately from ordinary turnover, because the first is a signal about the
 * practice and the second is not.
 */
export const DEPARTURE_REASONS = [
  {
    key: 'ending_employment',
    label: 'I am leaving this practice',
    detail: 'The ordinary one. Employment ending, on a date you agree with them or one you set.',
    suspicious: false,
  },
  {
    key: 'already_left',
    label: 'I have already left — this is out of date',
    detail: 'You are still listed somewhere you no longer work. That takes effect immediately.',
    suspicious: true,
  },
  {
    key: 'never_worked_here',
    label: 'I have never worked at this practice',
    detail:
      'Somebody listed you at a practice you have no connection to. This takes effect immediately and a ' +
      'person here looks at it.',
    suspicious: true,
  },
  {
    key: 'other',
    label: 'Another reason',
    detail: 'Tell us in your own words.',
    suspicious: false,
  },
] as const;

export type DepartureReason = (typeof DEPARTURE_REASONS)[number]['key'];
export const DEPARTURE_REASON_KEYS = DEPARTURE_REASONS.map((r) => r.key);

export function departureReason(key: string) {
  return DEPARTURE_REASONS.find((r) => r.key === key);
}

/**
 * A reason that says the listing was WRONG rather than that it is ending.
 *
 * These take effect at once and always reach a person, because "I never worked
 * there" is a claim that somebody was listed at a practice they have no
 * connection to — and if that is true, everything captured under their name
 * there is in question.
 */
export function isImmediate(reason: string): boolean {
  return reason === 'already_left' || reason === 'never_worked_here';
}

export function raisesConcern(reason: string): boolean {
  return departureReason(reason)?.suspicious === true;
}

export type DepartureRequest = {
  reason: string;
  /** Their own words. Required for `other`, and for anything immediate. */
  note?: string | null;
  /** Absent means "now". Ignored entirely for the immediate reasons. */
  endsAt?: Date | null;
};

export type AffiliationForDeparture = {
  status: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
  endsAt?: Date | null;
};

/**
 * Whether this affiliation can be departed at all, and when it ends.
 *
 * `now` is passed rather than read, because a departure date decides which
 * agreements are valid and a function that reads the clock cannot be tested
 * against the boundary.
 */
export function assessPractitionerDeparture(input: {
  affiliation: AffiliationForDeparture;
  request: DepartureRequest;
  now: Date;
}): { endsAt: Date; immediate: boolean; needsReview: boolean; concern: boolean } {
  const { affiliation, request, now } = input;

  const reason = departureReason(request.reason);
  if (!reason) {
    throw new PractitionerDepartureError(
      `"${request.reason}" is not a reason we recognise. Choose one of: ${DEPARTURE_REASON_KEYS.join(', ')}.`,
    );
  }

  if (affiliation.endedAt) {
    throw new PractitionerDepartureError('This affiliation has already ended, so there is nothing to leave.');
  }

  /*
   * NOT YET ACCEPTED IS NOT THE SAME AS ENDED. Somebody who has been invited
   * and has not answered should REJECT the invitation rather than depart a job
   * they never started — different act, different record, and conflating them
   * would show as employment that ended rather than an invitation declined.
   */
  if (affiliation.status !== 'active') {
    throw new PractitionerDepartureError(
      'You have not accepted this invitation, so there is nothing to leave. Reject the invitation instead — ' +
        'declining an invitation and leaving a job are different things, and the record should say which.',
    );
  }

  if ((reason.key === 'other' || isImmediate(reason.key)) && !request.note?.trim()) {
    throw new PractitionerDepartureError('Please say in your own words what has happened.');
  }

  const immediate = isImmediate(reason.key);
  const endsAt = immediate ? now : (request.endsAt ?? now);

  /*
   * A DATE IN THE PAST IS REFUSED, except through the reasons that mean it.
   *
   * "I left last March" is `already_left`, which takes effect now and is
   * reviewed — backdating an ordinary departure would retroactively invalidate
   * consent captured in good faith between then and now, which is not a thing
   * a form should be able to do quietly.
   */
  if (!immediate && endsAt.getTime() < now.getTime()) {
    throw new PractitionerDepartureError(
      'That date has passed. If you have already left, say so — we will end it now and somebody will look at ' +
        'what was captured in the meantime, rather than silently changing what was true last month.',
    );
  }

  return {
    endsAt,
    immediate,
    // ALWAYS reviewed when the reason implies the listing was wrong. Not
    // conditional on there being captures: "nobody used it" is a fact for the
    // reviewer to establish, not an assumption for this function to make.
    needsReview: raisesConcern(reason.key),
    concern: raisesConcern(reason.key),
  };
}

/**
 * What the practice is told. They are told in every case.
 *
 * NOT `noticeToPractice` — `acting-as.ts` already exports that, and two modules
 * exporting one name means the barrel picks a winner silently. The same trap as
 * `isClaimable`, which had to be renamed for the same reason.
 *
 * A departure changes who the practice may capture consent under, so a
 * practice learning about it late is a practice capturing invalid consent in
 * the meantime. The message is deliberately plain about the fact and silent
 * about the practitioner's stated reason — that reason is between them and us
 * until a reviewer decides otherwise, and a practice reading "they say they
 * never worked here" before anybody has checked helps nobody.
 */
export function departureNoticeToPractice(input: {
  practitionerName: string;
  endsAt: Date;
  immediate: boolean;
}): { subject: string; lines: string[] } {
  const when = input.endsAt.toISOString().slice(0, 10);

  return {
    subject: input.immediate
      ? `${input.practitionerName} has ended their affiliation with your practice`
      : `${input.practitionerName} has given notice of leaving your practice`,
    lines: input.immediate
      ? [
          `${input.practitionerName} has recorded that they no longer work at your practice, effective today.`,
          'Consent can no longer be captured under their name. Anything already captured stands.',
          'If you believe this is wrong, tell us — do not re-add them, because that would be a second record ' +
            'of the same person rather than a correction of the first.',
        ]
      : [
          `${input.practitionerName} has recorded that their last day with you is ${when}.`,
          'Nothing changes until then. From that date consent cannot be captured under their name.',
        ],
  };
}
