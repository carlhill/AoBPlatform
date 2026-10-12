/**
 * How an account is NAMED, in one place, because three services build
 * usernames and a fourth reads them back.
 *
 * PRACTICE-SCOPED-LOGIN.md section 3a settles two shapes and no others:
 *
 *   admin.<code>            the PRACTICE's own account (ROLES.md rule 3 --
 *                           pointed at a shared mailbox on purpose, so a
 *                           departure does not lock the practice out). It has
 *                           no email in its name because it is not a person.
 *   <full email>.<code>     a PERSON, at one practice.
 *
 * The full email is already unique to the person and the code to the practice,
 * so the person shape is unique BY CONSTRUCTION -- no second collision rule,
 * no `jsmith2`, and nothing here has to look at what already exists.
 *
 * A THIRD SHAPE EXISTS AND IS DELIBERATELY NOT HERE. The cross-practice
 * practitioner account (`/practitioner`, PRACTITIONER-IDENTITY.md section 3)
 * is the bare email with NO code, because it is scoped to a person rather than
 * to a practice -- a code on it would name a practice the account is not for.
 * `practitioner-access.service.ts` builds that one and is the only thing that
 * may.
 *
 * A USERNAME IS NEVER RECOMPUTED FOR AN ACCOUNT THAT EXISTS. A passkey is
 * bound to the username; changing one orphans the credential and locks a real
 * person out (section 3 property 2, section 8). Everything in this module
 * builds names for accounts being created for the FIRST time. The
 * grandfathering itself lives at the call sites, where the existing account id
 * is known.
 */

/**
 * 24 characters (section 3b rule 3). Long enough to stay recognisable, short
 * enough that `<email>.<code>` does not run away. The longest practice name in
 * the dev data is 30 characters, so it bites rarely.
 */
export const PRACTICE_CODE_MAX_LENGTH = 24;

/**
 * Under three characters is not a code anybody would recognise -- a practice
 * named in a non-Latin script strips to nothing -- so section 3b rule 4 falls
 * back to a GENERATED code rather than a mangled one, and marks it generated.
 */
export const PRACTICE_CODE_MIN_LENGTH = 3;

/**
 * What a code may contain once allocated.
 *
 * SAID TWICE, ON PURPOSE, AND THE SECOND PLACE IS NAMED HERE: the identical
 * pattern is the `practices_code_shape_check` CHECK in
 * `apps/core/prisma/migrations/20260912030000_practice_code/migration.sql`.
 * A code goes inside an account key that can never be changed afterwards, so
 * it is worth refusing a malformed one at the first point AND the last. Change
 * one of these and you must change the other in the same commit; the e2e in
 * `apps/core/test/practice-code.e2e-spec.ts` fails when they disagree.
 */
export const PRACTICE_CODE_PATTERN = /^[a-z0-9]{3,}$/;

/**
 * A generated code is `p` then twelve hex characters, and it starts with a
 * letter so it can never be mistaken for a truncated ABN or a row number.
 * The migration's SQL fallback produces the same shape.
 */
export const GENERATED_PRACTICE_CODE_PATTERN = /^p[0-9a-f]{12}$/;

/**
 * THE NAME A CODE IS PROPOSED FROM: the trading name where there is one, else
 * the practice name, NEVER the legal name (section 3b rule 1).
 *
 * XLEVELUP Medical trades as `XLEVELUP`; its legal name is "The trustee for
 * Hillsempire Family Trust", which nobody would recognise and which changes
 * for reasons that have nothing to do with the practice. The parameter type is
 * the enforcement: there is nowhere to pass a legal name in.
 */
export interface PracticeNaming {
  /** Registered business names from the ABR. The first non-blank is preferred. */
  tradingNames?: readonly string[] | null;
  /** What the practice calls itself. Used when there is no trading name. */
  name: string;
}

/** The trading name if there is one, else the practice name. Never the legal name. */
export function practiceNameForCode(practice: PracticeNaming): string {
  const trading = (practice.tradingNames ?? []).map((n) => (n ?? '').trim()).find((n) => n.length > 0);
  return trading ?? (practice.name ?? '').trim();
}

/**
 * THE SLUG (section 3b rules 1-3). `Powell St. Practice` -> `powellstpractice`;
 * `O'Brien & Sons Medical` -> `obriensonsmedical`.
 *
 * Lower case, then drop everything that is not a-z or 0-9 -- spaces, full
 * stops, apostrophes, ampersands and hyphens all disappear -- then truncate to
 * 24. Nothing is transliterated: an accented letter is dropped like any other
 * character outside the set, which is what makes a non-Latin name fall to the
 * generated path rather than to a mangled one.
 *
 * Returns NULL when the result is unusable (section 3b rule 4), because "no
 * slug" is an answer the caller must handle rather than a short string it
 * might store.
 */
export function proposePracticeCode(practice: PracticeNaming): string | null {
  const slug = practiceNameForCode(practice)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, PRACTICE_CODE_MAX_LENGTH);
  return slug.length >= PRACTICE_CODE_MIN_LENGTH ? slug : null;
}

