/**
 * WHAT THE TABLET IS, AND WHAT IT IS NOT.
 *
 * IT IS A PAIRED DEVICE (3 Sep 2026, and this reverses Part 6 decision 3).
 * The kiosk used to be described as "a staff passkey session in a big-buttons
 * layout", scoped by a build-time `NEXT_PUBLIC_KIOSK_PRACTICE_ID`. That is
 * gone, because it meant a public URL took its practice scope from whatever
 * the caller sent: anybody who reached `/kiosk` saw a practice's waiting list,
 * which is a list of patient names. Scope now comes from ONE opaque device
 * credential the server issued (`pairing.ts`), and the server resolves the
 * practice from it — the tablet asserts nothing.
 *
 * PAIRING IS NOT A LOGIN. There is no Keycloak session here and there could
 * not be: a tablet has no person to authenticate as. Hard rule 15 —
 * practitioner and admin auth is WebAuthn passkeys, no password-only paths —
 * concerns people, and is untouched.
 *
 * ZERO FOOTPRINT (CLAUDE.md §7). Everything in THIS module is in memory for
 * the life of the tab and is never written anywhere. The single exception in
 * the whole kiosk is the pairing credential, which lives in `pairing.ts` with
 * its own scoped lint exception and its own named test.
 */

// Re-exported so the allow-list has one name across the kiosk while the
// read/write that uses it stays in the single module the lint rule excepts.
export { PAIRING_CREDENTIAL_KEY, PERSISTABLE_KEYS } from './pairing';

export interface StaffSession {
  /**
   * Attributed on every verification event (`verifiedByStaffId`).
   *
   * STILL A DEV STAND-IN, and named as one. The in-practice verification is
   * performed by a staff member at the desk (REQ-VER-03) and the push model
   * will carry that identity with the payload; until it does, this is the
   * environment's stand-in and is optional. It is NOT the practice scope —
   * that question is settled by the device.
   */
  readonly staffId: string | null;
  /** Bearer token, in memory only. Null on a tablet, which has no session. */
  readonly accessToken: string | null;
}

/**
 * EACH VARIABLE IS READ STATICALLY, and that is not a style choice. Next
 * substitutes `process.env.NEXT_PUBLIC_FOO` at build time by matching the
 * member expression in the source; a dynamic lookup — `process.env[key]` —
 * matches nothing, so the value is simply `undefined` in the bundle. It fails
 * quietly, which is the worst way for a configuration value to fail.
 */
function orElse(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

let current: StaffSession = {
  staffId: orElse(process.env.NEXT_PUBLIC_KIOSK_STAFF_ID, '') || null,
  accessToken: null,
};

export function getSession(): StaffSession {
  return current;
}

/** Replaces the session wholesale. Writes nothing, anywhere. */
export function setSession(next: StaffSession): void {
  current = next;
}

export function coreBaseUrl(): string {
  return orElse(process.env.NEXT_PUBLIC_CORE_URL, 'http://localhost:3001').replace(/\/+$/, '');
}

/**
 * WHICH BUILD THIS TAB IS RUNNING — the rollback mechanism, not a vanity
 * string (TODO.md "Zero-footprint kiosk": "a version banner support can read,
 * and a forced-reload signal so a rollback reaches every open tab").
 *
 * It rides on every kiosk request as `x-kiosk-build`. The server compares it
 * with the practice's floor and answers `reload: true` when this tab is below
 * it; the tab then hard-reloads onto whatever the cloud is serving. Without
 * it, a bad release is fixed by visiting a thousand devices, which is the
 * expense the whole decision exists to avoid.
 *
 * `dev` IS AN HONEST DEFAULT and is deliberately the lowest thing the
 * comparison can see: a developer's tab is always "stale" the moment a
 * practice sets a floor, which is right — it is not a build anybody rolled
 * out. CI sets `NEXT_PUBLIC_BUILD_ID` to the date-ordered release id.
 */
export function kioskBuildId(): string {
  return orElse(process.env.NEXT_PUBLIC_BUILD_ID, 'dev');
}
