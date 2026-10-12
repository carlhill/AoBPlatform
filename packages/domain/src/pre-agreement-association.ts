/**
 * AN UNSIGNED PRE-AGREEMENT AND THE SERVICE ITS VISIT TURNED INTO
 * (D-2026-10-10-09; Carl, 10 Oct 2026: option (b), "associate, do not link").
 *
 * WHY "ASSOCIATE" AND NOT "LINK". `service_records.agreementId` is the
 * agreement a claim is reconciled against, and the post-service cascade reads
 * it as "already covered". An `episodic_pre` that was not signed before the
 * service assigns nothing (`preAgreementForTheDay` counts only a signed one),
 * so putting it in that column would switch off the post-service agreement
 * for the visit. The association is a separate fact: this unsigned draft was
 * for the visit that this service record records. The post-service agreement
 * is still drafted, linked and chased exactly as before.
 *
 * WHAT IS HERE. The pure rules: which statuses count as unsigned and still
 * open, which day a draft is for, and what the number of matching drafts
 * means. Core does the reading and writing.
 */
import type { AgreementStatus, AgreementType } from './agreement';
import { STATUS_TRANSITIONS, canTransition } from './lifecycle';
import { practiceToday } from './practice-day';

/**
 * UNSIGNED AND STILL OPEN: every status from which the lifecycle allows
 * `expired`. Derived from `STATUS_TRANSITIONS`, so a status added there is
 * picked up here rather than silently left out.
 */
export const UNSIGNED_OPEN_STATUSES: readonly AgreementStatus[] = (
  Object.keys(STATUS_TRANSITIONS) as AgreementStatus[]
).filter((status) => canTransition(status, 'expired'));

/**
 * ONLY A PRE-AGREEMENT IS ASSOCIATED. An `episodic_post` is linked to its
 * service record when it is drafted, so it never needs this; enduring and
 * treatment-plan agreements are not for one visit.
 */
export const ASSOCIATION_CANDIDATE_TYPES: readonly AgreementType[] = ['episodic_pre'];

/**
 * HOW AN ASSOCIATION WAS MADE: `automatic` when exactly one draft matched as
 * the service arrived, `chosen` when a person picked one on Reconciliation.
 */
export const PRE_AGREEMENT_ASSOCIATION_HOW = ['automatic', 'chosen'] as const;
export type PreAgreementAssociationHow = (typeof PRE_AGREEMENT_ASSOCIATION_HOW)[number];

export function isPreAgreementAssociationHow(value: unknown): value is PreAgreementAssociationHow {
  return typeof value === 'string' && (PRE_AGREEMENT_ASSOCIATION_HOW as readonly string[]).includes(value);
}

/**
 * WHAT THE NUMBER OF MATCHING DRAFTS MEANS.
 *  - none: nothing to associate;
 *  - exactly one: associate it;
 *  - more than one: associate none, and a person chooses on Reconciliation.
 *    A guess between two drafts would be the platform deciding which contract
 *    a visit had.
 */
export function associationOutcomeFor(candidateCount: number): 'none' | 'associate' | 'choose' {
  if (candidateCount <= 0) return 'none';
  return candidateCount === 1 ? 'associate' : 'choose';
}

/**
 * THE DAY A DRAFT IS FOR, IN THE PRACTICE'S ZONE: the appointment's date where
 * the draft has a booking, otherwise the practice-local day it was created.
 * The same reading the tablet page's lists make. `appointmentDate` is a
 * calendar date (`@db.Date`), so its UTC date is the day.
 */
export function visitDayOf(agreement: { createdAt: Date }, appointmentDate: Date | null | undefined): string {
  return appointmentDate ? appointmentDate.toISOString().slice(0, 10) : practiceToday(agreement.createdAt);
}
