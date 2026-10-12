/**
 * REQ-REG-06 / HARD-05 — the signature control cannot enable until the payload
 * validates and the particulars are locked. Signing a draft is the criminal
 * offence in this regime, so this is a type, not a check.
 *
 * HOW THE TYPE DOES THE WORK. `SignatureValidation` is a discriminated union
 * with exactly one state that carries permission to sign. `SignatureControl`
 * takes it as a REQUIRED prop with no default, and reaches its enabled branch
 * only under `state === 'valid'`. There is therefore no code path — not a
 * default parameter, not an optional prop, not a `??` — that renders an
 * enabled control from an invalid payload: the enabled branch is unreachable
 * without a value that only `evaluateSignatureGate` can produce.
 *
 * The blocked state NAMES WHAT IS MISSING rather than merely refusing, because
 * a control that says "no" and nothing else sends the patient to a staff
 * member who also cannot see why.
 *
 * The decision itself is delegated to `canEnableSignature` in
 * @aobplatform/domain — the same function the server calls before it will
 * accept a signature. One rule, one implementation, enforced twice.
 */
import { canEnableSignature } from '@aobplatform/domain';

/** What the kiosk knows about an agreement, as `GET /agreements/:id` returns it. */
export interface AgreementGateFacts {
  readonly status: string;
  readonly particulars: unknown;
  readonly particularsLockedAt: string | null;
  /** Set by the server when the rules engine passed at lock time (rule 14). */
  readonly ruleSetVersion: string | null;
  readonly renderedArtefactHash: string | null;
}

export type SignatureValidation =
  /** The lock/validate round trip has not answered yet. Never enables. */
  | { readonly state: 'validating' }
  /** Named, ordered reasons. Never enables. */
  | { readonly state: 'blocked'; readonly reasons: readonly string[] }
  /** The ONLY state from which the control may enable. */
  | { readonly state: 'valid'; readonly artefactHash: string; readonly ruleSetVersion: string };

/**
 * The only sanctioned way any surface may decide whether the signature
 * control enables. Returns `valid` only when the domain guard agrees AND the
 * artefact that was hashed at lock actually exists to bind the signature to
 * (rule 13 — the signature binds a hash, so there must be one).
 */
export function evaluateSignatureGate(facts: AgreementGateFacts): SignatureValidation {
  const particularsPresent = facts.particulars !== null && facts.particulars !== undefined;
  const particularsLocked = facts.particularsLockedAt !== null;
  const validationPassed = facts.ruleSetVersion !== null;

  if (canEnableSignature({ particularsPresent, particularsLocked, validationPassed })) {
    if (!facts.renderedArtefactHash) {
      return { state: 'blocked', reasons: [GATE_REASONS.noArtefact] };
    }
    if (facts.status !== 'awaiting_signature') {
      return { state: 'blocked', reasons: [GATE_REASONS.notAwaitingSignature] };
    }
    return {
      state: 'valid',
      artefactHash: facts.renderedArtefactHash,
      ruleSetVersion: facts.ruleSetVersion as string,
    };
  }

  const reasons: string[] = [];
  if (!particularsPresent) reasons.push(GATE_REASONS.noParticulars);
  if (!particularsLocked) reasons.push(GATE_REASONS.notLocked);
  if (!validationPassed) reasons.push(GATE_REASONS.notValidated);
  return { state: 'blocked', reasons };
}

/**
 * Reasons are engineering-legible, not patient-legible: they are shown to
 * whoever is standing at the tablet so a staff member can act on them, and
 * they never name a patient detail value.
 */
export const GATE_REASONS = {
  noParticulars: 'The particulars have not been assembled yet',
  notLocked: 'The particulars are not locked',
  notValidated: 'The s 65C check has not passed',
  noArtefact: 'No rendered document to bind the signature to',
  notAwaitingSignature: 'This agreement is not at the signing step',
} as const;

/** True only for the one state that carries permission. Used by the control and by its test. */
export function isSignable(validation: SignatureValidation): validation is Extract<
  SignatureValidation,
  { state: 'valid' }
> {
  return validation.state === 'valid';
}

/** How many things are outstanding — the number the disabled label carries. */
export function blockingCount(validation: SignatureValidation): number {
  if (validation.state === 'blocked') return validation.reasons.length;
  return validation.state === 'validating' ? 1 : 0;
}
