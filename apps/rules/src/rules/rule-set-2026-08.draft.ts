/**
 * ⚠⚠ DRAFT s 65C RULE SET — AGENT-AUTHORED AT CARL'S EXPLICIT INSTRUCTION
 * (21 Aug 2026), PENDING LINE-BY-LINE HUMAN REVIEW against
 * `.claude/docs/aob-requirements.md` §3 (REQ-65C-01) BEFORE ANY REAL USE.
 *
 * The build-plan policy makes this a human-authored zone because a wrong rule
 * here is statutory exposure. Accordingly:
 *  - every rule below carries the REQ-65C-01 table row it implements and the
 *    regulation reference given IN THAT TABLE — nothing is from memory;
 *  - this set only registers when RULES_REGISTER_DRAFT_SET=true (dev), and
 *    logs a warning when it does; production default remains the honest 501;
 *  - two parameters the table does not fix are DRAFT DECISIONS flagged for
 *    review: the C2 future-date tolerance (200 days — must accommodate
 *    6-month treatment-plan pre-agreements, REQ-PLAN-01) and the C7 item
 *    format (1–5 digits, per MBS item number shape).
 *
 * The 34-test conformance suite (rule-set.contract.ts) was written FIRST,
 * from the table, and this implementation is verified against it unchanged.
 */
import type { RuleResult, ValidationStage } from '@aobplatform/contracts';
import type { RuleSet } from './rule-set';
import type { ValidationPayload } from './rules-payload';

/** Mapping content — versioned like the rule set (REQ-REG-03). */
export interface BasicServiceDescriptionMapping {
  readonly version: string;
  readonly descriptions: readonly string[];
}

/**
 * DEV mapping stub. The real mapping is the quarterly XML/CSV ingest from
 * MBS Online (1 Jan / 1 Mar / 1 Jul / 1 Nov, REQ-REG-03) with human-reviewed
 * diff — a Phase-0/1 job, not this file. Never ship a hand-typed mapping.
 */
export const DEV_MAPPING: BasicServiceDescriptionMapping = {
  version: 'dev-mapping-1',
  descriptions: [
    'General practitioner attendance',
    'Specialist attendance',
    'Allied health attendance',
    'Optometry attendance',
    'Nurse practitioner attendance',
  ],
};

/** C2 draft tolerance: how far in the future D2 may sit at validation time. REVIEW ITEM. */
export const AGREEMENT_DATE_FUTURE_TOLERANCE_DAYS = 200;

const FORBIDDEN_PRACTITIONER_SIGNATURE = /practitioner.?signature|provider.?signature/i;
const FORBIDDEN_BENEFIT_AMOUNT = /benefit.?amount|dollar.?amount|fee.?amount|rebate.?amount/i;
/** MBS item numbers are numeric, up to five digits (draft format rule — REVIEW ITEM). */
const MBS_ITEM_FORMAT = /^\d{1,5}$/;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findKeyDeep(value: unknown, pattern: RegExp): string | null {
  if (value === null || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key)) return key;
    const nested = findKeyDeep(child, pattern);
    if (nested) return nested;
  }
  return null;
}

