/* eslint-disable no-restricted-syntax --
 *
 * THE ONE SANCTIONED EXCEPTION TO THE ZERO-FOOTPRINT RULE, and the disable is
 * scoped to this file on purpose so the rule still bites in every other file
 * under `app/kiosk/**`.
 *
 * CLAUDE.md §7 (Carl, 3 Sep 2026): "nothing gets written to the kiosk/tablet
 * ... the one exception is a single opaque pairing credential, revocable from
 * the console." That sentence is this module. The root ESLint config's own
 * comment predicted it — "when pairing lands it gets exactly one key, listed
 * in `PERSISTABLE_KEYS`, and this rule gains one narrow exception for the
 * module that owns it — not a blanket relaxation."
 *
 * ONE RULE, NOT TWO. Every access below goes through `window.localStorage`
 * rather than the bare global, so only `no-restricted-syntax` has anything to
 * say here and `no-restricted-globals` stays armed in this file too. The
 * explicit `window.` is not incidental: it is what makes the one permitted
 * write impossible to mistake for an ambient one while reading.
 */

/**
 * THE PAIRING CREDENTIAL, AND NOTHING ELSE.
 *
 * WHAT IS STORED. One opaque string, under one key. Not the practice id, not
 * the practice name, not the device label, not a patient, not a draft, not the
 * step somebody was on. Everything else the tablet knows it asks the server
 * for on every load (`GET /kiosk/me`) and forgets when the tab closes — which
 * is what makes a tablet found in a taxi worth nothing to whoever found it,
 * and what makes "revoke it from the console" a complete answer rather than a
 * partial one.
 *
 * WHY IT MUST OUTLIVE THE TAB, when nothing else may. A tablet in a waiting
 * room reboots, sleeps, gets its browser closed by a patient and is turned on
 * again by whoever opens up. If the credential died with the tab, somebody
 * would be re-pairing devices every morning — and a practice that has to pair
 * a tablet every morning is a practice that writes the code on a sticky note.
 * Persisting exactly one revocable secret is the smaller risk by a wide
 * margin.
 *
 * WHY `localStorage` AND NOT A COOKIE. A cookie rides on every request to the
 * origin, including ones this app never makes, and it is the thing a
 * misconfigured proxy or an analytics script picks up by accident. This value
 * is read deliberately, by one module, and put in one header.
 *
 * EVERY ACCESS IS WRAPPED. Private browsing, a locked-down kiosk profile and a
 * quota failure all throw on `localStorage` rather than returning null, and a
 * tablet that white-screens because storage was disabled is a tablet somebody
 * has to visit — the exact failure the zero-footprint rule exists to prevent.
 * An unreadable store means "not paired", which is a screen with a way
 * forward.
 */

/**
 * The only key the kiosk may ever persist. It is namespaced so that a practice
 * running this on a shared browser profile cannot collide with anything else,
 * and it is boring on purpose — a key nobody would think worth reading.
 */
export const PAIRING_CREDENTIAL_KEY = 'aob.kiosk.pairing';

/**
 * THE ALLOW-LIST. `kiosk_persists_nothing_but_pairing` asserts that this has
 * exactly one entry and that it is the credential — so a second key cannot be
 * added without changing a test whose name says what it is protecting.
 */
export const PERSISTABLE_KEYS: readonly string[] = [PAIRING_CREDENTIAL_KEY];

/** True where a browser store exists at all. False during SSR and in a test with no DOM. */
function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The credential this tablet holds, or null if it holds none. */
export function readPairingCredential(): string | null {
  try {
    const value = store()?.getItem(PAIRING_CREDENTIAL_KEY) ?? null;
    return value && value.length > 0 ? value : null;
  } catch {
    // Storage exists and refused. Unpaired is the honest answer, and it is a
    // screen with a way forward rather than a blank tablet.
    return null;
  }
}

/**
 * Remember the credential this tablet was just given.
 *
 * IT RETURNS WHETHER IT WORKED, and the caller shows that. A tablet whose
 * browser cannot persist will pair, work for the life of the tab, and need
 * pairing again after a reboot — which is worth saying on the screen rather
 * than discovering on a Monday morning.
 */
export function writePairingCredential(credential: string): boolean {
  try {
    store()?.setItem(PAIRING_CREDENTIAL_KEY, credential);
    return readPairingCredential() === credential;
  } catch {
    return false;
  }
}

/**
 * Forget it — on a 401, which is what a revoked or rotated device gets.
 *
 * THIS IS NOT AN UN-PAIR CONTROL. There is deliberately none on the device: a
 * tablet that can un-pair itself is a tablet a passer-by can un-pair. This
 * runs only when the SERVER has already said the credential is dead, and its
 * job is to stop a paired-looking tablet retrying a credential that will never
 * work again (TODO.md — "no retry loop hammering the server").
 */
export function clearPairingCredential(): void {
  try {
    store()?.removeItem(PAIRING_CREDENTIAL_KEY);
  } catch {
    /* Nothing to do, and nothing worth telling a patient about. */
  }
}
