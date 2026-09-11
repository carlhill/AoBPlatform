/**
 * DEVICE PAIRING — the one credential the zero-footprint rule allows on a
 * tablet (CLAUDE.md §7; TODO.md "Zero-footprint kiosk").
 *
 * WHY IT EXISTS AT ALL. `/kiosk` is a public route, and until now its practice
 * scope came from a build-time environment variable: anybody who reached the
 * URL saw that practice's waiting room, which is a list of patient names. A
 * page that cannot be deployed anywhere reachable is not a product, and the
 * fix is not a login — a tablet in a waiting room has no person to sign in as,
 * and a shared staff password on a device a hundred strangers touch in a
 * morning would be worse than the hole it closed.
 *
 * SO: A PAYMENT TERMINAL PAIRED TO A MERCHANT, literally (Carl, 3 Sep 2026).
 * The console registers a device for a practice and shows a short-lived code;
 * somebody types that code into the tablet once; the server exchanges it for
 * an opaque credential the device keeps. Every request afterwards carries the
 * credential and the SERVER resolves the practice from it — the tablet no
 * longer asserts a practice at all.
 *
 * WHAT IS IN THIS FILE AND WHAT IS NOT. The shapes and the rules that both
 * halves of the product must agree on: the code alphabet and length, its
 * lifetime, and the build comparison behind the forced reload. The secrets
 * themselves — minting, hashing, storing — are `apps/core`'s, because a
 * package that is imported by the browser bundle must never be the place a
 * credential is made.
 *
 * THREAT MODEL, in one line: a stolen tablet holds ONE revocable credential
 * and nothing else — no practice name, no patient data, no identifier value —
 * and revoking it from the console closes it on the device's next request.
 */

import type { KioskScreen } from './kiosk';

/**
 * THE PAIRING-CODE ALPHABET, and every omission is deliberate.
 *
 * No `I`, `L`, `O`, `U`, `0` or `1`. The first four are read wrong off a
 * screen by somebody standing at a desk; the digits are the pairs they are
 * read wrong AS. `U` goes because it is the one letter that turns a random
 * eight-character string into a word often enough to matter on a screen a
 * patient might see over somebody's shoulder.
 *
 * Thirty characters, eight of them: 6.5 × 10^11 codes, live for ten minutes,
 * single-use, and rate-limited. Guessing is not the attack to worry about.
 */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export const PAIRING_CODE_LENGTH = 8;

/**
 * TEN MINUTES, which is the number Carl gave and is the right shape of number:
 * long enough to walk a code from the console to the tablet across a practice,
 * short enough that a code left on a screen at lunchtime is dead by the
 * afternoon. It is not a session — the credential it produces has no expiry,
 * because a tablet that logs itself out overnight is a tablet somebody has to
 * visit in the morning.
 */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** A label a human chose, for a list a human reads. "Reception tablet 1". */
export const DEVICE_LABEL_MAX_LENGTH = 60;

/**
 * How the code is SHOWN — grouped in fours, because eight unbroken characters
 * is where people lose their place. The stored form is ungrouped; the hyphen
 * is presentation and `normalisePairingCode` throws it away again.
 */
export function formatPairingCode(code: string): string {
  const clean = normalisePairingCode(code);
  if (clean.length !== PAIRING_CODE_LENGTH) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/**
 * What the tablet typed, reduced to what the server stored.
 *
 * UPPERCASED AND STRIPPED, never "corrected". A tempting extra step is to map
 * the confusable characters back — `0` to `O`, `1` to `I` — but `O` and `I`
 * are not IN the alphabet, so the mapping would have to invent a character
 * that cannot appear in a real code. Anything outside the alphabet is dropped,
 * the length check then fails, and the screen asks for the code again. A
 * wrong code must look wrong.
 */
export function normalisePairingCode(input: string): string {
  const upper = input.toUpperCase();
  let out = '';
  for (const ch of upper) if (PAIRING_CODE_ALPHABET.includes(ch)) out += ch;
  return out;
}

/** Shape only — whether it is a LIVE code is the server's question, not this one. */
export function isPairingCodeShape(input: string): boolean {
  return normalisePairingCode(input).length === PAIRING_CODE_LENGTH;
}

/**
 * THE FORCED RELOAD — the other half of the zero-footprint bargain.
 *
 * The rule the kiosk decision rests on is "a bad release is fixed by a deploy
 * and a rollback, never by visiting a device". That is only true if a rollback
 * actually REACHES a tablet that has been sitting on the same open tab since
 * eight in the morning. So the kiosk sends the build it is running on every
 * poll, and the server answers `reload: true` when the practice has been moved
 * to a newer floor.
 *
 * BUILD IDS ARE ORDERED STRINGS, date-first — `2026.09.03-2`. Comparison is
 * lexicographic, which is correct for that shape and is the reason the shape
 * is fixed rather than free. A tablet that reports NO build at all is stale by
 * definition once a floor is set: an unknown build cannot be shown to be new
 * enough, and the cost of being wrong is one reload.
 *
 * NO FLOOR MEANS NO RELOAD. The absence of a setting is not a reason to
 * restart every tablet in the country.
 */
export function kioskBuildIsStale(current: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!minimum) return false;
  if (!current) return true;
  return current < minimum;
}

