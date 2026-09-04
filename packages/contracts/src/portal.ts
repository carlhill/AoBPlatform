/**
 * C8 — the patient's own page (REQ-PORT-01..08, FR-8.1/8.2, M8).
 *
 * THE SHAPES ONLY. The server half lives in `apps/core/src/portal`; the web
 * half is `apps/web/app/patient/portal`. Both build to these types so that
 * "the field is called `providerName`" is settled in one place rather than
 * twice, differently.
 *
 * FOUR RULES ARE VISIBLE IN THE TYPES THEMSELVES, which is the point of
 * writing them here:
 *
 *  1. NO MEDICARE NUMBER FIELD EXISTS on `PortalDetails` — not optional, not
 *     nullable, absent. The card number is not an identity identifier and the
 *     exclusion is not configurable (hard rule 1, REQ-VER-02). A type with no
 *     such key cannot grow one by accident on a screen.
 *  2. NO AMOUNT FIELD EXISTS on `PortalAgreement` or anywhere else except
 *     `PortalNotice` (hard rule 4). Reg 89AA notices are the ONE artefact that
 *     carries a benefit amount, so the one type that has one is the notice.
 *  3. `PortalNotice` HAS NO STATE, no `accepted`, no `approved` and no action.
 *     89AA notices are one-way and are never chased (hard rule 7); a field
 *     that could be rendered as a decision is the thing to leave out.
 *  4. EVERYTHING THAT COULD BE A VALUE IS A KEY. `actionKey`, `purposeKey`,
 *     `fieldType`, `relationshipKey` — the string table holds the words
 *     (REQ-LANG-01) and the access log holds types, never values
 *     (REQ-VER-04, hard rule 9).
 */

/** ISO-8601 instant, server-authoritative. */
export type PortalTimestamp = string;
/** ISO-8601 date, `YYYY-MM-DD`. */
export type PortalDate = string;

/**
 * One practice the patient linked for themselves.
 *
 * THE PATIENT CARRIES THE LINK, not the practices. They activate from each
 * practice's signed agreement, after that practice verified them across its
 * own counter — so the portal account is the hub and no practice ever learns
 * that another exists (TODO.md "The patient links their own practices"). That
 * is what sidesteps the cross-practice identifier question entirely: there is
 * no IHI matching and no disclosure between practices.
 */
export interface PortalLink {
  readonly practiceId: string;
  readonly practiceName: string;
  readonly patientId: string;
}

export interface PortalSession {
  readonly accountId: string;
  readonly links: readonly PortalLink[];
}

/**
 * The five details, as ONE practice holds them.
 *
 * Per link rather than merged, because the PMS is the master and two practices
 * may legitimately hold different addresses for the same person (REQ-DATA-10).
 * Merging them would invent a single truth the platform does not have.
 *
 * There is deliberately no Medicare number here, and no field a Medicare
 * number could be put in.
 */
export interface PortalDetails {
  readonly practiceId: string;
  readonly practiceName: string;
  readonly patientId: string;
  readonly familyName: string;
  readonly givenNames: string;
  readonly dateOfBirth: PortalDate;
  readonly address: string | null;
  readonly mobile: string | null;
  readonly email: string | null;
  readonly patientRecordNumber: string | null;
}

/**
 * One agreement, from the patient's side (REQ-PORT-01).
 *
 * `artefactAvailable` is FALSE rather than absent when the rendered artefact
 * cannot be re-verified — an agreement locked under a renderer version this
 * build no longer registers, or one that never locked. The screen offers no
 * download rather than offering one that 409s.
 */
export interface PortalAgreement {
  readonly id: string;
  readonly practiceId: string;
  readonly practiceName: string;
  readonly providerName: string | null;
  /** episodic_pre | episodic_post | treatment_plan | enduring */
  readonly type: string;
  readonly status: string;
  readonly serviceDate: PortalDate | null;
  /** D6a, the Basic Service Description as agreed. Never an item price. */
  readonly serviceDescription: string | null;
  /** in_practice | sms_link | email_link | paper — how it was signed. */
  readonly channel: string | null;
  readonly signedAt: PortalTimestamp | null;
  readonly artefactAvailable: boolean;
}

