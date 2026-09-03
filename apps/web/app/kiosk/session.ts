/**
 * KIOSK TRUST IS A STAFF PASSKEY SESSION ON THE DEVICE — Carl, Part 6
 * decision 3. There is no device credential, no enrolment ceremony for the
 * tablet, and no new auth surface to revoke: the kiosk is "a staff session in
 * a big-buttons layout", scoped to the practice of whoever signed in, and a
 * session expiring is a feature. It does NOT use the console's Keycloak
 * session — `/kiosk` is a public route with no sign-in of its own, exactly as
 * the Expo build was.
 *
 * ZERO FOOTPRINT (CLAUDE.md §7; Carl, 3 Sep 2026 — "ensure that nothing gets
 * written to the kiosk/tablet"). This module holds the session IN MEMORY for
 * the life of the tab. It never writes a token to `localStorage`,
 * `sessionStorage`, `indexedDB`, a cookie or a cache — the same rule
 * `apps/web/app/auth.ts` keeps for the console's access token
 * (CONVENTIONS.md §9b), and the root ESLint config now fails the build if any
 * of those names appears anywhere under `app/kiosk/**`.
 *
 * THE DEV STAND-IN, named as one. Until device pairing is built, the practice
 * id comes from `NEXT_PUBLIC_KIOSK_PRACTICE_ID` — precisely the stand-in
 * `apps/core`'s own controllers document for `x-practice-id`, with the same
 * safety property: RLS means a wrong or absent id yields nothing rather than
 * leaking somebody else's waiting room.
 *
 * THE PAIRING ALLOW-LIST IS EMPTY AND DELIBERATE. When pairing lands it will
 * be the ONE value permitted to outlive the tab, and `PERSISTABLE_KEYS` is
 * where it goes — so the test that proves nothing is persisted has a single
 * place to relax rather than being deleted.
 */

/**
 * The only keys the kiosk may ever persist. Empty today: there is no pairing
 * credential yet, so the honest answer is that NOTHING survives the tab.
 * `kiosk_persists_nothing_but_pairing` asserts against this list.
 */
export const PERSISTABLE_KEYS: readonly string[] = [];

export interface StaffSession {
  /** Practice scope. From the token's practice claim once the passkey session lands. */
  readonly practiceId: string;
  /** Attributed on every verification event (`verifiedByStaffId` already exists for this). */
  readonly staffId: string | null;
  /** Bearer token, in memory only, or null while AUTH_ENFORCE is off in dev. */
  readonly accessToken: string | null;
}

/**
 * EACH VARIABLE IS READ STATICALLY, and that is not a style choice. Next
 * substitutes `process.env.NEXT_PUBLIC_FOO` at build time by matching the
 * member expression in the source; a dynamic lookup — `process.env[key]` —
 * matches nothing, so the value is simply `undefined` in the bundle and every
 * request goes out with an empty practice scope. It fails quietly, as a screen
 * that says nobody is waiting.
 */
function orElse(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

let current: StaffSession = {
  practiceId: orElse(process.env.NEXT_PUBLIC_KIOSK_PRACTICE_ID, ''),
  staffId: orElse(process.env.NEXT_PUBLIC_KIOSK_STAFF_ID, '') || null,
  accessToken: null,
};

export function getSession(): StaffSession {
  return current;
}

/** Replaces the session wholesale — a sign-in, or a sign-out to an empty scope. */
export function setSession(next: StaffSession): void {
  current = next;
}

export function coreBaseUrl(): string {
  return orElse(process.env.NEXT_PUBLIC_CORE_URL, 'http://localhost:3001').replace(/\/+$/, '');
}
