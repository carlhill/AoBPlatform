import { SetMetadata } from '@nestjs/common';

/** Metadata key the guard reads to find out whether this route is gated. */
export const FRESH_SECOND_FACTOR = 'aob:fresh-second-factor';

/**
 * A FRESH SECOND FACTOR BEFORE THIS ACT, not only at sign-in
 * (AUTH-TIERS.md §5.2, D-2026-09-12-11).
 *
 * WHY IT EXISTS. Tier 2 answered the shared-terminal problem by making the
 * sign-in device-independent — and in doing so accepted that a session lives
 * on a machine in a room the person may have walked out of. A four-hour idle
 * timeout is right for reading a waiting list and wrong for revoking a
 * credential, so the acts that cannot be undone ask again.
 *
 * WHAT "FRESH" MEANS. The session presented something beyond a password
 * (`carriesSecondFactor`) and did so within the window — judged on the token's
 * `auth_time`, which a silent refresh does not move. Five minutes by default;
 * an act may ask for less by passing its own.
 *
 * APPLIED SPARINGLY, AND THAT IS DELIBERATE. Sweeping it across every endpoint
 * would train people to re-authenticate reflexively, which is the behaviour a
 * real-time phishing attack needs. It belongs on acts that destroy access:
 * revoking a device or a credential is the worked example (devices.controller).
 *
 * STAGED LIKE EVERY OTHER GUARD IN THIS DIRECTORY. While `AUTH_ENFORCE` is
 * false a request with NO principal still passes — the console has surfaces
 * whose sign-in does not exist yet, and enforcing early would take them down.
 * A request that DOES carry a session is judged either way: "no token" is an
 * unfinished deployment, "a stale token" is an answer.
 */
export const RequireFreshSecondFactor = (maxAgeSeconds?: number) =>
  SetMetadata(FRESH_SECOND_FACTOR, { maxAgeSeconds: maxAgeSeconds ?? null });

/** What the decorator stored: null means the domain's default window. */
export interface FreshSecondFactorRequirement {
  maxAgeSeconds: number | null;
}
