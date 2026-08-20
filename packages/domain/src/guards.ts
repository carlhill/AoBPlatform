/**
 * Structural hard-rule guards (CLAUDE.md §2). These are domain invariants —
 * narrow, self-evident checks that must hold everywhere. They are NOT the
 * s 65C rules engine (rules C1–C14 live in apps/rules and are human-authored;
 * build-plan policy). Every guard here has a named test in hard-rules.test.ts.
 */
import type { AgreementType, EnduringPathway } from './agreement';
import type { ProviderType } from './parties';

/** Statutory dates. These are law, not configuration — rule-set thresholds live in versioned content (rule 14). */
export const VERBAL_FALLBACK_END_DATE = '2027-06-30'; // REQ-REG-10: auto-disables after this date

export class HardRuleViolation extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'HardRuleViolation';
  }
}

// ---------------------------------------------------------------------------
// Rule 2 / REQ-REG-06 / HARD-05 — particulars complete and locked before signature.
// Signing a draft is the criminal offence in this regime.
// ---------------------------------------------------------------------------

export interface SignatureGateState {
  readonly particularsPresent: boolean;
  readonly particularsLocked: boolean;
  readonly validationPassed: boolean;
}

/** The ONLY way any surface may decide whether the signature control enables. */
export function canEnableSignature(state: SignatureGateState): boolean {
  return state.particularsPresent && state.particularsLocked && state.validationPassed;
}

export function assertSignatureAllowed(state: SignatureGateState): void {
  if (!canEnableSignature(state)) {
    throw new HardRuleViolation(
      'REQ-REG-06',
      'Signature capture against an unvalidated or unlocked payload is structurally forbidden (HARD-05).',
    );
  }
}

// ---------------------------------------------------------------------------
// Rules 3 & 4 — no practitioner signature field; no benefit/dollar amount on
// any agreement artefact (abolished 1 Jul 2026 / REQ-REG-04). Defensive
// structural check over arbitrary payloads entering the agreement path.
// ---------------------------------------------------------------------------

const FORBIDDEN_KEY_PATTERNS: ReadonlyArray<{ rule: string; pattern: RegExp; reason: string }> = [
  {
    rule: 'C10',
    pattern: /practitioner.?signature|provider.?signature/i,
    reason: 'The practitioner signature was abolished on 1 July 2026. No such field may exist.',
  },
  {
    rule: 'REQ-REG-04',
    pattern: /benefit.?amount|dollar.?amount|fee.?amount|rebate.?amount/i,
    reason:
      'No benefit or dollar amount appears on any agreement artefact. ' +
      '(Reg 89AA notices are the one place a benefit amount appears — and they are not agreements.)',
  },
  {
    rule: 'HARD-03',
    pattern: /medicare.?(card)?.?number/i,
    reason: 'The Medicare card number is never stored and is not an identifier (REQ-VER-02).',
  },
];

/** Recursively asserts a payload carries none of the forbidden fields. */
export function assertNoForbiddenAgreementFields(payload: unknown, path = ''): void {
  if (payload === null || typeof payload !== 'object') return;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const keyPath = path ? `${path}.${key}` : key;
    for (const { rule, pattern, reason } of FORBIDDEN_KEY_PATTERNS) {
      if (pattern.test(key)) {
        throw new HardRuleViolation(rule, `Forbidden field "${keyPath}": ${reason}`);
      }
    }
    assertNoForbiddenAgreementFields(value, keyPath);
  }
}

// ---------------------------------------------------------------------------
// Rule 5 / REQ-REG-10 — verbal capture until 30 June 2027, then auto-disabled;
// explicit override with recorded reason afterwards.
// ---------------------------------------------------------------------------

export function isVerbalCaptureAllowed(onDate: string, override?: { reason: string }): boolean {
  if (onDate <= VERBAL_FALLBACK_END_DATE) return true;
  return override !== undefined && override.reason.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Rule 6 / REQ-END-01a — enduring agreements are GP-only, and the organisation
// anchor exists only on the ACCHO/AMS pathway.
// ---------------------------------------------------------------------------

export function canOfferEnduring(providerType: ProviderType): boolean {
  return providerType === 'general_practitioner';
}

export function assertEnduringAllowed(providerType: ProviderType, pathway: EnduringPathway): void {
  if (!canOfferEnduring(providerType)) {
    throw new HardRuleViolation(
      'REQ-END-01a',
      `Enduring agreements are GP-only; provider type "${providerType}" has no enduring pathway. ` +
        'Offer a Treatment Plan Assignment instead (REQ-PLAN-06).',
    );
  }
  void pathway;
}

export function validAnchorKindFor(type: AgreementType, pathway?: EnduringPathway): 'provider' | 'organisation' {
  if (type === 'enduring' && pathway === 'accho_ams') return 'organisation';
  return 'provider';
}

// ---------------------------------------------------------------------------
// Rule 10 / REQ-AGE-01/-02, REQ-VUL-04 — assignor age rules and the
// practice-staff hard block. The UI never asks staff to assess capacity
// (REQ-VUL-05) — note there is no capacity parameter here, deliberately.
// ---------------------------------------------------------------------------

export const MIN_AGE_SELF_ASSIGN = 14;
export const MIN_AGE_ASSIGN_FOR_OTHER = 18;

export function canActAsAssignor(input: {
  readonly selfAssigning: boolean;
  readonly ageYears: number;
  readonly isPracticeStaffOfProvider: boolean;
}): { allowed: boolean; rule?: string; reason?: string } {
  if (input.isPracticeStaffOfProvider) {
    return {
      allowed: false,
      rule: 'REQ-VUL-04',
      reason: 'Practice-staff assignors are hard-blocked against the staff list (Departmental FAQ).',
    };
  }
  if (input.selfAssigning) {
    return input.ageYears >= MIN_AGE_SELF_ASSIGN
      ? { allowed: true }
      : { allowed: false, rule: 'REQ-AGE-02', reason: `A patient may self-assign from age ${MIN_AGE_SELF_ASSIGN}.` };
  }
  return input.ageYears >= MIN_AGE_ASSIGN_FOR_OTHER
    ? { allowed: true }
    : {
        allowed: false,
        rule: 'REQ-AGE-01',
        reason: `An assignor acting for another person must be ${MIN_AGE_ASSIGN_FOR_OTHER}+ (platform policy, above the regulatory floor).`,
      };
}
