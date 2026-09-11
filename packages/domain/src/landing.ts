/**
 * Where a person lands after signing in.
 *
 * WHY THIS IS A RULE AND NOT A LINE IN THE CALLBACK. It decides what somebody
 * sees the moment they arrive, and it has to give the same answer in three
 * places: the OIDC callback, the root page, and any gate that finds itself
 * holding a session it did not expect. Three copies of "where should this
 * person go" drift, and the drift shows up as a practice administrator landing
 * on a developer scaffold — which is exactly what happened.
 *
 * THE ORDER MATTERS AND IS NOT ALPHABETICAL:
 *
 *   1. An explicit destination the person was already heading for. Somebody
 *      who followed a link and was asked to sign in should end up where they
 *      were going, not at a home page.
 *   2. A PRACTICE CLAIM beats a platform role. Somebody who holds both is
 *      acting for a practice in that session — the claim is the narrower,
 *      more specific fact, and the narrower fact should win.
 *   3. A platform role, which has no practice and belongs in the queue.
 *   4. Otherwise the root, which explains itself.
 */

import { safeReturnPath } from './redirect';

export const PLATFORM_ADMIN_ROLE = 'platform_admin';

export interface LandingInput {
  readonly roles?: readonly string[];
  /** The `practice_id` claim. Its presence is what makes somebody a practice user. */
  readonly practiceId?: string | null;
  /**
   * The `practitioner_id` claim. A practitioner carries this INSTEAD of a
   * practice claim — they work at several practices and which ones changes, so
   * there is no single practice to name.
   */
  readonly practitionerId?: string | null;
  /** Where they were heading before being asked to sign in. */
  readonly intended?: string | null;
}

/**
 * A practice user is defined by HOLDING A PRACTICE CLAIM, not by holding a
 * particular role.
 *
 * Roles say what somebody may do; the claim says which practice they are. A
 * `practice_principal` with no claim is an account that has not been scoped
 * yet, and sending it to a practice screen would mean asking it to choose a
 * practice — which is the thing the claim exists to stop.
 */
export function isPracticeUser(input: LandingInput): boolean {
  return typeof input.practiceId === 'string' && input.practiceId.trim().length > 0;
}

export function isPlatformOperator(input: LandingInput): boolean {
  return (input.roles ?? []).includes(PLATFORM_ADMIN_ROLE);
}

/**
 * A practitioner is defined by their own claim, for the same reason a practice
 * user is defined by theirs: the `provider` ROLE says what kind of person they
 * are, and the claim says which person. A `provider` role with no claim is an
 * account nothing has been scoped to, and sending it to a practitioner screen
 * would show it somebody else's — or, more likely, refuse and look broken.
 */
export function isPractitioner(input: LandingInput): boolean {
  return typeof input.practitionerId === 'string' && input.practitionerId.trim().length > 0;
}

export function landingPath(input: LandingInput): string {
  const intended = safeReturnPath(input.intended);
  // `safeReturnPath` answers '/' both for "nothing stored" and for "something
  // stored that we refuse to follow". Either way there is no destination to
  // honour, so fall through to deciding one.
  if (intended !== '/') return intended;

  if (isPracticeUser(input)) return '/practice/setup';
  /*
   * THE ORGANISATION LIST, not the review queue.
   *
   * `/review` is one job an operator does — applications waiting for a decision
   * — and landing there says that queue is the product. It is not. An
   * operator's day starts from a PRACTICE: which one is stuck, whose
   * practitioners need checking against the register, who to act as. The list
   * is also where both doors into a practice are, so it is the only page that
   * leads everywhere else.
   *
   * The review queue has not moved. It is one item in the menu alongside the
   * others, rather than the place everybody is dropped whether or not there is
   * anything in it — and an empty queue as a landing page says "nothing to do"
   * to somebody who came in to do something else.
   */
  if (isPlatformOperator(input)) return '/practice';
  /*
   * Added the day practitioners could first sign in — and it is the same
   * failure this function's own comment describes happening to practice
   * administrators. A practitioner enrolled a passkey, signed in successfully,
   * and landed on the developer scaffold offering practice onboarding they have
   * no business doing. Nothing was broken; nobody had decided where they go.
   *
   * LAST, because the earlier cases are narrower. Somebody who is both a
   * practitioner and runs a practice is one person with two jobs, and the
   * practice hub is the one with work waiting on it.
   */
  if (isPractitioner(input)) return '/practitioner';

  /*
   * SIGNED IN, AND WE CANNOT PLACE THEM.
   *
   * This used to fall through to '/', which is the developer scaffold — a page
   * headed "Scaffold status view" offering practice onboarding and a console
   * for organisations that are not theirs. Alarming in production and useless
   * everywhere: it tells somebody nothing about why they are stuck.
   *
   * `/help` says what we know (who they are), what we do not (what they should
   * see), and how to reach a person. It is a real state — an account created
   * before it was scoped, a claim that failed to map — and it deserves an
   * answer rather than a scaffold.
   *
   * Only reached WITH a session. Somebody not signed in still sees the public
   * landing page, because they have not asked us anything yet.
   */
  return '/help';
}

/**
 * May this person choose which practice they are looking at?
 *
 * ONLY SOMEBODY WITH NO CLAIM. A practice user has exactly one practice and it
 * is written into their token; offering them a list would be offering them
 * other people's practices, and honouring a stored selection would let a
 * client-side value override a server-issued claim.
 */
export function mayChoosePractice(input: LandingInput): boolean {
  return !isPracticeUser(input);
}
