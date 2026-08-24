/**
 * Acting as a practice.
 *
 * WHY THIS EXISTS AT ALL. A practice can be unable to act for itself: no admin
 * passkey enrolled yet, an administrator who left suddenly, a doctor who is not
 * technical and whose assistant has gone. Until now there was NO path — a
 * platform operator simply could not invite a practitioner or fix an address on
 * their behalf, and the honest note in CRITICAL-ISSUES §6.4 said so.
 *
 * The alternative to building this is not "nobody impersonates". It is somebody
 * being handed the practice's passkey over the phone, which is impersonation
 * with none of the record.
 *
 * THE RULES ARE CARL'S, AND TWO OF THEM ARE STRONGER THAN WHAT WAS PROPOSED
 * (CRITICAL-ISSUES.md §5.1):
 *
 *   1. NO OTP BEFORE. Asking a practice for a code before helping them assumes
 *      somebody is there to answer, and the whole reason for acting-as is that
 *      nobody is. The practice is told AFTERWARDS, which is a control that
 *      works when the practice is absent — an OTP is not.
 *   2. EVIDENCE CREATED INSIDE A SESSION DOES NOT SCORE. Whatever an operator
 *      records while wearing the practice's face is worth zero towards
 *      approval. Otherwise a single person could manufacture the evidence and
 *      then rely on it.
 *   3. NOTHING MAY BE REMOVED, including soft deletes. An operator acting for a
 *      practice may add and amend; they may not make anything disappear.
 *   4. ANY IMPERSONATION FORCES RE-APPROVAL, even of a currently-active
 *      practice.
 *   5. THAT RE-APPROVAL MUST BE BY A DIFFERENT PERSON.
 *
 * Rules 4 and 5 are the load-bearing pair, and rule 5 is why rule 2 is not the
 * only defence. Rule 2 depends on a scoring exclusion staying correct — a rule
 * enforced by arithmetic that somebody could later "fix". Rule 5 does not: the
 * person who acted as the practice cannot be the person who blesses the
 * result. Even if the scoring exclusion were removed tomorrow by mistake, one
 * individual still could not manufacture evidence and approve it.
 *
 * And rule 4 is what gives rule 5 teeth. Without it, impersonation is merely
 * logged — and a log nobody reads is not a control. With it, impersonation has
 * a COST: it puts the practice back through approval, which a busy person
 * actually feels. The quick path and the safe path become the same path.
 */

/** Why somebody is acting for a practice. Chosen, not typed, so it can be counted. */
export const ACTING_AS_REASONS = [
  {
    key: 'no_admin_access',
    label: 'The practice cannot sign in — no passkey enrolled, or the administrator has gone',
    detail: 'The case this exists for. Nobody at the practice can act, so somebody has to.',
  },
  {
    key: 'correcting_our_error',
    label: 'Correcting something AoBPlatform got wrong',
    detail: 'Our mistake, our repair. The practice should not have to fix it themselves.',
  },
  {
    key: 'support_request',
    label: 'The practice asked us to do it for them',
    detail: 'They are present and able, and asked anyway. The most questionable reason, and still recorded.',
  },
  {
    key: 'compliance_action',
    label: 'A compliance or regulatory action requires it',
    detail: 'Rare, and the note should say what required it.',
  },
] as const;

export const ACTING_AS_REASON_KEYS = ACTING_AS_REASONS.map((r) => r.key);

export function actingAsReason(key: string) {
  return ACTING_AS_REASONS.find((r) => r.key === key);
}

/**
 * How long a session may run before it expires on its own.
 *
 * Short, and deliberately. An operator fixing an address needs minutes. A
 * session left open all afternoon is a window in which every action is
 * attributed to a practice that does not know it is happening — and the
 * expiry is what stops "I forgot to close it" becoming that window.
 */
export const ACTING_AS_MAX_MINUTES = 30;

export class ActingAsError extends Error {}

/**
 * WHAT AN OPERATOR MAY NOT DO WHILE WEARING A PRACTICE'S FACE.
 *
 * Removal, in every form the system has. Listed by the shape of the act rather
 * than by endpoint, because endpoints get added and this list is the rule.
 *
 * The reasoning is asymmetry of harm: an operator who adds something wrong
 * leaves a wrong thing that can be seen, questioned and corrected. An operator
 * who removes something leaves nothing to question. In a system whose product
 * is evidence, the second is not a bigger mistake — it is a different kind.
 */
export const FORBIDDEN_WHILE_ACTING_AS = [
  'delete',
  'remove',
  'tombstone',
  'deactivate',
  'withdraw',
  'cease',
  'end',
] as const;

/**
 * May this act be performed inside an acting-as session?
 *
 * `intent` is the shape of the act, not a URL — a caller says what it is doing
 * and this answers. Naming intents rather than matching paths means a new
 * endpoint is refused by default if it declares a removing intent, instead of
 * being permitted by default because nobody updated a regex.
 */
