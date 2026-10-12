/**
 * THE TELEHEALTH SESSION, AS THE WIRE CARRIES IT (TELEHEALTH-PLAN.md §8 step 2).
 *
 * Two audiences, two shapes, and no field crosses between them:
 *
 *   - THE PROVIDER'S PANEL (`/telehealth/...`, passkey console): the session,
 *     masked contacts and — exactly once, in the send response — the code.
 *   - THE PATIENT'S PAGE (`/telehealth/link/:token`, `/telehealth/page`,
 *     public): the practice, the provider and one statement. Never the code,
 *     never a contact, never the identifier types checked.
 *
 * NO IDENTIFIER VALUE IS ANYWHERE IN THIS FILE (hard rules 1 and 9). The panel
 * gets identifier TYPES; contacts arrive masked ("•••••• 412") and the server
 * never sends the address itself to any screen (D-2026-09-11-03).
 *
 * The routes these types belong to are listed in `TELEHEALTH_ROUTES`, which is
 * this repository's contract for them (there is no generated OpenAPI document
 * in the monorepo; `packages/contracts` is the shared contract).
 */

/** Mirrors `TELEHEALTH_SESSION_STATES` in `@aobplatform/domain`. */
export type TelehealthSessionStateWire = 'opened' | 'code_checked' | 'agreed' | 'not_done' | 'did_not_proceed' | 'went_ahead';

/** Mirrors `TELEHEALTH_CHANNELS` in `@aobplatform/domain`. */
export type TelehealthChannelWire = 'sms' | 'email' | 'both';

/**
 * The chosen patient's record as the doctor's panel shows it, IN FULL (Carl,
 * D-2026-10-12-03 item 1), so the doctor can compare what the person on the
 * call says. Shown, never stored: the session still records identifier TYPES
 * only (hard rule 9). The masked forms remain for the channel choice. A null
 * means the record holds no value for that field.
 */
export interface TelehealthPatientRecord {
  readonly givenNames: string;
  readonly familyName: string;
  /** YYYY-MM-DD. */
  readonly dateOfBirth: string;
  readonly gender: string | null;
  readonly address: string | null;
  readonly patientRecordNumber: string | null;
  readonly ihi: string | null;
  readonly mobile: string | null;
  readonly email: string | null;
}

/** The contact on the record. A null masked value means none is held for that transport. */
export interface TelehealthMaskedContact {
  readonly patientId: string;
  readonly maskedMobile: string | null;
  readonly maskedEmail: string | null;
  readonly record: TelehealthPatientRecord;
}

/** One session as the provider's panel sees it. */
export interface TelehealthSessionView {
  readonly id: string;
  /** The TH-XXXX-XXXX reference the patient quotes to the practice (D-2026-10-12-03 item 11). */
  readonly consultationId: string;
  readonly patientId: string;
  /** The patient's own name from the PMS mirror, for the provider's screen only. */
  readonly patientName: string;
  readonly state: TelehealthSessionStateWire;
  readonly channel: TelehealthChannelWire | null;
  /** TYPES the provider ticked, never values. Empty on a session recorded straight as not done. */
  readonly identifierTypes: readonly string[];
  readonly consenterIsPatient: boolean | null;
  readonly codeExpiresAt: string | null;
  /** When the patient's page closes, once the code was entered. The panel polls only while this is ahead. */
  readonly pageExpiresAt: string | null;
  /** True once the code was entered wrongly too many times; a fresh link and code is the way on. */
  readonly codeLocked: boolean;
  readonly codeAttemptsLeft: number | null;
  readonly linkSentCount: number;
  readonly codeCheckedAt: string | null;
  readonly agreedAt: string | null;
  readonly notDoneReason: string | null;
  /** Whether the `other` reason carried a note. The note itself is returned to the panel only. */
  readonly notDoneNote: string | null;
  /** Typed by someone acting for the patient, with their mobile, for the provider to reach them (D-2026-10-12-03 item 12). */
  readonly consenterName: string | null;
  readonly consenterMobile: string | null;
  /** When the provider says the consultation happened. */
  readonly consultationAt: string | null;
  /** When the outcome (not done / did not proceed) was RECORDED — honest about the next morning. */
  readonly outcomeRecordedAt: string | null;
  readonly createdAt: string;
  readonly contentVersion: string;
}

