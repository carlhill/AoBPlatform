/**
 * WHICH STEPS THIS CEREMONY WILL ACTUALLY RUN, AND WHERE THE PATIENT IS IN THEM
 * (Carl, 27 September 2026, from a live tablet).
 *
 * WHY THIS FILE EXISTS. Every screen used to hardcode its own chip — K-2 "Step
 * 1 of 4", K-5 "2 of 4", K-3 "3 of 4", K-4 "4 of 4", K-P1 "1 of 3" — and a
 * literal can only be right for one route. There are three:
 *
 *   1. Walk-up, particulars open:    K-2 → K-5 → K-3 → K-4.  Four steps.
 *   2. Walk-up, particulars locked:  K-2 →       K-3 → K-4.  Three; K-5 is
 *      skipped because who signs is one of the locked particulars and there is
 *      nothing to choose (`k5_is_skipped_when_particulars_are_locked`).
 *   3. Pushed session:              K-P1 →       K-3 → K-4.  Three; reception
 *      checked across the desk, so there is no verification form and no K-5.
 *
 * The literals described route 1. On route 3 the patient therefore read "Step 1
 * of 3", then "Step 3 of 4", then "Step 4 of 4" — which is what Carl reported:
 * "the kiosk starts at step3 and not step1 ... There is no step2." Nothing was
 * being skipped; the chip was counting somebody else's ceremony.
 *
 * SO THE SEQUENCE IS DERIVED, ONCE, WHERE THE ROUTE IS KNOWN. `Ceremony.tsx` is
 * the only thing that knows which front door was used and whether K-5 will run,
 * and it now says so here and passes the answer down. A screen numbers nothing:
 * the same K-3 is the third of four, or the second of three, depending only on
 * how somebody got to it.
 *
 * THIS FILE DECIDES NOTHING ABOUT THE FLOW. It does not route, gate or skip
 * anything — the step order, every Back and every skip are exactly where they
 * were, in `Ceremony.tsx`. All that moved is the arithmetic behind the chip. A
 * FOURTH ROUTE ADDED LATER MUST BE ADDED HERE TOO, with a case in
 * `ceremony-steps.test.tsx`; a route this file has not been told about will
 * number itself as one of the three above, which is the defect returning.
 *
 * THE WORDS ARE THE STRING TABLE'S. This file returns numbers; the sentence is
 * `strings.chrome.stepOf` and there is no second formatter (REQ-LANG-01).
 */

/**
 * The steps that carry a number. The ceremony has other screens — `booting`,
 * `pairing`, `unpaired`, `idle`, `list`, `complete`, `handover`, the outage and
 * out-of-use screens — and none of them is a step of the ceremony: K-6 already
 * heads itself with `strings.chrome.complete`, a word rather than a position,
 * and the rest are the device's own states rather than the patient's progress.
 */
export type NumberedStep = 'check-details' | 'verify' | 'assignor' | 'particulars' | 'signature';

/** The steps one route will run, in the order it will run them. */
export type CeremonySequence = readonly NumberedStep[];

/** A position in a sequence, for `strings.chrome.stepOf`. */
export interface StepNumber {
  position: number;
  total: number;
}