export function assertPermittedWhileActingAs(intent: string): void {
  /*
   * MATCHED BY SEGMENT, NOT BY SUBSTRING, and the test that caught this is
   * worth keeping in mind: `amend_application` contains "end", so a substring
   * match refused amending — the single most useful thing an operator does
   * for a practice that cannot act for itself.
   *
   * Intents are snake_case verbs, so the segments ARE the words.
   */
  const segments = intent.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const hit = FORBIDDEN_WHILE_ACTING_AS.find((f) => segments.includes(f));
  if (hit) {
    throw new ActingAsError(
      `Acting for a practice cannot ${hit} anything. An operator may add and amend on a practice's behalf, ` +
        'but not make something disappear — a wrong thing that was added can be seen and corrected, and a ' +
        'thing that was removed leaves nothing to question. Ask the practice to do it themselves, or end ' +
        'this session first.',
    );
  }
}

export interface ActingAsSessionLike {
  id: string;
  practiceId: string;
  /** The Keycloak subject of the real person. Never the practice. */
  operatorSub: string;
  startedAt: Date | string;
  endedAt?: Date | string | null;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Is this session still live?
 *
 * EXPIRY IS COMPUTED, not stored. A session whose row says it is open but
 * started two days ago is not open — and relying on a sweep to close it would
 * mean the sweep failing is the same as the session never ending.
 */
export function isSessionLive(session: ActingAsSessionLike, now: Date): boolean {
  if (session.endedAt) return false;
  const started = asDate(session.startedAt);
  if (!started) return false;
  return now.getTime() - started.getTime() < ACTING_AS_MAX_MINUTES * 60_000;
}

/** When it will lapse, so a screen can say so rather than surprising somebody. */
export function sessionExpiresAt(session: ActingAsSessionLike): Date | null {
  const started = asDate(session.startedAt);
  if (!started) return null;
  return new Date(started.getTime() + ACTING_AS_MAX_MINUTES * 60_000);
}

/**
 * May this person approve this practice?
 *
 * RULE 7, and it is the one that survives every other control failing.
 *
 * Somebody who acted as a practice cannot then bless the result. Not "should
 * not" — cannot, checked here, tested, and enforced at the point of decision.
 * Even if the scoring exclusion for impersonated evidence were removed by
 * mistake, a single individual still could not manufacture evidence and
 * approve it.
 *
 * The check is against EVERY operator who has ever acted for this practice
 * since its last approval, not merely the most recent. Two operators taking
 * turns would otherwise clear each other.
 */
export function assertMayApproveAfterActingAs(input: {
  approverSub: string;
  /** Operator subs who acted as this practice since its last approval. */
  impersonatorSubs: readonly string[];
}): void {
  if (input.impersonatorSubs.includes(input.approverSub)) {
    throw new ActingAsError(
      'You acted as this practice, so you cannot be the person who approves it. Somebody else has to look ' +
        'at what was done and decide. That separation is the point: it holds even if every other control ' +
        'around impersonation fails.',
    );
  }
}

/**
 * Does starting a session put the practice back through approval?
 *
 * Always — RULE 6. Including a practice that is currently active, which is the
 * part that makes it a deterrent rather than a formality.
 *
 * Written as a function rather than a constant because somebody WILL ask for
 * an exception ("it was only a typo"), and the answer needs somewhere to live
 * that shows it was considered.
 */
export function forcesReapproval(): boolean {
  /*
   * No exceptions, and the tempting one is "read-only sessions". It is
   * tempting because it sounds harmless, and it is refused because the
   * platform cannot prove a session was read-only after the fact — only that
   * nothing was written, which is not the same claim. A session that wrote
   * nothing costs a re-approval that is quick to grant.
   */
  return true;
}

/** What the practice is told afterwards. Written once so every surface agrees. */
export function noticeToPractice(input: {
  operatorName: string;
  reasonKey: string;
  startedAt: Date;
  note?: string;
  /**
   * Where to see it for themselves. Optional so a caller with no console URl
   * configured still gets a usable notice — the line simply does not appear,
   * rather than the function refusing to compose one at all.
   */
  consoleUrl?: string;
}): { subject: string; lines: string[] } {
  const reason = actingAsReason(input.reasonKey);
  return {
    subject: 'Somebody at AoBPlatform acted on your practice’s behalf',
    lines: [
      `${input.operatorName} at AoBPlatform used your practice’s console on ` +
        `${input.startedAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`,
      reason ? `Why: ${reason.label}.` : 'Why: not recorded.',
      ...(input.note ? [`They added: ${input.note}`] : []),
      'Everything they did is recorded against their name, not yours.',
      'Your practice now needs to be approved again before anything else changes. That is deliberate: it ' +
        'means somebody other than the person who acted for you has to look at what was done.',
      /*
       * TOLD WHERE TO LOOK, not only what happened. A notice that describes an
       * action without a way to go and see it for yourself asks to be trusted
       * rather than checked — and this is precisely the message where trust
       * without a way to verify is the wrong ask.
       */
      ...(input.consoleUrl
        ? [`You can sign in to AoBPlatform at ${input.consoleUrl} to see this change for yourself.`]
        : []),
      'If you did not expect this, tell us — the details above are enough for us to find exactly what ' +
        'happened.',
    ],
  };
}
