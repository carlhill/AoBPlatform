/**
 * THE RECEPTION WORK LIST — one patient at a time (TODO.md "Reception-centric:
 * the patient work page", Carl 4 Sep 2026).
 *
 * WHY THESE TYPES EXIST AT ALL, when `/practice/tablet` already reads two
 * lists. Reception's job is a PERSON, not a queue: the patient standing at the
 * desk has an agreement waiting, a tablet session that ended, a detail they
 * said was wrong and a reminder due, and answering them today means four
 * screens. These shapes are the same facts regrouped by the person they are
 * about — nothing new is computed, and "open today" is deliberately the push
 * list's own notion of today rather than a second one that could disagree.
 *
 * CODES, NOT SENTENCES, ON EVERY FIELD. What is open arrives as a kind and a
 * state; the words are in the console's string table, keyed by them
 * (REQ-LANG-01). A server that sent prose would put user-facing copy in a
 * place no translation reaches and no test can pin.
 *
 * NO IDENTIFIER VALUES AND NO AMOUNTS, ANYWHERE IN HERE. The disputed details
 * are TYPES (REQ-VER-04, hard rule 9); there is no Medicare field because
 * there is no such column and it is not an identity identifier in any case
 * (hard rule 1, REQ-VER-02); and nothing on an agreement artefact carries a
 * dollar figure (hard rule 4) so nothing here does either.
 */

import type { AgreementType } from './agreement';
import type { PushBlockedReason, TabletSessionState, DisputeResolutionOutcome } from './tablet-session';

/**
 * ONE OPEN THING ABOUT ONE PATIENT.
 *
 * TWO KINDS, AND THEY ARE THE TWO QUESTIONS RECEPTION ACTUALLY ASKS.
 * `awaiting_signature` is "this one still needs signing" — a row off the push
 * list, carrying whether it can go and, if not, which rule is in the way.
 * `session` is "this one is on a tablet, or was this morning" — live or ended,
 * with what the patient said about their details.
 */
export type PatientQueueItemKind = 'awaiting_signature' | 'session';

export interface PatientQueueItem {
  kind: PatientQueueItemKind;
  agreementId: string;
  agreementType: AgreementType;

  /** `awaiting_signature` only — whether it could go to a tablet, and why not. */
  pushable?: boolean;
  blockedReason?: PushBlockedReason | null;

  /** `session` only. The short id is composed on screen from this one. */
  sessionId?: string;
  sessionState?: TabletSessionState;
  deviceLabel?: string;
  /** `null` while it is still live — which is what makes it "on a tablet now". */
  endedAt?: string | null;
  /** TYPES the patient crossed, never the values behind them (REQ-VER-04). */
  disputedDetails?: string[];
  disputeResolution?: DisputeResolutionOutcome | null;
}

/**
 * ONE PATIENT WITH SOMETHING OPEN TODAY.
 *
 * THE DATE OF BIRTH IS HERE BECAUSE TWO PEOPLE SHARE A NAME (Carl, 4 Sep
 * 2026: "Each row: name, DOB"). It is the detail reception disambiguates by,
 * and they asked for it across the desk minutes ago. It is NOT an
 * identification of anybody by itself and it is never counted toward the three
 * identifiers — the check that matters happened at the counter (REQ-VER-03).
 */
export interface PatientQueueRow {
  patientId: string;
  patientName: string;
  dateOfBirth: string;
  /** Newest first, so the screen's one-line summary is the freshest fact. */
  items: PatientQueueItem[];
}

/**
 * WHAT HAPPENED TO THIS PATIENT, IN ORDER — types, times and short labels
 * only.
 *
 * IT IS A PROJECTION OF EVIDENCE, NOT THE EVIDENCE. The vault holds the
 * non-repudiable chain; this is the same story told from the domain rows so
 * reception can see it without leaving the page. Nothing here is a value: a
 * verification entry says WHICH TYPES were checked and how it went
 * (REQ-VER-04), a correction says which field moved and never what it moved
 * from or to, and a signature says that one happened and when.
 */
export const PATIENT_TIMELINE_TYPES = [
  'agreement_created',
  'agreement_superseded',
  'particulars_locked',
  'agreement_signed',
  'capture_opened',
  'capture_closed',
  'verification',
  'session_pushed',
  'session_details_confirmed',
  'session_details_disputed',
  'session_dispute_resolved',
  'session_ended',
  'details_corrected',
] as const;

export type PatientTimelineType = (typeof PATIENT_TIMELINE_TYPES)[number];

export interface PatientTimelineEntry {
  at: string;
  type: PatientTimelineType;
  agreementId?: string;
  sessionId?: string;
  /**
   * ONE SHORT CODE THE CONSOLE TURNS INTO WORDS — a session's end state, a
   * capture channel, a verification outcome, a resolution. Never a sentence
   * and never a value.
   */
  detail?: string;
  /** TYPES only: which details were confirmed, crossed or corrected. */
  detailTypes?: string[];
}
