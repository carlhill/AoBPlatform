import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApprovedIdentifierType } from '@aobplatform/domain';

/**
 * Normalisation + constant-time comparison for stated identifiers (FR-3.1).
 * Values exist only inside this comparison — they are never stored, never
 * logged, never returned (REQ-VER-04, HARD-04).
 */

export interface PatientIdentityRecord {
  familyName: string;
  givenNames: string;
  dateOfBirth: Date;
  genderAsIdentified?: string | null;
  address?: string | null;
  patientRecordNumber?: string | null;
  ihi?: string | null;
}

function collapse(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A name is one identifier whichever way round it is said. The PMS holds
 * family name first; a patient types given name first. Sorting the tokens
 * makes the two orderings compare equal without weakening the match — the
 * same tokens still have to be present.
 */
function collapseName(value: string): string {
  return collapse(value).split(' ').sort().join(' ');
}

/** Normalises a held or stated value for one identifier type. Returns null when the record has no value to match. */
export function normalisedHeldValue(type: ApprovedIdentifierType, record: PatientIdentityRecord): string | null {
  switch (type) {
    case 'name':
      // Family + given names together count as ONE identifier (REQ-VER-02).
      return collapseName(`${record.familyName} ${record.givenNames}`);
    case 'date_of_birth':
      return record.dateOfBirth.toISOString().slice(0, 10);
    case 'gender':
      return record.genderAsIdentified ? collapse(record.genderAsIdentified) : null;
    case 'address':
      return record.address ? collapse(record.address).replace(/[.,]/g, '') : null;
    case 'patient_record_number':
      return record.patientRecordNumber ? record.patientRecordNumber.trim().toUpperCase() : null;
    case 'ihi':
      return record.ihi ? record.ihi.replace(/\D/g, '') : null;
  }
}

export function normaliseStatedValue(type: ApprovedIdentifierType, stated: string): string {
  switch (type) {
    case 'name':
      return collapseName(stated);
    case 'date_of_birth':
      return stated.trim().slice(0, 10);
    case 'gender':
      return collapse(stated);
    case 'address':
      return collapse(stated).replace(/[.,]/g, '');
    case 'patient_record_number':
      return stated.trim().toUpperCase();
    case 'ihi':
      return stated.replace(/\D/g, '');
  }
}

/** Constant-time equality over the normalised values — no early exit an attacker can time. */
export function constantTimeMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Evaluates ALL challenged identifiers (never short-circuits on first
 * mismatch — uniform timing) and reports only the aggregate. Which identifier
 * failed is never disclosed (REQ-SEC-07, FR-3.1).
 */
export function evaluateChallenge(
  types: readonly ApprovedIdentifierType[],
  stated: Readonly<Record<string, string>>,
  record: PatientIdentityRecord,
): boolean {
  let allMatch = true;
  for (const type of types) {
    const held = normalisedHeldValue(type, record);
    const statedRaw = stated[type];
    if (held === null || statedRaw === undefined || statedRaw.trim() === '') {
      allMatch = false;
      continue;
    }
    if (!constantTimeMatch(held, normaliseStatedValue(type, statedRaw))) {
      allMatch = false;
    }
  }
  return allMatch;
}
