/**
 * The practice setup hub.
 *
 * NOT A WIZARD, and that is the load-bearing decision. A wizard implies a
 * finish, and a practice adds locations and practitioners for years after it
 * onboards — so the hub is a set of cards worked in any order, each carrying
 * its own state, revisited indefinitely.
 *
 * THE HUB LEADS WITH WHAT IS NOT YET POSSIBLE.
 *
 * This is the rule everything else here serves. Card counts alone let a
 * practice believe capture is live when in fact no practitioner has accepted an
 * affiliation — "3 practitioners, 2 locations" reads as readiness and is not.
 * The single most useful sentence on the page is therefore not a count but a
 * statement of what can and cannot happen right now, and it is computed rather
 * than implied.
 *
 * WORST ROW FIRST, inside every card. The exception is what needs work, so it
 * is promoted above the healthy rows rather than sorted alphabetically. A card
 * that lists rows in name order asks the reader to scan for the problem; one
 * that promotes it has already answered.
 *
 * CARDS SUMMARISE; THE PAGE HOLDS THE LIST. A multi-site organisation can have
 * hundreds of affiliations, so a card caps at a roll-up plus two rows and opens
 * a full table. The card never scrolls — a scrolling card hides exactly the
 * thing the promotion rule just surfaced.
 */

export type CardState = 'done' | 'attention' | 'not_started' | 'blocked';

/** Ordering weight: attention before not-started before done. */
const STATE_RANK: Record<CardState, number> = { blocked: 0, attention: 1, not_started: 2, done: 3 };

export interface SetupRow {
  readonly label: string;
  readonly note: string;
  /** Rows that need work sort above rows that do not. */
  readonly needsWork: boolean;
}

/**
 * Promote the rows that need work.
 *
 * Stable within each group, so the caller's own ordering (most recent first,
 * say) survives inside "needs work" and inside "fine".
 */
export function worstRowsFirst(rows: readonly SetupRow[]): SetupRow[] {
  return [...rows].sort((a, b) => Number(b.needsWork) - Number(a.needsWork));
}

/** Cards in the order the hub should present them. Stable within a state. */
export function orderCards<T extends { state: CardState }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
}

export interface CaptureInputs {
  readonly activeLocations: number;
  readonly practitioners: number;
  /** Affiliations the PRACTITIONER has accepted. A practice cannot self-accept. */
  readonly acceptedAffiliations: number;
  /**
   * Accepted affiliations that ALSO have what s 65C(5) requires: a provider
   * number, or a place-of-practice address at an active location.
   */
  readonly captureReadyAffiliations: number;

  /**
   * CAN ANYBODY AT THIS PRACTICE SIGN IN AT ALL.
   *
   * Absent until now, and it is the first thing that can be wrong. A practice
   * can be approved, have locations, practitioners and accepted affiliations,
   * and still have nobody able to open the console — because approving a
   * practice and sending its administrator the way in are two acts and only
   * the first was anybody's job.
   *
   * It belongs FIRST among the blockers for the same reason locations come
   * before practitioners: nothing below it can be done by the practice itself
   * until this is true.
   *
   * MEASURED ON WHO ACTUALLY HAS AN ACCOUNT, not on a flag somewhere. The
   * first version read `practice.adminPasskeyEnrolledAt`, which is set only by
   * one path — so it told a practice administrator who had signed in an hour
   * earlier that nobody at the practice could sign in. A blocker the reader can
   * personally disprove is worse than none: it teaches them to disbelieve the
   * next one too.
   */
  readonly administratorEnrolled?: boolean;
}

export interface SetupGap {
  /** Two or three words. Fits in a chip and in a list. */
  readonly label: string;
  /** The full sentence — the same text as the matching blocker. */
  readonly detail: string;
  /** The page where this is fixed. */
  readonly href: string;
}

