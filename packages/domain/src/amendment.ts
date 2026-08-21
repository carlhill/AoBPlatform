/**
 * Applicant amendments.
 *
 * An applicant who mistypes their own phone number should not have to be
 * rejected and reapply. But letting them edit a submitted application is not a
 * small convenience feature — it is a change to the evidence model, and three
 * rules keep it from becoming a fraud vector.
 *
 * 1. THE ABN IS NOT AMENDABLE.
 *
 *    Everything hangs off it. The checksum gate, the register lookup, the name
 *    match, the entity type, the ACN derivation — all of it is about ONE legal
 *    entity, and the reviewer's judgement is about whether this applicant may
 *    act for THAT entity. Change the ABN and none of that carries over; you are
 *    not correcting an application, you are making a different one against a
 *    different entity while keeping the history of the first.
 *
 *    That is the exact shape of the attack: submit against a clean entity, wait
 *    for the checks to pass, then quietly move the application to the entity you
 *    actually wanted. So the ABN is fixed at submission and a new entity is a
 *    new application, with its own reference and its own review.
 *
 * 2. AN AMENDMENT IS APPENDED, NEVER APPLIED IN PLACE.
 *
 *    The reviewer's dossier says these values are the evidence under review. If
 *    an applicant could overwrite them, "as submitted" would be a lie and a
 *    check recorded against a value would point at nothing. Every amendment
 *    keeps the previous value, and the trail is part of the record.
 *
 * 3. AMENDING AFTER A CHECK HAS RUN IS FLAGGED, LOUDLY.
 *
 *    A reviewer rings the practice, confirms the applicant, records a passed
 *    check — and the applicant then changes the phone number that was verified.
 *    Nothing about that is impossible or even necessarily dishonest, but the
 *    reviewer must be told, because their check now attests to a value the
 *    application no longer contains. We do not silently invalidate the check
 *    (that would discard real work on a probably-innocent typo) and we do not
 *    silently keep it either. We say what happened and let the human decide.
 *
 * What amendment is NOT: a way to change a decision. Once an application is
 * validated or rejected it is closed. A rejected applicant reapplies; an
 * approved practice uses the console, where changes are made by a named admin
 * against an authenticated session.
 */

export class AmendmentError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'AmendmentError';
  }
}

/**
 * What an applicant may correct.
 *
 * Contact details and the address, because those are where typos live and
 * where a typo is most costly — an unreachable applicant is an application
 * that stalls. The practice NAME is included because it is matched against the
 * register rather than trusted, so a correction there is re-checked, not
 * accepted.
 *
 * Deliberately absent: abn, entityType, legalName, abnStatus, and every value
 * derived from the register. The applicant does not get to restate what the
 * register says — that is what the register is for.
 */
export const AMENDABLE_FIELDS = [
  'name',
  'website',
  'adminName',
  'adminEmail',
  'adminPhone',
  'adminPosition',
  'managerName',
  'managerEmail',
  'managerPhone',
  'managerPosition',
  'headOfficeLine1',
  'headOfficeLine2',
  'headOfficeSuburb',
  'headOfficeState',
  'headOfficePostcode',
  'statedPractitionerCount',
] as const;

export type AmendableField = (typeof AMENDABLE_FIELDS)[number];

/** Fields that are explicitly refused, with the reason the applicant sees. */
export const LOCKED_FIELDS: Record<string, string> = {
  abn: 'The ABN cannot be changed. Every check runs against one legal entity, so a different ABN is a different application — apply again and it gets its own review.',
  acn: 'The ACN is derived from the ABN and is not entered by hand.',
  legalName: 'The legal name comes from the Australian Business Register, not from the application.',
  entityType: 'The entity type comes from the Australian Business Register, not from the application.',
  abnStatus: 'The ABN status comes from the Australian Business Register, not from the application.',
  validationState: 'Only a reviewer decides an application.',
};

export function isAmendable(field: string): field is AmendableField {
  return (AMENDABLE_FIELDS as readonly string[]).includes(field);
}