export function createDraftRuleSet2026_08(
  mapping: BasicServiceDescriptionMapping = DEV_MAPPING,
  now: () => Date = () => new Date(),
): RuleSet {
  return {
    version: 'draft-2026-08',
    mappingVersion: mapping.version,

    evaluate(payload: ValidationPayload, stage: ValidationStage = 'storage'): RuleResult[] {
      const preSignature = stage === 'pre_signature';
      const results: RuleResult[] = [];
      const push = (rule: string, ok: boolean, failOutcome: 'fail' | 'warn', message: string, citation: string) =>
        results.push({ rule, outcome: ok ? 'pass' : failOutcome, message, citation });

      const isPre = payload.agreementType === 'episodic_pre' || payload.agreementType === 'treatment_plan';
      const isPost = payload.agreementType === 'episodic_post';
      const agreementDate = parseDate(payload.agreementDate);
      const serviceDate = parseDate(payload.serviceDate);

      // C1 — D1 patient name present and non-empty. Block. (s 65C(4), REQ-REG-01 D1)
      push(
        'C1',
        typeof payload.patientName === 'string' && payload.patientName.trim().length > 0,
        'fail',
        'D1: the name of the person to whom the service is rendered must be present and non-empty.',
        's 65C(4); REQ-REG-01 D1',
      );

      // C2 — D2 agreement date present, valid, not future-dated beyond tolerance. Block.
      const withinTolerance =
        agreementDate !== null &&
        agreementDate.getTime() <= now().getTime() + AGREEMENT_DATE_FUTURE_TOLERANCE_DAYS * 86_400_000;
      push(
        'C2',
        withinTolerance,
        'fail',
        'D2: the date the agreement is proposed to be entered into must be present, valid, and not future-dated beyond tolerance.',
        's 65C(4); REQ-REG-01 D2',
      );

      // C3 — D3 pre/post flag set explicitly. Block.
      push(
        'C3',
        payload.agreementType !== undefined,
        'fail',
        'D3: whether this is an episodic pre-agreement or post-agreement must be stated explicitly.',
        's 65C(4); REQ-REG-01 D3',
      );

      // C4 — D4 satisfies s 65C(5)(a) name+address OR (b) provider number. Block.
      const hasNameAndAddress =
        typeof payload.providerName === 'string' &&
        payload.providerName.trim().length > 0 &&
        typeof payload.providerAddress === 'string' &&
        payload.providerAddress.trim().length > 0;
      const hasProviderNumber = typeof payload.providerNumber === 'string' && payload.providerNumber.trim().length > 0;
      push(
        'C4',
        hasNameAndAddress || hasProviderNumber,
        'fail',
        'D4: provider identification requires either name AND place-of-practice address, or a provider number (a provider number is NOT mandatory).',
        's 65C(5)(a)/(b); REQ-REG-02',
      );

      // C5 — D5 service date present; consistent with D3 relative to the
      // agreement date (pre ⇒ on/after D2, post ⇒ on/before D2). Block.
      let c5ok = serviceDate !== null;
      if (c5ok && agreementDate !== null) {
        if (isPre) c5ok = serviceDate!.getTime() >= agreementDate.getTime();
        if (isPost) c5ok = serviceDate!.getTime() <= agreementDate.getTime();
      }
      push(
        'C5',
        c5ok,
        'fail',
        'D5: the service date must be present and consistent with the agreement type (pre: on/after the agreement date; post: on/before).',
        's 65C(4); REQ-REG-01 D5',
      );

      // C6 — pre only: basic description present and drawn from the current mapping. Block.
      if (isPre) {
        const description = payload.basicServiceDescription;
        push(
          'C6',
          typeof description === 'string' && mapping.descriptions.includes(description),
          'fail',
          `D6a: a pre-agreement requires a basic service description drawn from the current mapping (version ${mapping.version}).`,
          's 65C(4); REQ-REG-03',
        );
      } else {
        push('C6', true, 'fail', 'D6a applies to pre-agreements only.', 'REQ-REG-03');
      }

      // C7 — post only: at least one valid MBS item number. Block.
      if (isPost) {
        const items = payload.mbsItemNumbers ?? [];
        push(
          'C7',
          items.length > 0 && items.every((i) => MBS_ITEM_FORMAT.test(i)),
          'fail',
          'D6b: a post-agreement requires at least one valid MBS item number.',
          's 65C(4); REQ-REG-01 D6b',
        );
      } else {
        push('C7', true, 'fail', 'D6b applies to post-agreements only.', 'REQ-REG-01 D6b');
      }

      // C8 — D7 assignor flag explicit; if not the patient, name and relationship present. Block.
      const c8ok =
        payload.assignorIsPatient === true ||
        (payload.assignorIsPatient === false &&
          typeof payload.assignorName === 'string' &&
          payload.assignorName.trim().length > 0 &&
          typeof payload.assignorRelationship === 'string' &&
          payload.assignorRelationship.trim().length > 0);
      push(
        'C8',
        c8ok,
        'fail',
        'D7: whether the assignor is the patient must be stated explicitly; a third-party assignor requires name and relationship.',
        's 65C(6)(b); REQ-REG-01 D7, REQ-REG-05',
      );

      // C9 — signature present, non-empty, with capture method recorded. Block.
      // At the pre-signature stage no signature can exist yet — the whole
      // point of locking first — so C9 defers to the storage pass.
      push(
        'C9',
        preSignature || (payload.signaturePresent === true && payload.signatureMethod !== undefined),
        'fail',
        preSignature
          ? 'Signature obligations are asserted at the storage pass (pre-signature stage).'
          : 'A signature must be present with its capture method recorded.',
        's 65C(6); REQ-REG-05, REQ-SIG-01',
      );

      // C10 — no practitioner signature collected. Block (defensive; abolished 1 Jul 2026).
      const c10key = findKeyDeep(payload, FORBIDDEN_PRACTITIONER_SIGNATURE);
      push(
        'C10',
        c10key === null,
        'fail',
        c10key
          ? `Practitioner signatures were abolished on 1 July 2026 — remove field "${c10key}".`
          : 'No practitioner signature is collected.',
        'REQ-REG-05',
      );

      // C11 — no benefit/dollar amount in the artefact. WARN.
      const c11key = findKeyDeep(payload, FORBIDDEN_BENEFIT_AMOUNT);
      push(
        'C11',
        c11key === null,
        'warn',
        c11key
          ? `The s 65C data set contains no benefit or dollar amount — field "${c11key}" is unnecessary risk.`
          : 'No benefit or dollar amount appears in the artefact.',
        'REQ-REG-04',
      );

      // C12 — particulars locked before the signature timestamp. Block (the
      // REQ-REG-06 offence). The lock timestamp is created BY the lock this
      // pre-signature pass gates, so C12 defers to the storage pass.
      const lockedAt = parseDate(payload.particularsLockedAt);
      const signedAt = parseDate(payload.signatureTimestamp);
      const c12ok =
        preSignature || (lockedAt !== null && (signedAt === null || lockedAt.getTime() <= signedAt.getTime()));
      push(
        'C12',
        c12ok,
        'fail',
        preSignature
          ? 'The lock-before-signature ordering is asserted at the storage pass (pre-signature stage).'
          : 'All particulars must be complete and locked before the signature — signing a draft is the offence.',
        'REQ-REG-06; MBS Note AN.0.18',
      );

      // C13 — verification event present and passed. WARN (our standard, not law).
      push(
        'C13',
        payload.verificationPassed === true,
        'warn',
        'Identity verification is our standard (ETA s 10 "reliably identify the assignor"; RACGP C6.1A) — not legally required, recorded as a warning.',
        'REQ-VER-01, REQ-VER-07',
      );

      // C14 — agreement created before claim lodgement, where observable. WARN.
      const lodgedAt = parseDate(payload.claimLodgedAt);
      const c14ok = lodgedAt === null || (agreementDate !== null && agreementDate.getTime() <= lodgedAt.getTime());
      push(
        'C14',
        c14ok,
        'warn',
        'Where lodgement is observable, the agreement should predate the claim.',
        'REQ-65C-01 C14',
      );

      return results;
    },
  };
}