/** A device as the console lists it. No credential, ever — not even its hash. */
export interface DeviceRow {
  id: string;
  label: string;
  /** Paired, waiting for a code, or revoked. Derived, never stored as a fourth truth. */
  state: DeviceState;
  createdBy: string;
  createdAt: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  /** What the tablet last said it was running, for support to read back. */
  lastKioskBuild: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  /** When the outstanding pairing code dies. Null once paired or once it has. */
  pairingExpiresAt: string | null;
  /**
   * A TEST DEVICE, AND THE ONLY THING THAT SHOWS THE WAITING LIST (Carl, 4 Sep
   * 2026 — "the list page is only for testing purposes").
   *
   * The walk-up tablet must never display other patients' names: Begin goes
   * straight to "Confirm your details" and the SERVER finds the one waiting
   * row that matches what was typed. The list of names survives only behind
   * this flag, set from the CONSOLE — never a tick-box on the tablet, because
   * a device that can turn its own disclosure on is a device a passer-by can
   * turn it on from.
   *
   * Default false, and it stays false on every device a practice actually
   * uses.
   */
  showsWaitingList: boolean;

  /* ------------------------------------------------------------------ *
   * WHERE THE TABLET IS RIGHT NOW — from the heartbeat (Carl, 4–5 Sep
   * 2026). Every field below is OPTIONAL ON THE WIRE and absent from an
   * older server, which the console renders as "not seen" rather than as a
   * blank line. None of them is patient data: a screen NAME, an opaque
   * session id, and a timestamp (REQ-VER-04, hard rule 9).
   * ------------------------------------------------------------------ */

  /** One of `KIOSK_SCREENS`. Never a heading, never a value. */
  currentScreen?: KioskScreen | null;
  /**
   * THE OPAQUE PUSHED-SESSION ID, AND NO NAME BESIDE IT (Carl, 5 Sep 2026).
   * Reception matches the eight characters to the tablet row they already have
   * on screen; looking a patient up to decorate a device row would put a name
   * on a monitor for no gain, since the name is already on the session row.
   */
  currentSessionId?: string | null;
  /**
   * THE SERVER'S ANSWER, NOT THE CONSOLE'S GUESS. More than two poll intervals
   * since the last heartbeat. The cadence is the server's (`kioskPollMs`), so
   * a console that guessed it would be a second place for it to be wrong.
   */
  stale?: boolean;
  /** Taken out of use by reception. The credential is untouched. */
  outOfUse?: boolean;
  outOfUseAt?: string | null;
  outOfUseBy?: string | null;
}

/**
 * `inactive` IS RECEPTION'S SWITCH; `revoked` IS THE ADMINISTRATOR'S (Carl,
 * 4–5 Sep 2026, TODO.md "Tablets: make one inactive").
 *
 * A flat battery, a tablet gone for repair, a tablet on the wrong desk: none
 * of those is a security event and none of them should cost a credential.
 * `inactive` refuses pushes and shows a quiet "not in use" screen; the tablet
 * keeps heartbeating, so it is still on the console and one press puts it
 * back. `revoked` throws the credential away and needs a rotate and somebody
 * re-typing a code at the device.
 */
export const DEVICE_STATES = ['awaiting_pairing', 'paired', 'inactive', 'revoked'] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

/**
 * TWO MISSED HEARTBEATS AND THE ROW SAYS SO. Not one: a single dropped poll is
 * a network blip on a practice's wifi, and a console that cried "not seen" at
 * every blip would teach reception to ignore the line that matters.
 */
export const DEVICE_STALE_AFTER_POLLS = 2;

/**
 * Has this tablet missed two heartbeats? Answered against the cadence the
 * SERVER is currently handing out, so a busy practice (2 s) and a quiet one
 * (15 s) get the same "two intervals" rule rather than the same number of
 * seconds. Never seen at all is stale by definition.
 */
export function deviceHeartbeatIsStale(
  lastSeenAt: Date | string | null | undefined,
  pollMs: number,
  now: Date = new Date(),
): boolean {
  if (!lastSeenAt) return true;
  const at = typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : lastSeenAt.getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > DEVICE_STALE_AFTER_POLLS * pollMs;
}

/**
 * The one place the four states are decided, so the console and the server
 * cannot disagree about what a row IS.
 *
 * REVOKED WINS OVER EVERYTHING. A revoked device with a live pairing code is
 * still revoked — rotate is the act that gives it a new code, and rotate
 * clears the revocation deliberately rather than as a side effect of the row
 * happening to have a code on it.
 *
 * OUT OF USE IS ASKED AFTER PAIRING, not before it. A device that has never
 * been paired and is also flagged out of use reads `awaiting_pairing`, because
 * the thing a person needs to do to it is type a code in — telling them it is
 * "not in use" would hide the one action the row has.
 */
export function deviceState(input: {
  revokedAt: Date | string | null;
  pairedAt: Date | string | null;
  outOfUseAt?: Date | string | null;
}): DeviceState {
  if (input.revokedAt) return 'revoked';
  if (!input.pairedAt) return 'awaiting_pairing';
  if (input.outOfUseAt) return 'inactive';
  return 'paired';
}