/** What Send (and Send again) returns. THE CODE APPEARS HERE AND NOWHERE ELSE, ONCE. */
export interface TelehealthSendResult {
  readonly session: TelehealthSessionView;
  readonly code: string;
  readonly codeExpiresAt: string;
  /** Which transports were queued. Through the outbound queue and the dev sandbox gateway only. */
  readonly queued: readonly ('sms' | 'email')[];
}

/** The landing, before the code. Practice-branded and content-blind (REQ-VER-05, REQ-CHILD-04). */
export interface TelehealthLinkLanding {
  readonly state: 'open' | 'used' | 'expired' | 'locked' | 'closed';
  readonly practiceName: string | null;
  /** When `closed`: which outcome the practitioner recorded, so the page says the right thing (Carl, 12 Oct 2026). */
  readonly outcome?: 'went_ahead' | 'did_not_proceed' | 'not_done' | null;
}

/** A right code. The page key keeps the one page open; it is held in memory only. */
export interface TelehealthCodeAccepted {
  readonly pageKey: string;
}

/** A wrong code. Never which digit, never the right one. */
export interface TelehealthCodeRefused {
  readonly outcome: 'wrong_code' | 'locked' | 'expired';
  /**
   * What the page maps its words from — never the status alone (wow.md §13):
   * `wrong_code`, `locked`, `code_expired`, `link_used`, `session_closed`.
   * Other refusals on these routes carry `link_invalid`, `page_not_open`,
   * `page_replaced`, `page_expired`, `wording_changed`, `session_not_done` or
   * `session_did_not_proceed`.
   */
  readonly code?: string;
  readonly attemptsLeft: number | null;
}

/** The one page, after the code. */
export interface TelehealthPageView {
  readonly state: TelehealthSessionStateWire;
  readonly practiceName: string | null;
  readonly providerName: string | null;
  /** The provider's Ahpra number, only when sighted and current; null shows no line (D-2026-10-12-03 item 10). */
  readonly ahpraNumber: string | null;
  /** The TH-XXXX-XXXX reference the patient quotes to the practice (D-2026-10-12-03 item 11). */
  readonly consultationId: string;
  /** False when someone acting for the patient agrees: the page then asks their full name and mobile (D-2026-10-12-03 item 12). */
  readonly consenterIsPatient: boolean;
  /** For someone acting for the patient: the relationship key the provider chose, and the patient's given names, for "You are the carer for Juno". Null for the patient. */
  readonly consenterRelationship: string | null;
  readonly patientGivenNames: string | null;
  /** The one statement, from versioned content, as it will be recorded. */
  readonly statement: string;
  readonly consentKey: string;
  readonly contentVersion: string;
  readonly agreedAt: string | null;
}

/** The routes, so a client and a reviewer can see the whole surface at once. */
export const TELEHEALTH_ROUTES = {
  /** Provider console (passkey sign-in; practitioner token). 404 `telehealth_not_enabled` while the flag is off. */
  enabled: 'GET /telehealth/enabled',
  searchPatients: 'GET /telehealth/patients?q=',
  patientContact: 'GET /telehealth/patients/:patientId/contact',
  listSessions: 'GET /telehealth/sessions',
  send: 'POST /telehealth/sessions',
  sendAgain: 'POST /telehealth/sessions/:id/send-again',
  markNotDone: 'POST /telehealth/sessions/:id/not-done',
  recordNotDone: 'POST /telehealth/not-done',
  markDidNotProceed: 'POST /telehealth/sessions/:id/did-not-proceed',
  markWentAhead: 'POST /telehealth/sessions/:id/went-ahead',
  /** Patient page (public; the token or page key is the only credential). */
  landing: 'GET /telehealth/link/:token',
  enterCode: 'POST /telehealth/link/:token/code',
  page: 'GET /telehealth/page (x-telehealth-page-key)',
  agree: 'POST /telehealth/page/agree (x-telehealth-page-key)',
} as const;
