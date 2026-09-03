/**
 * Who may sign — the relationship, the age gate, the contact requirement and
 * the practice-staff hard block (REQ-VUL-01/-04/-05, REQ-AGE-01/-02,
 * REQ-REG-08, addendum v4).
 *
 * NOTHING LEGAL IS DECIDED IN THIS FILE, and that is the design. The
 * thresholds (`MIN_AGE_SELF_ASSIGN` 14, `MIN_AGE_ASSIGN_FOR_OTHER` 18), the
 * fixed authority list, the staff-name comparison and the relationship →
 * authority-basis mapping all come from `@aobplatform/domain`, and the mapping
 * itself comes from versioned CONTENT behind it
 * (`packages/domain/content/assignor-relationships.json`). A literal 14 or 18
 * here would be a bug — the threshold moved once already, when Carl corrected
 * 18 to 14 on 25 Aug 2026 — and a mapping here would be the third copy of the
 * mistake hard rule 14 exists to prevent. The server runs the identical
 * refusals inside `buildAssignorForAnother` before it will re-point an
 * agreement, so two copies of a rule would be two chances to disagree.
 *
 * THE SCREEN ASKS THE RELATIONSHIP, NEVER THE AUTHORITY BASIS. The person
 * standing beside the patient knows they are a grandparent; they do not know
 * whether that makes them a "co-resident relative 18+". So the dropdown offers
 * the content file's relationships, in the content file's order, and
 * `authorityBasisFor` derives the basis — which is then sent alongside the
 * relationship, because REQ-VUL-01 names them as separate attributes and C8
 * prints the relationship on the agreement.
 *
 * THERE IS NO CAPACITY PARAMETER, here or in the domain functions, and no
 * control on any screen that asks a staff member to judge whether a patient
 * can consent (REQ-VUL-05). The absence is the requirement.
 *
 * THE PATIENT'S AGE IS NOT ON THIS DEVICE, deliberately: the kiosk waiting list
 * carries a name, a provider and a time, and no date of birth
 * (`projectKioskWaitingRow`). So the self-assign gate is evaluated by the
 * SERVER, which holds the record — the kiosk reports `deferred` rather than
 * inventing an answer or, worse, blocking every patient because it cannot see
 * one. The gate it CAN evaluate is the one whose input the person in front of
 * it supplies: somebody signing for another person declares they are of age.
 *
 * THE STAFF REFUSAL STATES THE MATCH, IT DOES NOT ACCUSE (Carl, 3 Sep 2026).
 * The block is NAME-BASED and can therefore hit an innocent namesake, so
 * `blockedBody` says that the name matches a member of practice staff and
 * offers the desk. It still never says WHICH name matched or how the match was
 * made — that stays REQ-VER-04/-VUL-04 territory.
 */
import {
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  ASSIGNOR_RELATIONSHIPS_VERSION,
  authorityBasisFor,
  canActAsAssignor,
  matchesPracticeStaff,
  MIN_AGE_ASSIGN_FOR_OTHER,
  MIN_AGE_SELF_ASSIGN,
  relationshipNeedsFreeText,
} from '@aobplatform/domain';
import { strings } from '../strings';

export {
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  ASSIGNOR_RELATIONSHIPS_VERSION,
  authorityBasisFor,
  matchesPracticeStaff,
  MIN_AGE_ASSIGN_FOR_OTHER,
  MIN_AGE_SELF_ASSIGN,
  relationshipNeedsFreeText,
};

/** The words for a relationship key. From the string table; the key is the content file's. */
export function relationshipLabel(key: string): string {
  return strings.assignor.relationshipNames[key] ?? key;
}

/**
 * What is actually sent as the relationship: the free text when the option
 * asks for it, otherwise the option's own label. One answer, from one place,
 * so the server and the screen cannot print different words.
 */
export function relationshipDescription(key: string, describe: string): string {
  return relationshipNeedsFreeText(key) ? describe.trim() : relationshipLabel(key);
}

export interface AssignorChoice {
  /** D7 — explicit, never inferred from anything else (CLAUDE.md §3). */
  readonly assignorIsPatient: boolean;
  readonly otherName: string;
  /** A key from the content file, or '' before anything is chosen. */
  readonly relationship: string;
  /** Required only by the option the content file marks `freeText`. */
  readonly describe: string;
  /** The declaration made on screen, not a stored date of birth (REQ-AGE-01). */
  readonly otherDeclaredOfAge: boolean;
  /**
   * CONTACT, NEVER IDENTITY (C7.2 / REQ-REG-08). At least one is required
   * because the copy of the agreement and everything after it goes to the
   * ASSIGNOR rather than the patient. A mobile number is not one of the six
   * approved identifiers and is never treated as one (hard rule 1).
   */
  readonly mobile: string;
  readonly email: string;
}