export interface CaptureReadiness {
  readonly ready: boolean;
  readonly readyCount: number;
  /** What is missing, in the order it must be fixed. Empty when ready. */
  readonly blockers: string[];
  /**
   * WHAT IS MISSING, NAMED, AND WHERE TO GO AND FIX IT.
   *
   * "NEEDS WORK" was the status, and Carl's objection is the whole reason this
   * exists: it describes a state without naming the gap, so the one thing
   * anybody wants from a status — what do I do about it — is the thing it
   * withholds. In his words: "you have to list what work needs to be done and
   * give a link to the page to do this work."
   *
   * So each gap carries three things and not one: a label short enough for a
   * chip, the sentence that explains it, and the page where it is fixed. A
   * label without a destination is still a puzzle; a destination without a
   * label is a link nobody knows the purpose of.
   */
  readonly gaps: SetupGap[];
  /**
   * The single sentence at the top of the hub. Always present — when capture IS
   * possible it says so, because "nothing is wrong" is itself information a
   * practice manager wants without reading five cards.
   */
  readonly headline: string;
}

/**
 * Whether consent capture can actually happen, and if not, why not.
 *
 * The order of the blockers is the order they must be resolved, not the order
 * they were discovered: a practitioner cannot accept an affiliation to a
 * location that does not exist, so locations come first regardless.
 *
 * NOTE WHAT THIS DOES NOT CLAIM. Capture being unavailable does not stop
 * patients being seen or billed — it stops US holding a consent record. Saying
 * that plainly matters, because a practice reading "capture is not available"
 * on a clinical morning should not think their clinic has stopped.
 */
export function captureReadiness(input: CaptureInputs): CaptureReadiness {
  const blockers: string[] = [];
  const gaps: SetupGap[] = [];

  /*
   * FIRST, because a practice nobody can sign in to cannot fix any of the
   * rest. `undefined` means the caller has not told us — older callers, and a
   * question we should not answer by guessing "yes".
   */
  if (input.administratorEnrolled === false) {
    blockers.push(
      'Nobody at this practice can sign in yet. The administrator has not enrolled a passkey, so the ' +
        'practice cannot do any of the steps below for itself.',
    );
    gaps.push({
      label: 'No administrator',
      detail: blockers[blockers.length - 1],
      // Where an administrator is given access. Until validation and
      // invitation are one act, this is where somebody goes to fix it.
      href: '/practice/users',
    });
  }

  if (input.activeLocations === 0) {
    blockers.push('No location is active yet. A practitioner is affiliated to a location, so this comes first.');
    gaps.push({ label: 'No active location', detail: blockers[blockers.length - 1], href: '/practice/locations' });
  }
  if (input.practitioners === 0) {
    blockers.push('No practitioner has been invited yet.');
    gaps.push({ label: 'No practitioner', detail: blockers[blockers.length - 1], href: '/practice/practitioners' });
  } else if (input.acceptedAffiliations === 0) {
    // The distinction the hub exists to make: invited is not accepted, and a
    // practice cannot accept on a practitioner's behalf.
    blockers.push(
      'No practitioner has accepted their affiliation. An invitation is not an acceptance, and a practice ' +
        'cannot accept on a practitioner’s behalf.',
    );
    gaps.push({
      label: 'Nobody has accepted',
      detail: blockers[blockers.length - 1],
      // The affiliations page, because that is where an invitation is chased
      // -- resent, or its state read. A practice cannot accept for them.
      href: '/practice/affiliations',
    });
  } else if (input.captureReadyAffiliations === 0) {
    blockers.push(
      'An affiliation is accepted, but none yet has a provider number or a place-of-practice address at an ' +
        'active location — one or the other is what s 65C(5) requires.',
    );
    gaps.push({
      label: 'No provider number or address',
      detail: blockers[blockers.length - 1],
      href: '/practice/affiliations',
    });
  }

  const ready = blockers.length === 0;

  return {
    ready,
    readyCount: input.captureReadyAffiliations,
    blockers,
    gaps,
    headline: ready
      ? input.captureReadyAffiliations === 1
        ? 'One practitioner is ready to capture consent.'
        : `${input.captureReadyAffiliations} practitioners are ready to capture consent.`
      : 'Consent capture is not available yet. Patients can still be seen and billed — what is missing is ' +
        'our record of their consent.',
  };
}
