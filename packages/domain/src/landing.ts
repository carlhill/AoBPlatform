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

export function landingPath(input: LandingInput): string {
  const intended = safeReturnPath(input.intended);
  // `safeReturnPath` answers '/' both for "nothing stored" and for "something
  // stored that we refuse to follow". Either way there is no destination to
  // honour, so fall through to deciding one.
  if (intended !== '/') return intended;

  if (isPracticeUser(input)) return '/practice/setup';
  if (isPlatformOperator(input)) return '/review';
  return '/';
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