/** REQ-PORT-03 — the enduring agreements in force for this patient. */
export interface PortalEnduring {
  readonly agreementId: string;
  readonly practiceId: string;
  readonly practiceName: string;
  readonly providerName: string | null;
  readonly activeSince: PortalDate;
}

/**
 * The result of REQ-PORT-05 / 65CA(7)(b) — the patient ends it, whether or not
 * they were the assignor.
 *
 * `effectiveAt` is TWO BUSINESS DAYS after the notice (FR-5.3), computed from
 * the practice's own state calendar — not from a fixed 48 hours.
 * `noticeStatus` is always a draft: the written notice is human-authored
 * regulatory copy and a person releases it.
 */
export interface PortalTerminationResult {
  readonly agreementId: string;
  readonly noticeAt: PortalTimestamp;
  readonly effectiveAt: PortalTimestamp;
  /** Which state's business-day calendar produced `effectiveAt`, and its dataset provenance. */
  readonly calendar: string;
  readonly noticeTemplateKey: string;
  readonly noticeStatus: 'draft_pending_review';
}

/**
 * REQ-PORT-04 — a reg 89AA claim notification the patient was sent.
 *
 * THE ONE PLACE AN AMOUNT APPEARS in this whole contract (hard rule 4). Note
 * what is missing: no status, no acknowledgement, no action. A notice is
 * one-way, never gates payment and is never chased (hard rule 7, REQ-CHASE-02)
 * — so there is no field a screen could turn into a button.
 */
export interface PortalNotice {
  readonly id: string;
  readonly date: PortalDate;
  readonly providerName: string;
  readonly practiceName: string;
  readonly benefitAmountCents: number;
}

/**
 * "Where I have been" — derived from agreement service dates ONLY.
 *
 * Never a clinical record and never an appointment: the AoB record knows that
 * a service on a date was assigned at a practice, and that is the whole of what
 * this says (CLAUDE.md §8).
 */
export interface PortalVisit {
  readonly date: PortalDate;
  readonly practiceId: string;
  readonly practiceName: string;
  /** One human-readable line of where that was. Never a room, never a reason. */
  readonly locationLine: string | null;
}

/**
 * "Messages to me" (REQ-PORT-06) — the anti-phishing surface.
 *
 * NO BODIES, deliberately. The point of this list is not to re-read the text:
 * it is that a request the patient can see AFTER SIGNING IN is a request that
 * really came from us. A forged SMS has no row here. So the list carries the
 * channel, when, what state the send reached, and whether it is still waiting
 * on them — enough to answer "is this genuine" and nothing more.
 */
export interface PortalMessage {
  readonly id: string;
  /** sms | email | post | device */
  readonly channel: string;
  readonly sentAt: PortalTimestamp | null;
  /** queued | sent | delivered | failed | dead */
  readonly state: string;
  /** What it was for, as a key for the string table — never the subject line. */
  readonly purposeKey: string;
  readonly practiceName: string;
  /** True when it carries a request the patient has not actioned yet. */
  readonly pending: boolean;
}

/** Somebody who has signed on this patient's behalf (REQ-PORT-07, FR-1.19). */
export interface PortalAssignorOfMine {
  readonly assignorId: string;
  readonly practiceId: string;
  readonly name: string;
  /** A key from `content/assignor-relationships.json`, or null on older rows. */
  readonly relationshipKey: string | null;
  readonly since: PortalTimestamp;
  /** False once the patient has revoked them (FR-1.23). */
  readonly active: boolean;
}

/** A patient this account's person acts for. See the note on `PortalAssignors`. */
export interface PortalPatientIActFor {
  readonly patientId: string;
  readonly practiceId: string;
  readonly practiceName: string;
  readonly givenNames: string;
  readonly since: PortalTimestamp;
}

/**
 * REQ-PORT-07, both directions.
 *
 * `iActFor` IS EMPTY UNTIL FR-1.19 EXISTS, and that is a statement about the
 * schema rather than about this endpoint. `Assignor` carries a name and an
 * authority basis but no link to the acting person's OWN patient record, so
 * "which patients does this person act for" could only be answered by matching
 * on a name — which is exactly the kind of guess this product refuses. The
 * standing-assignor tier (FR-1.19) is what creates that link; until it is
 * built the honest answer is an empty list, not an approximate one.
 */
