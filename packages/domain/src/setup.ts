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
}

export interface CaptureReadiness {
  readonly ready: boolean;
  readonly readyCount: number;
  /** What is missing, in the order it must be fixed. Empty when ready. */
  readonly blockers: string[];
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

  if (input.activeLocations === 0) {
    blockers.push('No location is active yet. A practitioner is affiliated to a location, so this comes first.');
  }
  if (input.practitioners === 0) {
    blockers.push('No practitioner has been invited yet.');
  } else if (input.acceptedAffiliations === 0) {
    // The distinction the hub exists to make: invited is not accepted, and a
    // practice cannot accept on a practitioner's behalf.
    blockers.push(
      'No practitioner has accepted their affiliation. An invitation is not an acceptance, and a practice ' +
        'cannot accept on a practitioner’s behalf.',
    );
  } else if (input.captureReadyAffiliations === 0) {
    blockers.push(
      'An affiliation is accepted, but none yet has a provider number or a place-of-practice address at an ' +
        'active location — one or the other is what s 65C(5) requires.',
    );
  }

  const ready = blockers.length === 0;

  return {
    ready,
    readyCount: input.captureReadyAffiliations,
    blockers,
    headline: ready
      ? input.captureReadyAffiliations === 1
        ? 'One practitioner is ready to capture consent.'
        : `${input.captureReadyAffiliations} practitioners are ready to capture consent.`
      : 'Consent capture is not available yet. Patients can still be seen and billed — what is missing is ' +
        'our record of their consent.',
  };
}
