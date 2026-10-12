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
export type TelehealthSessionStateWire = 'opened' | 'code_checked' | 'agreed' | 'not_done' | 'did_not_proceed';

/** Mirrors `TELEHEALTH_CHANNELS` in `@aobplatform/domain`. */
export type TelehealthChannelWire = 'sms' | 'email' | 'both';

/** The contact on the record, masked. A null means none is held for that transport. */
export interface TelehealthMaskedContact {
  readonly patientId: string;
  readonly maskedMobile: string | null;
  readonly maskedEmail: string | null;
}

/** One session as the provider's panel sees it. */
export interface TelehealthSessionView {
  readonly id: string;
  readonly patientId: string;
  /** The patient's own name from the PMS mirror, for the provider's screen only. */
  readonly patientName: string;
  readonly state: TelehealthSessionStateWire;
  readonly channel: TelehealthChannelWire | null;
  /** TYPES the provider ticked, never values. Empty on a session recorded straight as not done. */
  readonly identifierTypes: readonly string[];
  readonly consenterIsPatient: boolean | null;
  readonly codeExpiresAt: string | null;
  /** True once the code was entered wrongly too many times; a fresh link and code is the way on. */
  readonly codeLocked: boolean;
  readonly codeAttemptsLeft: number | null;
  readonly linkSentCount: number;
  readonly codeCheckedAt: string | null;
  readonly agreedAt: string | null;
  readonly notDoneReason: string | null;
  /** Whether the `other` reason carried a note. The note itself is returned to the panel only. */
  readonly notDoneNote: string | null;
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
}

/** A right code. The page key keeps the one page open; it is held in memory only. */
export interface TelehealthCodeAccepted {
  readonly pageKey: string;
}

/** A wrong code. Never which digit, never the right one. */
export interface TelehealthCodeRefused {
  readonly outcome: 'wrong_code' | 'locked' | 'expired';
  readonly attemptsLeft: number | null;
}

/** The one page, after the code. */
export interface TelehealthPageView {
  readonly state: TelehealthSessionStateWire;
  readonly practiceName: string | null;
  readonly providerName: string | null;
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
  /** Patient page (public; the token or page key is the only credential). */
  landing: 'GET /telehealth/link/:token',
  enterCode: 'POST /telehealth/link/:token/code',
  page: 'GET /telehealth/page (x-telehealth-page-key)',
  agree: 'POST /telehealth/page/agree (x-telehealth-page-key)',
} as const;
