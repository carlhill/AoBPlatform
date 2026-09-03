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
 * THE REFUSAL NAMES THE RULE, NOT THE PERSON (revised, Carl, 3 Sep 2026 live
 * test). Earlier copy pointed at the desk and stopped there, on the reasoning
 * that naming the rule teaches how to get around it. Live testing surfaced the
 * cost of that: a blocked practice-staff member has no way to tell a genuine
 * refusal from a broken tablet. `blockedBody` now says plainly that practice
 * staff cannot sign for a patient — it still never says WHICH name matched or
 * how the match was made (that stays REQ-VER-04/-VUL-04 territory), so the
 * part of the rule worth protecting is still protected.
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

/**
 * THE LIVE GATE FOR THE "SOMEONE ELSE" BRANCH — the single source of truth
 * behind both the `GuardedButton` on K-5 (which must be disabled, with a
 * reason, before anybody presses Continue — CLAUDE.md §6: blocked states are
 * unreachable, not merely inert) and `decideAssignor`'s final allow/refuse
 * call below, so the two can never drift apart on what counts as blocked.
 *
 * Every applicable reason is returned, not just the first — a person missing
 * both their name and the 18+ tick should see both, the same way
 * `SignatureControl`'s blocked state lists everything outstanding at once.
 * `explanation`, unlike `reasons`, is the longer staff-refusal paragraph and
 * is populated ONLY for the staff match — the incomplete-details and
 * unticked-age cases need no more than their short reason.
 */
export type AssignorGate =
  | { readonly state: 'valid' }
  | {
      readonly state: 'blocked';
      readonly reasons: readonly string[];
      readonly explanation: string | null;
    };

export function evaluateAssignorGate(input: {
  readonly choice: AssignorChoice;
  /** From `GET /practice-users`, held in memory for the session only. */
  readonly practiceStaffNames: readonly string[];
  readonly practiceName: string;
}): AssignorGate {
  const { choice, practiceStaffNames, practiceName } = input;

  // The patient signing for themselves is never gated here: the kiosk holds
  // no date of birth, so the only check it could ever run client-side is
  // deferred to the server (see `decideAssignor`).
  if (choice.assignorIsPatient) return { state: 'valid' };

  const reasons: string[] = [];

  const detailsMissing = choice.otherName.trim().length === 0 || choice.otherRelationship.trim().length === 0;
  if (detailsMissing) reasons.push(strings.assignor.reasonDetailsNeeded);

  // Staff match runs whether or not the age box is ticked, so a staff member
  // who is also under-declared still gets told about the rule that actually
  // stops them.
  const staffBlocked = matchesPracticeStaff(choice.otherName, practiceStaffNames);
  if (staffBlocked) reasons.push(strings.assignor.reasonStaffBlocked);

  if (!choice.otherDeclaredOfAge) reasons.push(strings.assignor.reasonAgeNeeded);

  if (reasons.length === 0) return { state: 'valid' };
  return {
    state: 'blocked',
    reasons,
    explanation: staffBlocked ? strings.assignor.blockedBody(practiceName) : null,
  };
}

export function decideAssignor(input: {
  readonly choice: AssignorChoice;
  /** From `GET /practice-users`, held in memory for the session only. */
  readonly practiceStaffNames: readonly string[];
  readonly practiceName: string;
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

  const gate = evaluateAssignorGate({
    choice,
    practiceStaffNames: input.practiceStaffNames,
    practiceName: input.practiceName,
  });
  if (gate.state === 'blocked') {
    return { allowed: false, message: gate.explanation ?? gate.reasons[0] ?? strings.assignor.detailsNeeded };
  }
  return { allowed: true, selfAssignAgeCheckedBy: 'kiosk' };
}