export interface CeremonyRoute {
  /**
   * The ceremony began from a pushed session (K-P1), rather than from Begin.
   * The push has its own first screen and no K-5 at all.
   */
  pushed: boolean;
  /**
   * WERE THE PARTICULARS ALREADY LOCKED WHEN VERIFICATION PASSED — the fact
   * `Ceremony.tsx` branches on when it chooses between K-5 and K-3
   * (`afterVerified`). It decides whether route 1 or route 2 is being run.
   *
   * NOT THE LIVE LOCK FLAG, AND THE DIFFERENCE IS THE WHOLE POINT. On route 1
   * the particulars are locked BY K-3, as the patient stands reading them, so
   * an `agreement.particularsLockedAt != null` read on every render would flip
   * the chip from "Step 3 of 4" to "Step 2 of 3" under somebody who had not
   * moved. The route is settled when it is chosen and does not change again.
   * Named test:
   * `a_walk_up_with_open_particulars_counts_four_and_the_total_does_not_change_when_k3_locks`.
   *
   * FALSE UNTIL VERIFICATION PASSES, AND K-2 IS THE ONE PLACE THIS COUNT IS A
   * FORECAST. Standing on K-2 the tablet has not read the agreement and cannot
   * know whether K-5 will run — the waiting row does not carry the lock, and on
   * the claim path there is no row yet at all. So it counts the ordinary
   * walk-up, four, and narrows to three the moment it learns K-5 is skipped: a
   * patient on the locked route reads "Step 1 of 4" and then "Step 2 of 3". The
   * TOTAL contracts once, where a step is ruled out, and the positions still
   * run 1, 2, 3 with nothing skipped and nothing repeated — which is the defect
   * this file was written for. The alternative, leaving K-2 unnumbered until
   * the route is known, takes the progress chip off the first screen of the
   * ceremony to avoid a number that was true when it was drawn. Named test:
   * `a_walk_up_with_locked_particulars_forecasts_four_at_k2_then_narrows_to_three`.
   */
  particularsLockedAtVerification: boolean;
  /**
   * K-P1 HAS ALREADY BEEN ANSWERED TODAY, so this push will not run it (Carl,
   * 27 September 2026, from a live tablet: *"never goes to step 1"*).
   *
   * THE SERVER DECIDES IT, NOT THE TABLET. `tablet-sessions.service.ts` sends
   * `detailsCheck: 'confirmed_today'` when this PATIENT — not this agreement —
   * already ticked their details at this practice today and disputed nothing.
   * Its ruling of 11 September: the case it exists for is a second agreement
   * for the same visit, and asking twice in one visit is the thing it removes.
   *
   * IT MAKES THE PUSH A TWO-STEP CEREMONY: the particulars, then the pen. Left
   * out of this file, such a push numbers itself as the ordinary three-step
   * push and opens the patient on "Step 2 of 3" with no step one ever shown —
   * the original defect, one number to the left. IGNORED ON A WALK-UP, which
   * has no K-P1 to skip.
   *
   * ONLY ONCE K-P1 IS ACTUALLY BEHIND THE PATIENT. The skip is not certain
   * when the push lands: the agreement is fetched first, and A FAILED FETCH
   * FALLS BACK TO ASKING, leaving the ceremony on K-P1 with all three steps to
   * run (see the skip effect in `Ceremony.tsx`). So the caller passes this as
   * false while the patient is still standing on K-P1, and the chip reads
   * "Step 1 of 3" on the honest fallback path rather than refusing to number a
   * screen the patient can see. Named test:
   * `a_push_whose_details_were_confirmed_earlier_today_runs_two_steps_and_starts_at_one`.
   */
  detailsAlreadyConfirmed?: boolean;
}

const WALK_UP: CeremonySequence = ['verify', 'assignor', 'particulars', 'signature'];
const WALK_UP_LOCKED: CeremonySequence = ['verify', 'particulars', 'signature'];
const PUSHED: CeremonySequence = ['check-details', 'particulars', 'signature'];
/**
 * A PUSH THAT WILL NOT RUN K-P1. Rare from 27 September 2026 — Carl's ruling
 * that the details are confirmed once PER AGREEMENT means a fresh push always
 * asks — but a resumed session whose details are already answered still lands
 * past it, and a route this file has not been told about is the defect
 * returning.
 */
const PUSHED_DETAILS_DONE: CeremonySequence = ['particulars', 'signature'];

/**
 * The steps this route will run.
 *
 * A PUSH IS THE PUSHED ROUTE WHATEVER THE LOCK SAYS. The server validates and
 * locks before any device sees the payload, so the lock is not a fact that
 * distinguishes anything here — and an unlocked agreement arriving on a pushed
 * path is a fault the ceremony hands over on (see the auto-lock effect), never
 * a fourth route with a chip of its own.
 */
export function ceremonySequence(route: CeremonyRoute): CeremonySequence {
  if (route.pushed) return route.detailsAlreadyConfirmed ? PUSHED_DETAILS_DONE : PUSHED;
  return route.particularsLockedAtVerification ? WALK_UP_LOCKED : WALK_UP;
}

/**
 * Where a step sits in a sequence, or `null` if it is not one of its steps.
 *
 * `null` RATHER THAN A GUESS, and the caller draws no chip on it. It is the
 * answer for every screen outside the numbered ceremony, and also for a step
 * that is real but not on THIS route — K-5 on a push, K-2 on a push — because
 * numbering a screen the patient will never see on their route is the same
 * class of lie the literals were.
 *
 * Takes a plain `string` so `Ceremony.tsx` can hand it the whole of its own
 * `Step` union without a cast and without this file having to know the states
 * that have nothing to do with the ceremony.
 */
export function stepNumber(step: string, sequence: CeremonySequence): StepNumber | null {
  const index = sequence.indexOf(step as NumberedStep);
  if (index < 0) return null;
  return { position: index + 1, total: sequence.length };
}
