/**
 * Who may sign — the age gates and the practice-staff hard block (REQ-VUL-04,
 * REQ-VUL-05, REQ-AGE-01/-02, addendum v4).
 *
 * THE THRESHOLDS ARE IMPORTED, NEVER TYPED. `MIN_AGE_SELF_ASSIGN` (14) and
 * `MIN_AGE_ASSIGN_FOR_OTHER` (18) come from @aobplatform/domain, and the
 * decision itself is `canActAsAssignor` — the same function the rest of the
 * platform uses. A literal 14 or 18 anywhere in this app would be a bug: the
 * threshold moved once already (Carl corrected 18 to 14 on 25 Aug 2026) and
 * the point of the constant is that such a correction lands everywhere at once.
 *
 * THERE IS NO CAPACITY PARAMETER, here or in the domain function, and no
 * control on any screen that asks a staff member to judge whether a patient
 * can consent (REQ-VUL-05). The absence is the requirement.
 *
 * THE PATIENT'S AGE IS NOT ON THIS DEVICE, and that is deliberate: the kiosk
 * waiting list carries a name, a provider and a time, and no date of birth
 * (`projectKioskWaitingRow`). So the self-assign gate is evaluated by the
 * SERVER, which holds the record — the kiosk reports `deferred` rather than
 * inventing an answer or, worse, blocking every patient because it cannot see
 * one. The gate it CAN evaluate is the one whose input the person in front of
 * it supplies: somebody signing for another person declares they are of age,
 * and that declaration is checked against the domain constant.
 *
 * THE REFUSAL COPY IS NEUTRAL. It points at the desk. It does not say "you are
 * staff", does not name REQ-VUL-04, and does not explain the rule to the
 * patient — a refusal that teaches the rule teaches how to get around it.
 */
import {
  canActAsAssignor,
  MIN_AGE_ASSIGN_FOR_OTHER,
  MIN_AGE_SELF_ASSIGN,
} from '@aobplatform/domain';
import { strings } from '../strings';

export { MIN_AGE_ASSIGN_FOR_OTHER, MIN_AGE_SELF_ASSIGN };

export interface AssignorChoice {
  /** D7 — explicit, never inferred from anything else (CLAUDE.md §3). */
  readonly assignorIsPatient: boolean;
  readonly otherName: string;
  readonly otherRelationship: string;
  /** The declaration made on screen, not a stored date of birth. */
  readonly otherDeclaredOfAge: boolean;
}

export type AssignorDecision =
  | { readonly allowed: true; readonly selfAssignAgeCheckedBy: 'server' | 'kiosk' }
  | { readonly allowed: false; readonly message: string };

/**
 * Matches a typed name against the practice's own staff list. Case- and
 * whitespace-insensitive, because "mai nguyen" and "Mai  Nguyen" are the same
 * person and a block that a different capitalisation walks through is not a
 * block.
 */
export function matchesPracticeStaff(name: string, staffNames: readonly string[]): boolean {
  const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const candidate = normalise(name);
  if (candidate.length === 0) return false;
  return staffNames.some((staff) => normalise(staff) === candidate);
}

export function decideAssignor(input: {
  readonly choice: AssignorChoice;
  /** From `GET /practice-users`, held in memory for the session only. */
  readonly practiceStaffNames: readonly string[];
  /** Null whenever the device does not hold it — which is always, by design. */
  readonly patientAgeYears: number | null;
}): AssignorDecision {
  const { choice } = input;

  if (choice.assignorIsPatient) {
    if (input.patientAgeYears === null) {
      // Deferred to the server, which holds the date of birth and re-checks
      // at lock and again at storage. The kiosk claims no decision it cannot
      // make, and it does not stop the patient while it cannot make it.
      return { allowed: true, selfAssignAgeCheckedBy: 'server' };
    }
    const verdict = canActAsAssignor({
      selfAssigning: true,
      ageYears: input.patientAgeYears,
      isPracticeStaffOfProvider: false,
    });
    return verdict.allowed
      ? { allowed: true, selfAssignAgeCheckedBy: 'kiosk' }
      : { allowed: false, message: strings.assignor.tooYoungSelf };
  }

  if (choice.otherName.trim().length === 0 || choice.otherRelationship.trim().length === 0) {
    return { allowed: false, message: strings.assignor.detailsNeeded };
  }

  // The staff block runs BEFORE the age gate, so a staff member who is also
  // under age gets the staff refusal rather than a message that tells them
  // their age was the problem.
  if (matchesPracticeStaff(choice.otherName, input.practiceStaffNames)) {
    return { allowed: false, message: strings.assignor.blockedBody };
  }

  const verdict = canActAsAssignor({
    selfAssigning: false,
    // The declaration is the input, mapped onto the domain threshold rather
    // than compared against a number typed here.
    ageYears: choice.otherDeclaredOfAge ? MIN_AGE_ASSIGN_FOR_OTHER : 0,
    isPracticeStaffOfProvider: false,
  });
  return verdict.allowed
    ? { allowed: true, selfAssignAgeCheckedBy: 'kiosk' }
    : { allowed: false, message: strings.assignor.tooYoungOther };
}