export interface PortalAssignors {
  readonly actsForMe: readonly PortalAssignorOfMine[];
  readonly iActFor: readonly PortalPatientIActFor[];
}

/**
 * FR-8.2 — "who has looked", as the patient sees it.
 *
 * KEYS ONLY. `actionKey` is a vault event type or a record kind; there is no
 * field here that could carry a detail's value, a name or a note
 * (REQ-VER-04, hard rule 9, REQ-LOG-08).
 */
export interface PortalAccessLogEntry {
  readonly at: PortalTimestamp;
  readonly actorType: 'practice_staff' | 'patient' | 'system';
  readonly practiceId: string;
  readonly practiceName: string;
  readonly actionKey: string;
}

/**
 * "Ask the practice to correct this" — an APP 13-style correction routed to the
 * record owner, never a direct edit.
 *
 * THE REQUEST CARRIES NO NEW VALUE, and the type has nowhere to put one. The
 * practice's PMS is the master; reception confirms the right value with the
 * patient in person and types it there. A portal that accepted a replacement
 * value would be letting an unverified channel write to a clinical system.
 */
export interface PortalCorrectionRequest {
  readonly practiceId: string;
  /** One of name | date_of_birth | address | mobile | email. */
  readonly fieldType: string;
}

export interface PortalCorrectionRequestResult {
  readonly raised: true;
  readonly reviewTaskId: string;
  readonly practiceId: string;
  readonly fieldType: string;
}

/** What `POST /portal/activate` is given. The token alone is never enough. */
export interface PortalActivationRequest {
  readonly agreementId: string;
  readonly activationToken: string;
  /**
   * The three-identifier answers, keyed by approved identifier type. Compared
   * and discarded — nothing here is ever stored or logged (REQ-VER-04).
   * `medicare_number` is refused as a key, non-configurably (hard rule 1).
   */
  readonly stated: Readonly<Record<string, string>>;
}

export interface PortalActivationResult {
  readonly activated: true;
  readonly accountId: string;
  readonly links: readonly PortalLink[];
}

/** What `POST /agreements/:id/portal-invitation` gives back to the practice. */
export interface PortalInvitationResult {
  readonly invitationId: string;
  readonly agreementId: string;
  readonly expiresAt: PortalTimestamp;
  /**
   * The activation token, returned ONCE at mint and never readable again — only
   * its hash is stored. Delivered to the patient through the messaging module;
   * the practice never needs to see it.
   */
  readonly activationToken: string;
}

/** The name of the session cookie. One opaque id; nothing else is stored client-side. */
export const PORTAL_SESSION_COOKIE = 'aob_portal';

/** FR-8.2 — sessions are short-lived. Thirty minutes, server-side. */
export const PORTAL_SESSION_MINUTES = 30;

/**
 * REQ-PORT-08's teeth on the activation path: three wrong answers and the
 * token is finished. A fresh invitation is a practice act, at the counter.
 */
export const PORTAL_ACTIVATION_MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// FR-8.2 — passkeys (Carl, 4 Sep 2026: "Implement"; D-2026-09-04-02)
// ---------------------------------------------------------------------------

/**
 * THE SECOND HALF OF FR-8.2, and the shapes say what it is and is not.
 *
 * PASSKEYS IN CORE, NOT IN KEYCLOAK (D-2026-09-04-02). Patients are not staff:
 * hard rule 15 and the Keycloak realm are about practitioners and admins, the
 * portal already owns the account and the server-side session, and the thing
 * that BINDS a credential to a verified person is the three-identifier
 * bootstrap that core performs. A second realm for patients would put patient
 * PII in Keycloak and buy nothing.
 *
 * THE ORDER IS BOOTSTRAP FIRST, ALWAYS. Registration is reachable only inside a
 * live portal session, so every credential is enrolled by somebody a practice
 * verified across its own counter. A passkey enrolled before that check would
 * be bound to whoever was holding the phone — the family-phone failure
 * (REQ-VUL, addendum v4) with a cryptographic key on the end of it.
 *
 * A PASSKEY IS NEVER A PRECONDITION (REQ-PORT-08). Losing every device costs
 * the patient a fresh invitation at the practice and nothing else; it never
 * costs them the ability to sign an agreement, because signing has never
 * needed this page.
 *
 * NOTHING HERE CARRIES A NAME. A credential has a public key, a counter, a
 * transport hint and — if the patient typed one — their own word for their own
 * device. There is no field for an email, a mobile or a display name, and the
 * WebAuthn user handle is the account id, so a passkey manager showing the
 * entry shows an opaque id rather than a patient's identity.
 */

