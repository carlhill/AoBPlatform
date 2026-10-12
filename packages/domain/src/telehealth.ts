/**
 * THE STEP BEFORE A TELEHEALTH CONSULTATION (TELEHEALTH-PLAN.md §3–§4, §8 step 2;
 * D-2026-10-11-07 and -08).
 *
 * A RECORD THAT THE IDENTIFIED PATIENT (OR CARER) AGREED TO A TELEHEALTH
 * CONSULTATION WITH THIS PROVIDER. It is NOT an assignment of benefit and NOT a
 * pre-agreement (decision 1). The DB4 after the consultation stays the one
 * agreement, so this module knows nothing about agreements, items or money.
 *
 * WHAT LIVES HERE. The pieces both core and the console read, so they cannot
 * drift: the session states and the moves between them, the identity
 * checklist (the approved six, never the Medicare number), the versioned
 * thresholds and consent statement (`content/telehealth.json`) and the "not
 * done" reasons (`content/telehealth-not-done-reasons.json`).
 *
 * HAND-WRITTEN VALIDATION, NOT ZOD, for the reason `assignor-relationships.ts`
 * gives: this package has zero runtime dependencies. Both files are validated
 * at module load, so a bad edit fails the build and the test run, not a call.
 */
import content from '../content/telehealth.json';
import reasonsContent from '../content/telehealth-not-done-reasons.json';
import { APPROVED_IDENTIFIER_TYPES, type ApprovedIdentifierType } from './identifiers';

/* -------------------------------------------------------------------------
 * States
 * ---------------------------------------------------------------------- */

/**
 * WHERE A SESSION HAS GOT TO.
 *
 * - `opened`: the provider checked identity on the call and sent the link.
 * - `code_checked`: somebody opened the link and typed the code the provider
 *   read out.
 * - `agreed`: they pressed the one button.
 * - `not_done`: the provider recorded the step as not done, with a reason, and
 *   the consultation went ahead (hard rule 8; §4).
 * - `went_ahead`: after the patient agreed, the provider recorded the consultation as complete (Carl,
 *   D-2026-10-12-03 item 6).
 * - `did_not_proceed`: the consultation did not happen (scenario C2, not yet
 *   ruled; the state exists so the model can hold it).
 *
 * STEP 3 SLOTS IN AFTER `agreed` / `not_done`: `db4_matched`, `db4_sent` and
 * `db4_signed` (TELEHEALTH-PLAN.md §6 item 2). They are deliberately not listed
 * yet — a state nothing can reach is a state a screen will one day render — and
 * adding them is a change to this list, `TELEHEALTH_SESSION_MOVES` and the
 * migration's CHECK, which is copied from here.
 */
export const TELEHEALTH_SESSION_STATES = ['opened', 'code_checked', 'agreed', 'not_done', 'did_not_proceed', 'went_ahead'] as const;
export type TelehealthSessionState = (typeof TELEHEALTH_SESSION_STATES)[number];

/**
 * THE MOVES, AND ONLY THESE. `not_done` and `did_not_proceed` are open from
 * every state before an outcome, because the provider decides and the
 * consultation never waits (hard rule 8). Nothing leaves `agreed`, `not_done`
 * or `did_not_proceed` in step 2 except `agreed` → `did_not_proceed` (the call
 * dropped after the patient agreed, C2). Step 3 adds the DB4 states after
 * `agreed` and `not_done`.
 */
export const TELEHEALTH_SESSION_MOVES: Readonly<Record<TelehealthSessionState, readonly TelehealthSessionState[]>> = {
  opened: ['code_checked', 'not_done', 'did_not_proceed'],
  code_checked: ['agreed', 'not_done', 'did_not_proceed'],
  agreed: ['went_ahead', 'did_not_proceed'],
  not_done: [],
  did_not_proceed: [],
  went_ahead: [],
};

export function isTelehealthSessionState(value: unknown): value is TelehealthSessionState {
  return typeof value === 'string' && (TELEHEALTH_SESSION_STATES as readonly string[]).includes(value);
}

/** True only for a move the table lists. A same-state "move" is not a move. */
export function mayMoveTelehealthSession(from: TelehealthSessionState, to: TelehealthSessionState): boolean {
  return TELEHEALTH_SESSION_MOVES[from].includes(to);
}

/** States in which the patient's page is still live and a fresh link may be sent. */
export const TELEHEALTH_LINK_STATES: readonly TelehealthSessionState[] = ['opened', 'code_checked', 'agreed'];