/**
 * ON COLLISION, EXTEND DETERMINISTICALLY (section 3b rule 5, section 5 rule 3):
 * `xlevelup`, then `xlevelup2`, `xlevelup3`. Predictable beats random.
 *
 * `attempt` is 1-based, so the first attempt is the bare slug. The suffix is
 * allowed to carry the code past 24 characters: the truncation is a rule about
 * the SLUG, and silently truncating the discriminator away would hand two
 * practices the same candidate for ever.
 */
export function extendPracticeCode(base: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${attempt}`);
  }
  return attempt === 1 ? base : `${base}${attempt}`;
}

/**
 * The fallback of section 3b rule 4. `randomHex` is injected so a test can pin
 * it; production passes node's crypto.
 */
export function generatePracticeCode(randomHex: (bytes: number) => string): string {
  return `p${randomHex(6)}`;
}

/** True for a code this platform generated rather than read off a name. */
export function isGeneratedPracticeCode(code: string): boolean {
  return GENERATED_PRACTICE_CODE_PATTERN.test(code);
}

export class AccountNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountNameError';
  }
}

/**
 * A code is checked at every use, not only at allocation. It ends up inside an
 * account key that can never be changed afterwards, so a malformed one is
 * worth refusing loudly at the moment it would be baked in.
 */
export function assertPracticeCode(code: string): void {
  if (!PRACTICE_CODE_PATTERN.test(code)) {
    throw new AccountNameError(
      `"${code}" is not a practice code. A code is at least three characters of a-z and 0-9 and nothing else ` +
        '(PRACTICE-SCOPED-LOGIN.md section 3b). It is allocated once and stored; never derive one here.',
    );
  }
}

/**
 * THE PRACTICE'S OWN ACCOUNT. No email, no person's name, no practice id --
 * `admin.xlevelup`.
 *
 * Naming it after whoever set it up is the mistake the shared-mailbox rule
 * exists to prevent (section 3a). What belongs to a person is their passkey;
 * what belongs to the practice is the account.
 */
export function adminUsername(code: string): string {
  assertPracticeCode(code);
  return `admin.${code}`;
}

/**
 * A PERSON, AT ONE PRACTICE -- `audrey@hillsempire.com.xlevelup`. The WHOLE
 * email, unchanged, then a dot, then the code (section 3).
 *
 * The email is not lower-cased or otherwise normalised: it is the person's own
 * address and mangling it to satisfy a naming rule is how an account key stops
 * matching the human who holds it. Keycloak folds usernames to lower case
 * itself and its lookups are case-insensitive, so nothing here needs to.
 */
export function personUsername(email: string, code: string): string {
  const address = (email ?? '').trim();
  if (!address.includes('@') || /\s/.test(address)) {
    throw new AccountNameError(
      'A person’s account is named for their email address, and this is not one. Without an address there ' +
        'is no name for the account and nowhere to send the enrolment link (PRACTICE-SCOPED-LOGIN.md 3a).',
    );
  }
  assertPracticeCode(code);
  return `${address}.${code}`;
}

/**
 * WHAT A PERSON READS AT THE PASSKEY PICKER (section 3c) -- and it leads with
 * the practice, because that is the part that distinguishes it.
 *
 * `audrey@hillsempire.com.powellstpractice` is 38 characters and the
 * distinguishing part is LAST, exactly where a browser's chooser truncates.
 * Audrey at two practices would be offered two entries reading identically for
 * their first thirty characters. So the label puts the practice first and the
 * person second.
 *
 * KEYCLOAK 26 DOES NOT CARRY THIS TO THE CHOOSER YET, and the finding belongs
 * beside the builder rather than in a document nobody opens.
 * `WebAuthnRegister` hands the template the account's USERNAME and Keycloak's
 * own `webauthnRegister.js` sets BOTH `user.name` and `user.displayName` from
 * it (read out of the running 26.0.8 container, 12 Sep 2026;
 * infra/keycloak/README.md "Passkeys have TWO names" says the same from the
 * other end). There is no separate display-name field to set, and forking
 * Keycloak's registration script is refused by design -- login-theme.test.mjs
 * asserts the stock import.
 *
 * So this is stored on the account as a `display_name` attribute: read by the
 * admin console, carried with the account, and the exact value a theme-level
 * change would pass. The rule is decided and recorded; the day it can reach
 * the chooser nothing has to be worked out again.
 */
export function webAuthnDisplayName(practiceLabel: string, personLabel: string): string {
  const practice = (practiceLabel ?? '').trim();
  const person = (personLabel ?? '').trim();
  if (!practice) return person;
  if (!person) return practice;
  return `${practice} — ${person}`;
}

/**
 * The practice's half of that label. The practice's OWN name reads better here
 * than the code: `XLEVELUP Medical`, not `xlevelup`. The trading name is
 * preferred for the same reason it is preferred for the code -- it is what
 * anybody at the practice would recognise.
 */
export function practiceDisplayLabel(practice: PracticeNaming): string {
  return practiceNameForCode(practice) || practice.name;
}