export const EMPTY_CHOICE: AssignorChoice = {
  assignorIsPatient: true,
  otherName: '',
  relationship: '',
  describe: '',
  otherDeclaredOfAge: false,
  mobile: '',
  email: '',
};

export type AssignorDecision =
  | { readonly allowed: true; readonly selfAssignAgeCheckedBy: 'server' | 'kiosk' }
  | { readonly allowed: false; readonly message: string };

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
 * is populated ONLY for the staff match.
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
  /** Named on screen, so the "still needed" line reads as a person would say it. */
  readonly patientName: string;
}): AssignorGate {
  const { choice, practiceStaffNames, patientName } = input;

  // The patient signing for themselves is never gated here: the kiosk holds
  // no date of birth, so the only check it could ever run client-side is
  // deferred to the server (see `decideAssignor`).
  if (choice.assignorIsPatient) return { state: 'valid' };

  const reasons: string[] = [];

  if (choice.otherName.trim().length === 0) reasons.push(strings.assignor.reasonNameNeeded);

  const derived = authorityBasisFor(choice.relationship, relationshipDescription(choice.relationship, choice.describe));
  if (choice.relationship.length === 0) {
    reasons.push(strings.assignor.reasonRelationshipNeeded(patientName));
  } else if (!derived) {
    // The relationship IS chosen, so what is missing is the description the
    // free-text option asks for — a different thing to say.
    reasons.push(strings.assignor.reasonDescribeNeeded);
  }

  // Staff match runs whether or not the age box is ticked, so a staff member
  // who is also under-declared still gets told about the rule that actually
  // stops them.
  const staffBlocked = matchesPracticeStaff(choice.otherName, practiceStaffNames);
  if (staffBlocked) reasons.push(strings.assignor.reasonStaffBlocked);

  if (!choice.otherDeclaredOfAge) reasons.push(strings.assignor.reasonAgeNeeded);

  if (choice.mobile.trim().length === 0 && choice.email.trim().length === 0) {
    reasons.push(strings.assignor.reasonContactNeeded);
  }

  if (reasons.length === 0) return { state: 'valid' };
  return {
    state: 'blocked',
    reasons,
    explanation: staffBlocked ? strings.assignor.blockedBody : null,
  };
}

export function decideAssignor(input: {
  readonly choice: AssignorChoice;
  /** From `GET /practice-users`, held in memory for the session only. */
  readonly practiceStaffNames: readonly string[];
  readonly patientName: string;
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
    patientName: input.patientName,
  });
  if (gate.state === 'blocked') {
    return { allowed: false, message: gate.explanation ?? gate.reasons[0] ?? strings.assignor.detailsNeeded };
  }
  return { allowed: true, selfAssignAgeCheckedBy: 'kiosk' };
}

/**
 * The body for `POST /agreements/:id/assignor`, composed from the choice.
 *
 * BOTH ANSWERS GO. `relationship` is the word the person chose — the fact C8
 * prints on the agreement — and `authorityBasis` is reg 65CB(5)'s category,
 * derived from it through the content file. REQ-VUL-01 names them as separate
 * attributes and they are sent as separate attributes; nothing on the server
 * has to re-derive one from the other, and nothing on the screen has to know
 * the legal vocabulary.
 *
 * `relationshipsVersion` travels with them (hard rule 14), so a question asked
 * months later — what was this person offered when they chose? — has an
 * answer. It is recorded on the vault event rather than as a column, because
 * it is evidence about a moment rather than current state.
 *
 * Empty contact fields are omitted rather than sent as '' — the domain's
 * `preferredAssignorChannel` reads absence, not emptiness.
 *
 * Returns null when the choice does not derive a basis, which the caller has
 * already prevented with the gate; it is a type-level refusal to compose a
 * body the server would reject.
 */
export function assignorRequestFrom(choice: AssignorChoice): {
  assignorIsPatient: false;
  name: string;
  relationship: string;
  relationshipsVersion: string;
  authorityBasis: string;
  note?: string;
  declaresEighteenOrOver: true;
  mobile?: string;
  email?: string;
} | null {
  const description = relationshipDescription(choice.relationship, choice.describe);
  const derived = authorityBasisFor(choice.relationship, description);
  if (!derived) return null;

  const mobile = choice.mobile.trim();
  const email = choice.email.trim();
  return {
    assignorIsPatient: false,
    name: choice.otherName.trim(),
    relationship: description,
    relationshipsVersion: ASSIGNOR_RELATIONSHIPS_VERSION,
    authorityBasis: derived.authorityBasis,
    ...(derived.note ? { note: derived.note } : {}),
    // Only ever sent from a gate that has already required the tick, so the
    // literal here is the DECLARATION being true rather than an age.
    declaresEighteenOrOver: true,
    ...(mobile ? { mobile } : {}),
    ...(email ? { email } : {}),
  };
}
