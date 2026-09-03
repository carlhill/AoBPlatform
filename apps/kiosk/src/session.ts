/**
 * KIOSK TRUST IS A STAFF PASSKEY SESSION ON THE DEVICE — Carl, Part 6
 * decision 3. There is no device credential, no enrolment ceremony for the
 * tablet, and no new auth surface to revoke: the kiosk is "a staff session in
 * a big-buttons layout", scoped to the practice of whoever signed in, and a
 * session expiring is a feature.
 *
 * WHAT THIS MODULE IS AND IS NOT. It holds that session IN MEMORY for the life
 * of the process. It never writes a token to storage — not AsyncStorage, not
 * SecureStore, not localStorage on the web build (CONVENTIONS.md §9b, and
 * `apps/web/app/auth.ts` keeps its access token in memory for exactly this
 * reason). It does NOT implement the passkey ceremony: that is an auth flow,
 * auth flows are ask-Carl-first (CLAUDE.md §7), and the MVP's job was the
 * waiting-room ceremony, not a second sign-in surface.
 *
 * THE DEV STAND-IN, named as one. Until the passkey session is wired, the
 * practice id comes from `EXPO_PUBLIC_PRACTICE_ID` — precisely the stand-in
 * `apps/core`'s own controllers document for `x-practice-id`, with the same
 * safety property: RLS means a wrong or absent id yields nothing rather than
 * leaking somebody else's waiting room.
 */

export interface StaffSession {
  /** Practice scope. From the token's practice claim once the passkey session lands. */
  readonly practiceId: string;
  /** Attributed on every verification event (`verifiedByStaffId` already exists for this). */
  readonly staffId: string | null;
  /** Bearer token, in memory only, or null while AUTH_ENFORCE is off in dev. */
  readonly accessToken: string | null;
}

/**
 * EACH VARIABLE IS READ STATICALLY, and that is not a style choice.
 *
 * Expo's Babel transform substitutes `process.env.EXPO_PUBLIC_FOO` at build
 * time by matching the member expression in the source. A dynamic lookup —
 * `process.env[key]` — matches nothing, so the value is simply `undefined` in
 * the bundle and every request goes out with an empty practice scope. It fails
 * quietly, as a screen that says nobody is waiting.
 */
function orElse(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

let current: StaffSession = {
  practiceId: orElse(process.env.EXPO_PUBLIC_PRACTICE_ID, ''),
  staffId: orElse(process.env.EXPO_PUBLIC_STAFF_ID, '') || null,
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
  return orElse(process.env.EXPO_PUBLIC_CORE_URL, 'http://localhost:3001').replace(/\/+$/, '');
}