/** One enrolled credential, as the patient's own "Sign-in and security" card lists it. */
export interface PortalPasskey {
  readonly id: string;
  /** The patient's own words for their own device, or null if they named none. */
  readonly label: string | null;
  readonly createdAt: PortalTimestamp;
  readonly lastUsedAt: PortalTimestamp | null;
}

/**
 * `PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`
 * as an opaque object.
 *
 * TYPED LOOSELY ON PURPOSE. `@aobplatform/contracts` is imported by the browser
 * bundle and by three services; giving it a WebAuthn library's type would make
 * that library a dependency of all of them to describe a payload that is passed
 * straight through to `navigator.credentials` and never inspected by us. The
 * web surface casts once, at the call site, where the library is already
 * imported.
 */
export type PortalPasskeyOptions = Readonly<Record<string, unknown>>;

/**
 * What an options call returns.
 *
 * `challengeId` IS RETURNED RATHER THAN THE CHALLENGE BEING RE-DERIVED. The
 * verify call names the row it is finishing, so the server can spend it by
 * primary key — one conditional update, one winner if two requests race. The
 * alternative, digging the challenge out of `clientDataJSON` before it has been
 * verified, means trusting the payload to find the thing that decides whether
 * to trust the payload.
 */
export interface PortalPasskeyChallenge {
  readonly challengeId: string;
  readonly options: PortalPasskeyOptions;
}

/** What the browser posts back. `response` is the credential, verbatim. */
export interface PortalPasskeyRegistrationVerification {
  readonly challengeId: string;
  readonly response: Readonly<Record<string, unknown>>;
  /** Optional, the patient's own words. Never generated from a user agent. */
  readonly label?: string;
}

export interface PortalPasskeyAuthenticationVerification {
  readonly challengeId: string;
  readonly response: Readonly<Record<string, unknown>>;
}

export interface PortalPasskeyRegistrationResult {
  readonly registered: true;
  readonly passkey: PortalPasskey;
}

/** A sign-in that worked. The same shape activation returns, for the same reason. */
export interface PortalPasskeySignInResult {
  readonly signedIn: true;
  readonly accountId: string;
  readonly links: readonly PortalLink[];
}

export interface PortalPasskeyRevocationResult {
  readonly revoked: true;
  readonly passkeyId: string;
  /**
   * TRUE WHEN THAT WAS THE LAST ONE, and it is allowed (REQ-PORT-08). The
   * portal is never a precondition; a patient who removes every passkey
   * re-bootstraps from a fresh invitation at the practice. The flag exists so
   * the screen can SAY that, not so it can refuse.
   */
  readonly noPasskeysRemain: boolean;
}

/**
 * FIVE MINUTES, SINGLE USE. Long enough for a person to find their phone and
 * short enough that a challenge captured off a screen is worthless by the time
 * anyone acts on it. Single use is the property that matters; the clock is the
 * belt to its braces.
 */
export const PORTAL_PASSKEY_CHALLENGE_MINUTES = 5;

/**
 * The sign-in attempts one address gets per window, before it is asked to wait.
 *
 * LOOSER THAN THE KIOSK'S THREE, and deliberately. A discoverable sign-in that
 * fails is usually a person picking the wrong passkey or cancelling the
 * prompt, not an attack — and unlike the kiosk there is no staff member two
 * metres away to fall back on. What it stops is a script grinding assertions
 * against the endpoint; a signature it cannot forge is the actual defence.
 */
export const PORTAL_PASSKEY_ATTEMPT_LIMIT = 10;
export const PORTAL_PASSKEY_ATTEMPT_WINDOW_MINUTES = 10;