/* -------------------------------------------------------------------------
 * The identity checklist
 * ---------------------------------------------------------------------- */

/**
 * WHAT THE PROVIDER TICKS ON THE CALL: identifier TYPES, from the approved six,
 * never values (hard rules 1 and 9; REQ-VER-02/-04).
 *
 * IT IS THE APPROVED SET ITSELF, NOT A SECOND LIST. The Medicare card number
 * is not an identity identifier and is not on it, and because this is the
 * domain's own constant there is no copy anywhere that somebody could add it
 * to. Mobile and email are absent for the reason `recordStaffVerified` gives:
 * they are contact details, and counting them would be the Medicare mistake one
 * step sideways.
 */
export const TELEHEALTH_IDENTITY_CHECKLIST: readonly ApprovedIdentifierType[] = APPROVED_IDENTIFIER_TYPES;

/** How the link goes. The contact is ALWAYS the one on the record (D-2026-09-11-03). */
export const TELEHEALTH_CHANNELS = ['sms', 'email', 'both'] as const;
export type TelehealthChannel = (typeof TELEHEALTH_CHANNELS)[number];

/** Which transports a channel choice uses, in a fixed order. */
export function telehealthTransports(channel: TelehealthChannel): readonly ('sms' | 'email')[] {
  return channel === 'both' ? ['sms', 'email'] : [channel];
}

/* -------------------------------------------------------------------------
 * The content: thresholds and the consent statement
 * ---------------------------------------------------------------------- */

export interface TelehealthContent {
  /** Bump on every edit; recorded on every session. */
  readonly version: string;
  readonly code: {
    readonly digits: number;
    readonly validityMinutes: number;
    readonly wrongAttemptsBeforeLock: number;
  };
  readonly page: { readonly pageHours: number };
  readonly consent: {
    /** Recorded on the session beside `version`. */
    readonly key: string;
    /** Placeholders: {{providerName}}. */
    readonly statement: string;
    /** When a carer agrees for the patient. Placeholders: {{providerName}}, {{patientGivenNames}}. */
    readonly carerStatement: string;
  };
}

/**
 * WORDS THE CONSENT STATEMENT AND THE LINK MESSAGE MAY NEVER USE, until the
 * Department answers G10 (TELEHEALTH-PLAN.md §9). A step before the service
 * that mentions bulk billing, Medicare, the assignment or the DB4 could read as
 * an offer to assign (s 65C(3)(b)(i)), which would make the DB4 afterwards a
 * pre-agreement with different particulars. Plus hard rule 12's banned words,
 * and "approve" outright (§3 step 7).
 *
 * Exported so the core test can hold the message the patient actually receives
 * to the same rule as the content file.
 */
export const TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN =
  /bulk[\s-]*bill|medicare|assign|benefit|\bdb4\b|rebate|claim|approv|certif|accredit|\$/i;

const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

export function parseTelehealthContent(raw: unknown): TelehealthContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/telehealth.json is not usable: ${why}. This file is versioned content (hard rule 14) and ` +
        'is validated at load so a bad edit fails the build rather than a patient on a call.',
    );
  };
  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) return fail('`version` must be a non-empty string');

  const int = (section: unknown, name: string, min: number, max: number): number => {
    const value = (section as Record<string, unknown> | null)?.[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      return fail(`\`${name}\` must be a whole number from ${min} to ${max}`);
    }
    return value;
  };
  /*
   * THE BOUNDS ARE THE SAFE RANGE, NOT THE CURRENT VALUE. Six digits is the
   * floor because fewer is guessable inside the lockout; an hour is the ceiling
   * because the code is only meaningful while the call is live; more than ten
   * wrong attempts stops being a lockout.
   */
  const code = {
    digits: int(doc.code, 'digits', 6, 8),
    validityMinutes: int(doc.code, 'validityMinutes', 1, 60),
    wrongAttemptsBeforeLock: int(doc.code, 'wrongAttemptsBeforeLock', 1, 10),
  };
  const page = { pageHours: int(doc.page, 'pageHours', 1, 24) };

  const consent = doc.consent as Record<string, unknown> | undefined;
  if (typeof consent !== 'object' || consent === null) return fail('`consent` must be an object');
  if (typeof consent.key !== 'string' || !/^[a-z][a-z0-9_]*_v[0-9]+$/.test(consent.key)) {
    return fail('`consent.key` must be a versioned lower_snake_case key, e.g. telehealth_consult_v1');
  }
  const allowed: Record<'statement' | 'carerStatement', readonly string[]> = {
    statement: ['providerName'],
    carerStatement: ['providerName', 'patientGivenNames'],
  };
  for (const field of ['statement', 'carerStatement'] as const) {
    const line = consent[field];
    if (typeof line !== 'string' || line.trim().length === 0) return fail(`\`consent.${field}\` must be a non-empty string`);
    if (TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN.test(line)) {
      return fail(
        `\`consent.${field}\` mentions bulk billing, Medicare, the assignment, the DB4, an amount or approval. ` +
          'Until the Department answers G10 the statement is about the consultation only (TELEHEALTH-PLAN.md §9)',
      );
    }
    for (const [, name] of line.matchAll(PLACEHOLDER)) {
      if (!allowed[field].includes(name)) return fail(`\`consent.${field}\` uses {{${name}}}, which it may not`);
    }
  }

  return {
    version: doc.version,
    code,
    page,
    consent: {
      key: consent.key,
      statement: consent.statement as string,
      carerStatement: consent.carerStatement as string,
    },
  };
}