/**
 * Which checks a given field bears on.
 *
 * Used to tell the reviewer that an amendment touched something they had
 * already verified. It is deliberately GENEROUS: a field maps to a check if a
 * reasonable reviewer would feel misled to learn it had changed after they
 * signed the check off. Over-flagging costs a moment's reading; under-flagging
 * costs the whole point of the flag.
 */
const FIELD_BEARS_ON: Record<string, readonly string[]> = {
  name: ['entity.abn_active'],
  website: ['entitlement.domain_match'],
  adminEmail: ['entitlement.domain_match', 'reputation.disposable_email', 'reputation.repeat_applicant'],
  adminPhone: ['entitlement.phone_call', 'reputation.repeat_applicant'],
  adminName: ['entitlement.phone_call', 'entitlement.video_call', 'entitlement.document', 'entitlement.hpio_delegation'],
  managerName: ['entitlement.video_call'],
  managerEmail: ['reputation.repeat_applicant'],
  managerPhone: ['reputation.repeat_applicant'],
  headOfficeLine1: ['address.confirmed', 'address.ahpra_locality_match'],
  headOfficeSuburb: ['address.confirmed', 'address.ahpra_locality_match'],
  headOfficeState: ['address.confirmed', 'address.ahpra_locality_match'],
  headOfficePostcode: ['address.confirmed', 'address.ahpra_locality_match'],
};

export interface AmendmentChange {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * The difference between what was submitted and what is being proposed.
 *
 * Only genuinely changed values are returned. A form that posts every field
 * back would otherwise record sixteen "changes" of which fifteen are the same
 * value, burying the one that moved.
 */
export function diffApplication(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): AmendmentChange[] {
  const changes: AmendmentChange[] = [];
  for (const field of AMENDABLE_FIELDS) {
    // ABSENT IS NOT CLEARED. A DTO instance carries every declared optional
    // property as `undefined`, so `field in proposed` is true for all sixteen
    // even when the caller sent one. Treating that as "set to nothing" wiped
    // an entire application on the first live amendment — one field submitted,
    // fifteen destroyed.
    //
    // So: `undefined` means the caller is not touching this field, and an
    // explicit empty string means clear it. Those are genuinely different
    // intentions and the wire format has to keep them apart.
    if (proposed[field] === undefined) continue;

    const before = normalise(current[field]);
    const after = normalise(proposed[field]);
    if (before !== after) changes.push({ field, from: before, to: after });
  }
  return changes;
}

function normalise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

/**
 * Which already-recorded checks an amendment bears on.
 *
 * Returns the check keys a reviewer had recorded that the changed fields
 * relate to. Empty means nothing recorded is affected — either because no
 * check has run, or because the fields that moved bear on none of them.
 */
export function checksAffectedBy(
  changes: readonly AmendmentChange[],
  recordedCheckKeys: readonly string[],
): string[] {
  const affected = new Set<string>();
  for (const change of changes) {
    for (const key of FIELD_BEARS_ON[change.field] ?? []) {
      if (recordedCheckKeys.includes(key)) affected.add(key);
    }
  }
  return [...affected].sort();
}

export interface AmendmentRequest {
  readonly validationState: string;
  readonly changes: readonly AmendmentChange[];
}

/**
 * Server-side gate. The form refuses these too; the form is not the boundary.
 */
export function assertAmendmentAllowed(request: AmendmentRequest): void {
  if (request.validationState !== 'pending') {
    throw new AmendmentError(
      'FR-1.10',
      request.validationState === 'validated'
        ? 'This practice has already been approved. Changes are made in the console, by a named admin, not ' +
          'through the application link.'
        : 'This application has already been decided and cannot be amended. If you believe the decision was ' +
          'wrong, reply to the email you were sent.',
    );
  }

  if (request.changes.length === 0) {
    throw new AmendmentError('FR-1.10', 'Nothing was changed, so there is nothing to submit.');
  }

  for (const change of request.changes) {
    if (change.field in LOCKED_FIELDS) {
      throw new AmendmentError('FR-1.10', LOCKED_FIELDS[change.field]);
    }
    if (!isAmendable(change.field)) {
      throw new AmendmentError('FR-1.10', `"${change.field}" is not a field an applicant can amend.`);
    }
  }
}
