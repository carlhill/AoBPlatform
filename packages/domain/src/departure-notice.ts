/**
 * Recording a departure whose notice did not come through AoBPlatform.
 *
 * THE REFUSAL THIS REPLACES WAS RIGHT ABOUT THE LAW AND WRONG ABOUT THE
 * RECORD.
 *
 * `assertNoticeValid` refuses an end date in the past, and its reasoning is
 * sound: under reg 65CA(8) an enduring agreement ceases when the practitioner
 * leaves, on that event. Backdating a notice does not un-cease anything.
 *
 * But look at what the refusal actually achieved. A practitioner left on the
 * 19th. The practice tried to record it on the 22nd. We refused — so the
 * platform went on showing that practitioner as ACTIVE at a location they had
 * already left, which is a worse falsehood than the one we were guarding
 * against. The refusal did not prevent the departure. It only prevented us
 * knowing about it.
 *
 * THE FIX IS NOT TO RELAX THE RULE. It is to separate two questions the old
 * code had merged:
 *
 *   1. WHEN DID THE AGREEMENTS CEASE? On the departure date. Always. Nothing
 *      recorded here moves that, and nothing here should pretend to.
 *   2. WAS PROPER NOTICE GIVEN, AND BY WHOM? Sometimes through AoBPlatform,
 *      sometimes by a conversation and an employment agreement that predate
 *      us entirely.
 *
 * A practice whose notice was given outside the platform can now say so, and
 * that statement is recorded as what it is: AN ATTESTATION BY A NAMED PERSON,
 * weaker than notice we delivered ourselves, and marked as such for ever. We
 * do not silently relabel it as platform notice — the whole value of the
 * record is that a reader can tell the two apart.
 */

import { TERMINATION_BUSINESS_DAYS, isBusinessDay, type BusinessDayCalendar } from './enduring';

/**
 * How notice was given, when it was not given through us.
 *
 * Ordered by how much of it survives being questioned later.
 */
export const EXTERNAL_NOTICE_MEANS = [
  {
    key: 'employment_agreement',
    label: 'Their employment or contractor agreement set the end date',
    establishes: 'A written term agreed in advance by both parties.',
    limits: 'Says nothing about whether either party confirmed the date as it approached.',
    strength: 'STRONG' as const,
  },
  {
    key: 'letter',
    label: 'A letter or signed notice',
    establishes: 'A dated document, held by the practice.',
    limits: 'We have not seen it unless it is attached here.',
    strength: 'STRONG' as const,
  },
  {
    key: 'email_outside_platform',
    label: 'Email, outside AoBPlatform',
    establishes: 'A dated message, if the practice still holds it.',
    limits: 'Not delivered or timestamped by us, so the date is the practice’s word.',
    strength: 'MODERATE' as const,
  },
  {
    key: 'in_person',
    label: 'A conversation, in person or by phone',
    establishes: 'That the practice says the practitioner was told.',
    limits: 'Nothing written exists. This is the practice’s account and only that.',
    strength: 'WEAK' as const,
  },
  {
    key: 'other',
    label: 'Something else — described in the note',
    establishes: 'Whatever the note says.',
    limits: 'Unclassifiable, so the note is the whole record.',
    strength: 'WEAK' as const,
  },
] as const;

export const EXTERNAL_NOTICE_KEYS = EXTERNAL_NOTICE_MEANS.map((m) => m.key);

export function externalNoticeMeans(key: string) {
  return EXTERNAL_NOTICE_MEANS.find((m) => m.key === key);
}

export class DepartureNoticeError extends Error {}

export interface ExternalNoticeAttestation {
  /** From EXTERNAL_NOTICE_MEANS. */
  means: string;
  /** When notice was ACTUALLY given, outside the platform. */
  givenAt: Date;
  note?: string;
}

/** Where the notice came from. Never blurred. */
export type NoticeBasis = 'platform' | 'external_attested';

export interface NoticeAssessment {
  basis: NoticeBasis;
  /** Business days between notice and departure. Negative if notice came after. */
  leadBusinessDays: number;
  /** Whether that clears the statutory 2 business days. */
  sufficientLead: boolean;
  /**
   * The date the agreements ceased. THE DEPARTURE DATE, always — recording
   * something later does not move it.
   */
  agreementsCeasedOn: Date;
  /**
   * Set when the record itself shows a problem: notice after departure, or
   * short of the statutory period. Recorded rather than refused, because a
   * departure that happened is a fact and the platform being wrong about who
   * works where is the worse outcome.
   */
  anomaly?: string;
}

function atMidnightUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Business days from notice to departure. Negative when notice came after.
 *
 * Counts the days BETWEEN, matching `terminationEffectiveDate`, which advances
 * from the notice date and counts business days as it goes.
 */
export function businessDaysBetween(from: Date, to: Date, calendar: BusinessDayCalendar): number {
  const start = atMidnightUtc(from);
  const end = atMidnightUtc(to);
  if (start.getTime() === end.getTime()) return 0;

  const backwards = end < start;
  const cursor = new Date(backwards ? end : start);
  const target = backwards ? start : end;
  let counted = 0;
  while (cursor.getTime() < target.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBusinessDay(cursor, calendar)) counted += 1;
  }
  return backwards ? -counted : counted;
}

/**
 * Assess a departure, with or without an external attestation.
 *
 * REFUSES ONLY WHERE THE RECORD WOULD BE A LIE, which is a much narrower set
 * than the old rule refused:
 *
 *   - An end date in the past with NO attestation. We would be recording that
 *     notice was given through us when it was not, and nothing would say
 *     otherwise.
 *   - An attestation naming a means that is not in the catalogue.
 *   - An attestation whose own notice date is after the departure AND is
 *     offered as though it were proper notice.
 *
 * Everything else is recorded, with the anomaly named.
 */
export function assessDeparture(input: {
  /** When this is being recorded. */
  now: Date;
  /** The practitioner's last day. */
  endsAt: Date;
  calendar: BusinessDayCalendar;
  external?: ExternalNoticeAttestation;
}): NoticeAssessment {
  const { now, endsAt, calendar, external } = input;
  const departed = atMidnightUtc(endsAt) < atMidnightUtc(now);

  if (!external) {
    if (departed) {
      throw new DepartureNoticeError(
        'This end date has already passed, so notice cannot have been given through AoBPlatform before ' +
          'it. If the practitioner was told outside the platform — in their contract, by letter, or in ' +
          'person — say so, and we will record that instead. Recording it as our own notice would be ' +
          'untrue, and leaving it unrecorded would leave them showing as still working here.',
      );
    }
    const lead = businessDaysBetween(now, endsAt, calendar);
    return {
      basis: 'platform',
      leadBusinessDays: lead,
      sufficientLead: lead >= TERMINATION_BUSINESS_DAYS,
      agreementsCeasedOn: atMidnightUtc(endsAt),
      anomaly:
        lead < TERMINATION_BUSINESS_DAYS
          ? `Notice gives ${lead} business day(s), short of the ${TERMINATION_BUSINESS_DAYS} the ` +
            'termination rules assume. Recorded as given.'
          : undefined,
    };
  }

  const means = externalNoticeMeans(external.means);
  if (!means) {
    throw new DepartureNoticeError(
      `"${external.means}" is not a way notice can have been given. One of: ${EXTERNAL_NOTICE_KEYS.join(', ')}.`,
    );
  }
  if (means.key === 'other' && !external.note?.trim()) {
    throw new DepartureNoticeError('Choosing "something else" means the note is the record. Describe what happened.');
  }

  const lead = businessDaysBetween(external.givenAt, endsAt, calendar);
  const sufficientLead = lead >= TERMINATION_BUSINESS_DAYS;

  let anomaly: string | undefined;
  if (lead < 0) {
    anomaly =
      'The attested notice is dated AFTER the practitioner left. The agreements ceased on their last ' +
      'day regardless; this records when the practice says they were told.';
  } else if (!sufficientLead) {
    anomaly =
      `The attested notice gives ${lead} business day(s), short of the ${TERMINATION_BUSINESS_DAYS} the ` +
      'termination rules assume.';
  }

  return {
    basis: 'external_attested',
    leadBusinessDays: lead,
    sufficientLead,
    agreementsCeasedOn: atMidnightUtc(endsAt),
    anomaly,
  };
}

/**
 * Does this departure need the practice to attest to notice given elsewhere?
 *
 * Used by the SCREEN to decide whether to show the tick box, so somebody is
 * asked at the point they can answer rather than refused after they submit.
 */
export function needsExternalAttestation(input: { now: Date; endsAt: Date }): boolean {
  return atMidnightUtc(input.endsAt) < atMidnightUtc(input.now);
}