const parsedContent = parseTelehealthContent(content);

export const TELEHEALTH_CONTENT: TelehealthContent = parsedContent;
export const TELEHEALTH_CONTENT_VERSION: string = parsedContent.version;

/**
 * The statement exactly as the patient sees it — one function, so the page and
 * the record cannot word it differently. A missing value throws rather than
 * rendering braces in front of a patient.
 */
export function telehealthConsentStatement(input: {
  providerName: string;
  consenterIsPatient: boolean;
  patientGivenNames?: string;
}): string {
  const template = input.consenterIsPatient ? parsedContent.consent.statement : parsedContent.consent.carerStatement;
  const values: Record<string, string | undefined> = {
    providerName: input.providerName,
    patientGivenNames: input.patientGivenNames,
  };
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const value = values[name];
    if (!value) throw new Error(`The telehealth statement needs {{${name}}} and none was given.`);
    return value;
  });
}

/* -------------------------------------------------------------------------
 * The "not done" reasons
 * ---------------------------------------------------------------------- */

export interface TelehealthNotDoneReason {
  /** What core stores; the string table is keyed by it. */
  readonly key: string;
  /** Only `other` today. The note is free text and the screen warns against identifiers. */
  readonly takesNote: boolean;
}

export interface TelehealthNotDoneReasonContent {
  readonly version: string;
  /** ORDER IS THE ORDER ON SCREEN. */
  readonly reasons: readonly TelehealthNotDoneReason[];
}

/** The longest note the panel accepts. A reason, not a clinical record. */
export const TELEHEALTH_NOT_DONE_NOTE_MAX = 200;

export function parseTelehealthNotDoneReasonContent(raw: unknown): TelehealthNotDoneReasonContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/telehealth-not-done-reasons.json is not usable: ${why}. This file is versioned content ` +
        '(CLAUDE.md §7c) and is validated at load so a bad edit fails the build rather than the panel.',
    );
  };
  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) return fail('`version` must be a non-empty string');
  if (!Array.isArray(doc.reasons) || doc.reasons.length === 0) return fail('`reasons` must be a non-empty array');

  const seen = new Set<string>();
  const reasons = doc.reasons.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`reasons[${index}] is not an object`);
    const e = entry as Record<string, unknown>;
    if (typeof e.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(e.key) || e.key.length > 40) {
      return fail(`reasons[${index}].key must be a lower_snake_case identifier of at most 40 characters`);
    }
    if (seen.has(e.key)) return fail(`reasons[${index}].key "${e.key}" appears twice`);
    seen.add(e.key);
    if (e.takesNote !== undefined && typeof e.takesNote !== 'boolean') {
      return fail(`reasons[${index}].takesNote must be true or false when present`);
    }
    return { key: e.key, takesNote: e.takesNote === true };
  });
  return { version: doc.version, reasons };
}

const parsedReasons = parseTelehealthNotDoneReasonContent(reasonsContent);

/** In file order, which is screen order. */
export const TELEHEALTH_NOT_DONE_REASONS: readonly TelehealthNotDoneReason[] = parsedReasons.reasons;
export const TELEHEALTH_NOT_DONE_REASONS_VERSION: string = parsedReasons.version;
export const TELEHEALTH_NOT_DONE_REASON_KEYS: readonly string[] = parsedReasons.reasons.map((r) => r.key);

export function telehealthNotDoneReason(key: unknown): TelehealthNotDoneReason | undefined {
  return typeof key === 'string' ? parsedReasons.reasons.find((r) => r.key === key) : undefined;
}
