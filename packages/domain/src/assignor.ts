/**
 * RE-POINTING AN AGREEMENT AT SOMEBODY OTHER THAN THE PATIENT — the rules,
 * in one place, so the tablet and the server cannot disagree about them.
 *
 * The kiosk drafts every `episodic_pre` with `assignorIsPatient: true`
 * (CONSULTATION-CAPTURE-PLAN.md §2.1 step 4), which is the right default and
 * is wrong perhaps once a morning: a parent has brought a child, a spouse is
 * signing, a carer is standing there instead. Until now that ended the
 * ceremony — the tablet handed over to the desk because nothing could move a
 * draft onto a different assignor (apps/kiosk/README.md).
 *
 * WHY THE GUARDS LIVE HERE AND NOT IN THE SERVICE. `apps/kiosk` already
 * decides the same questions on the device (`src/rules/assignor.ts`), and a
 * rule enforced only on a client is a suggestion: the endpoint can be called
 * directly. Both surfaces must reach the same answer from the same code, so
 * the thresholds, the fixed authority list and the staff-name comparison are
 * defined once, here, and imported by whoever needs them.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - It never asks about, records, or infers CAPACITY (REQ-VUL-05). There is
 *    no parameter for it. The absence is the requirement.
 *  - It never verifies the claimed authority. Reg 65CB(5) makes authority a
 *    SELF-DECLARATION (REQ-VUL-02); the platform records the declaration and
 *    the basis, and stops there. Asking a receptionist to adjudicate an EPOA
 *    would be worse than useless.
 *  - It never judges the relationship. "Friend" is a legitimate answer —
 *    `other_with_note` with the note "friend" — and the platform does not have
 *    an opinion about who a patient chooses to bring with them.
 */
import type { AgreementStatus } from './agreement';
import { normaliseEmail, normalisePhone } from './contacts';
import { canActAsAssignor, HardRuleViolation, MIN_AGE_ASSIGN_FOR_OTHER } from './guards';
import { isContentImmutable } from './lifecycle';
import type { AssignorAuthorityBasis } from './parties';

/**
 * The fixed list from REQ-VUL-01, for somebody signing FOR ANOTHER PERSON.
 *
 * `self` is deliberately absent: it is a valid `AssignorAuthorityBasis` (the
 * patient signing for themselves) but it is not an authority to act for
 * anybody, so it can never be the answer on this path. The assignment below
 * is a compile-time proof that these six remain a subset of the domain enum —
 * if the two lists ever drift, this file stops compiling rather than silently
 * accepting a basis the rest of the platform does not know.
 */
export const AUTHORITY_BASES_FOR_ANOTHER = [
  'parent',
  'spouse',
  'co_resident_relative_18_plus',
  'guardian',
  'health_epoa',
  'other_with_note',
] as const;

export type AuthorityBasisForAnother = (typeof AUTHORITY_BASES_FOR_ANOTHER)[number];

const _authorityBasesAreASubsetOfTheDomainEnum: readonly AssignorAuthorityBasis[] =
  AUTHORITY_BASES_FOR_ANOTHER;
void _authorityBasesAreASubsetOfTheDomainEnum;

export function isAuthorityBasisForAnother(value: string): value is AuthorityBasisForAnother {
  return (AUTHORITY_BASES_FOR_ANOTHER as readonly string[]).includes(value);
}

/**
 * How a typed name is reduced before it is compared to the practice's staff
 * list. IDENTICAL to the kiosk's `matchesPracticeStaff` normalisation, and
 * that is the point: "mai nguyen" and "Mai  Nguyen" are the same person, and
 * a block that a different capitalisation walks through is not a block.
 */
export function normalisePersonName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * REQ-VUL-04 / hard rule 10 — the practice-staff comparison.
 *
 * An empty candidate never matches: a blank name is a missing-details problem,
 * and answering it with the staff refusal would tell somebody the wrong thing
 * about why they were stopped.
 */
export function matchesPracticeStaff(name: string, staffNames: readonly string[]): boolean {
  const candidate = normalisePersonName(name);
  if (candidate.length === 0) return false;
  return staffNames.some((staff) => normalisePersonName(staff) === candidate);
}

// ---------------------------------------------------------------------------
// Contact — C7.2 / REQ-REG-08. Carl, 3 Sep 2026: a non-patient assignor must
// give a mobile or an email, at least one, because the copy of the agreement,
// any post-service approval and every reminder now go to THEM and not to the
// patient. An assignor we cannot reach is an assignor the practice will chase
// by hand for a signature it already has.
//
// THIS IS CONTACT, NEVER IDENTITY. Nothing here verifies who anybody is; a
// mobile number is not one of the six approved identifiers and never becomes
// one (REQ-VER-02, hard rule 1). It is an address to send to.
// ---------------------------------------------------------------------------

export type AssignorContactChannel = 'mobile' | 'email';

/**
 * Australian mobile, checked for SHAPE only. `normalisePhone` already folds
 * +61 / 0061 / spacing into the national form, so what is left to say is
 * "this is an 04 number with ten digits". Landlines are refused on this path
 * because the channel exists to carry an SMS.
 */
export function isWellFormedMobile(value: string): boolean {
  return /^04\d{8}$/.test(normalisePhone(value));
}

/**
 * Conservative, and deliberately not RFC 5322. The purpose is to catch the
 * typo that would send a patient's agreement copy nowhere — not to litigate
 * the address grammar, which would refuse valid mailboxes to no benefit.
 */
export function isWellFormedEmail(value: string): boolean {
  const candidate = normaliseEmail(value);
  return /^[^\s@,;:<>"]+@[^\s@.,;:<>"]+(\.[^\s@.,;:<>"]+)+$/.test(candidate) && candidate.length <= 254;
}

export interface AssignorContactInput {
  readonly mobile?: string | null;
  readonly email?: string | null;
}

/** The well-formed channels present, mobile first. Empty means unreachable. */
export function assignorContactChannels(contact: AssignorContactInput): AssignorContactChannel[] {
  const channels: AssignorContactChannel[] = [];
  if (contact.mobile && isWellFormedMobile(contact.mobile)) channels.push('mobile');
  if (contact.email && isWellFormedEmail(contact.email)) channels.push('email');
  return channels;
}

/**
 * The assignor's preferred channel (C7.2 — per ASSIGNOR, not per patient,
 * because the signer is not always the patient).
 *
 * Mobile wins when both are given: the moments this channel serves are a copy
 * handed over at the desk and a reminder that wants answering today, and an
 * SMS is read in minutes where an email is read in days. A practice or the
 * person can override it later; this is the default, not a decision.
 */
export function preferredAssignorChannel(contact: AssignorContactInput): AssignorContactChannel | null {
  return assignorContactChannels(contact)[0] ?? null;
}

// ---------------------------------------------------------------------------
// The gate itself.
// ---------------------------------------------------------------------------

/**
 * Hard rule 2 / REQ-REG-06 — WHO SIGNS IS A PARTICULAR, so it may only change
 * while the particulars can still change.
 *
 * Once the payload is locked it has been validated, rendered and hashed
 * (REQ-VAULT-02); moving the assignor underneath it would leave the stored
 * artefact naming one person and the record naming another, and re-rendering
 * afterwards would break the hash the signature is bound to. A correction
 * after that point supersedes (HARD-02) — it does not edit.
 */
export function canRepointAssignor(state: {
  readonly status: AgreementStatus;
  readonly particularsLocked: boolean;
}): boolean {
  return !state.particularsLocked && !isContentImmutable(state.status) && !isTerminal(state.status);
}

const TERMINAL_STATUSES: readonly AgreementStatus[] = ['declined', 'expired', 'void'];

function isTerminal(status: AgreementStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * WHAT A REQUEST TO CHANGE WHO SIGNS SHOULD DO — the whole decision, in one
 * place (Carl, 7 Sep 2026: "go — fix who is signing on locked rows").
 *
 * WHY IT REPLACED A YES/NO. `canRepointAssignor` above answers "may this be
 * EDITED in place", and the answer on an arrived patient is always no: an
 * arrival locks its particulars the moment reception posts it, so every row on
 * the desk's list is locked and the one control that fixes "the mother is
 * signing, not the child" was dead by the time anybody could press it.
 *
 * BUT "CANNOT BE EDITED" IS NOT "CANNOT BE CHANGED". Who signs is a particular
 * (REQ-REG-06, hard rule 2, D7), and the regime's answer to a wrong particular
 * on a locked agreement is the same here as it is for a wrong name or address:
 * SUPERSEDE (HARD-02). A new agreement carrying `supersedesAgreementId`, with
 * the corrected party, validated and rendered from scratch; the old one keeps
 * its own true record of what it said and what it was hashed against.
 *
 * THE TWO REFUSALS ARE THE TWO THINGS SUPERSESSION CANNOT UNDO. Once somebody
 * has SIGNED, the party to the contract is a fact about an act that happened,
 * and a superseding agreement would not change who signed the first one — the
 * question is a dispute, not a correction. And an agreement that has already
 * left the pathway (declined, expired, void) has nothing to supersede: the
 * next step there is a fresh agreement, not a corrected one. Both come back as
 * CODES, so the console maps them to its own words with somewhere to go
 * (CLAUDE.md section 7) rather than showing a server sentence.
 */
export type AssignorRepointReason = 'already_signed' | 'agreement_moved_on';

export type AssignorRepointDisposition =
  /** Not locked yet: move the party on the agreement itself, as it always did. */
  | { readonly kind: 'in_place' }
  /** Locked and unsigned: a new agreement carrying `supersedesAgreementId`. */
  | { readonly kind: 'supersede' }
  | { readonly kind: 'refused'; readonly reason: AssignorRepointReason };

export function assignorRepointDisposition(state: {
  readonly status: AgreementStatus;
  readonly particularsLocked: boolean;
  /** The signature EVENT, not the status — a signature is a fact, not a state. */
  readonly signed: boolean;
  /** Another agreement already carries `supersedesAgreementId` for this one. */
  readonly superseded?: boolean;
}): AssignorRepointDisposition {
  if (state.signed || isContentImmutable(state.status)) {
    return { kind: 'refused', reason: 'already_signed' };
  }
  if (isTerminal(state.status) || state.superseded === true) {
    return { kind: 'refused', reason: 'agreement_moved_on' };
  }
  return state.particularsLocked ? { kind: 'supersede' } : { kind: 'in_place' };
}

export function assertRepointAllowed(state: {
  readonly status: AgreementStatus;
  readonly particularsLocked: boolean;
}): void {
  if (!canRepointAssignor(state)) {
    throw new HardRuleViolation(
      'REQ-REG-06',
      'Who signs is one of the locked particulars, so it cannot be changed on an agreement whose ' +
        'particulars are locked, signed or closed. A correction supersedes with a fresh agreement (HARD-02).',
    );
  }
}

export interface AssignorForAnotherInput {
  /** As typed. Compared to the staff list normalised; never echoed back in an error. */
  readonly name: string;
  readonly authorityBasis: string;
  /** Required when the basis is `other_with_note` — the note IS the basis there. */
  readonly note?: string | null;
  /** The declaration made on screen (REQ-AGE-01). NOT a stored date of birth. */
  readonly declaresEighteenOrOver: boolean;
  readonly mobile?: string | null;
  readonly email?: string | null;
  /** Every name the practice knows, active or not — fail closed. */
  readonly practiceStaffNames: readonly string[];
}

export interface AssignorForAnother {
  readonly name: string;
  readonly authorityBasis: AuthorityBasisForAnother;
  readonly authorityNote: string | null;
  /**
   * The relationship C8 requires. Derived from the basis rather than asked
   * twice: a form that collects "guardian" and then asks the relationship
   * gets two answers that can disagree, and C8 blocks on the one nobody
   * filled in.
   */
  readonly relationshipToPatient: string;
  readonly contactMobile: string | null;
  readonly contactEmail: string | null;
  readonly preferredChannel: AssignorContactChannel;
}

/**
 * Human-readable relationships for the fixed authority list. Sent to the
 * rules engine as `assignorRelationship` (C8) and rendered on the agreement.
 * `other_with_note` takes the note itself, which is where "friend" lands.
 */
const RELATIONSHIP_BY_BASIS: Readonly<Record<AuthorityBasisForAnother, string>> = {
  parent: 'parent',
  spouse: 'spouse',
  co_resident_relative_18_plus: 'co-resident relative',
  guardian: 'guardian',
  health_epoa: 'enduring power of attorney (health)',
  other_with_note: 'other',
};

/**
 * Every refusal on this path, in the order a person would meet them, each
 * throwing a `HardRuleViolation` that names the RULE and never the name that
 * was typed (no PII in errors — definition of done).
 *
 * ORDER MATTERS. The staff block runs before the age gate, so a staff member
 * who is also under age gets the staff refusal rather than a message that
 * tells them their age was the problem — the same ordering the kiosk uses.
 */
export function buildAssignorForAnother(input: AssignorForAnotherInput): AssignorForAnother {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new HardRuleViolation('REQ-VUL-01', 'An assignor acting for another person must be named.');
  }

  if (!isAuthorityBasisForAnother(input.authorityBasis)) {
    throw new HardRuleViolation(
      'REQ-VUL-01',
      `Authority basis must be one of: ${AUTHORITY_BASES_FOR_ANOTHER.join(', ')}. ` +
        'The list is fixed (reg 65CB(5)); "self" is not an authority to act for anybody.',
    );
  }
  const authorityBasis = input.authorityBasis;

  const note = input.note?.trim() ?? '';
  if (authorityBasis === 'other_with_note' && note.length === 0) {
    throw new HardRuleViolation(
      'REQ-VUL-01',
      'An "other" authority basis carries a note saying what it is — the note is the basis. ' +
        'A friend signing is a legitimate answer; write "friend".',
    );
  }

  // REQ-VUL-04 / hard rule 10. Enforced HERE as well as on the device,
  // because a control that only exists on the client is a suggestion.
  if (matchesPracticeStaff(name, input.practiceStaffNames)) {
    throw new HardRuleViolation(
      'REQ-VUL-04',
      'Somebody on this practice’s staff list cannot act as an assignor. This is the Departmental ' +
        'position and there is no override.',
    );
  }

  // REQ-AGE-01. The DECLARATION is the input — mapped onto the domain
  // threshold rather than compared against a number written here, so a
  // correction to the threshold lands everywhere at once. Self-assign
  // (MIN_AGE_SELF_ASSIGN) is a different gate on a different path and is
  // untouched by this.
  const verdict = canActAsAssignor({
    selfAssigning: false,
    ageYears: input.declaresEighteenOrOver ? MIN_AGE_ASSIGN_FOR_OTHER : 0,
    isPracticeStaffOfProvider: false,
  });
  if (!verdict.allowed) {
    throw new HardRuleViolation(
      verdict.rule ?? 'REQ-AGE-01',
      verdict.reason ?? `An assignor acting for another person must be ${MIN_AGE_ASSIGN_FOR_OTHER}+.`,
    );
  }

  // C7.2 / REQ-REG-08 — reachability, framed as contact and never as identity.
  const mobile = input.mobile?.trim() || null;
  const email = input.email?.trim() || null;
  const preferredChannel = preferredAssignorChannel({ mobile, email });
  if (!preferredChannel) {
    throw new HardRuleViolation(
      'REQ-REG-08',
      'A mobile or an email address is needed — at least one, and in a form we can send to. ' +
        'The copy of the agreement, any approval after the service and every reminder go to the ' +
        'person signing, so an assignor we cannot reach is one the practice will chase by hand. ' +
        'This is somewhere to send to, not proof of who anybody is.',
    );
  }

  return {
    name,
    authorityBasis,
    authorityNote: note.length > 0 ? note : null,
    relationshipToPatient:
      authorityBasis === 'other_with_note' ? note : RELATIONSHIP_BY_BASIS[authorityBasis],
    contactMobile: mobile && isWellFormedMobile(mobile) ? mobile : null,
    contactEmail: email && isWellFormedEmail(email) ? email : null,
    preferredChannel,
  };
}

// ---------------------------------------------------------------------------
// WHICH OF THE THREE THINGS A "WHO IS SIGNING" SAVE ACTUALLY IS
// (Carl, 11 Sep 2026 — D-2026-09-11-01).
//
// THE RULING. A change to how the other signer is REACHED — a mobile, an
// email — is a DELIVERY DETAIL, not a particular. The s 65C particulars carry
// the signer's NAME and RELATIONSHIP and nothing else about them: no signer
// contact is rendered into the artefact (the render path carries only the
// practice's own letterhead phone and email). So correcting a mistyped mobile
// cannot supersede an agreement — superseding would spend a second contract,
// a second validate, a second render and a second row of evidence restating
// particulars that did not move.
//
// WHO SIGNS IS STILL A PARTICULAR and still behaves exactly as it did: edited
// before the lock, superseded after it (hard rule 2, REQ-REG-06, HARD-02).
// This function is only the sorting hat; it decides nothing about what may be
// written, which is `assignorRepointDisposition`'s job and the service's.
//
// NORMALISED THE WAY THE REST OF THIS FILE NORMALISES. Names, notes and
// relationships through `normalisePersonName`, mobiles through
// `normalisePhone`, emails through `normaliseEmail` — so "Jane  Smith" and
// "jane smith" are one person, `+61 400 000 111` and `0400000111` are one
// number, and a re-typed space is not a change anybody has to be told about.
//
// PURE, AND IT NEVER LOGS. Two snapshots in, one word out; no value it is
// handed reaches a log, an error or an event from here.
// ---------------------------------------------------------------------------

export type AssignorChangeKind =
  /** Nothing moved. */
  | 'none'
  /** Only how the signer is reached moved — a delivery detail, not a particular. */
  | 'contact_only'
  /** Who signs moved: D7, the name, the relationship, the basis or its note. */
  | 'party';

/**
 * The party as it stands, or as a request would have it. Every field is
 * optional because "the patient is signing" has none of them — there is no
 * third party to name, and the patient's own contact lives on the patient
 * record rather than on an assignor row.
 */
export interface AssignorPartySnapshot {
  readonly assignorIsPatient: boolean;
  readonly name?: string | null;
  readonly relationshipToPatient?: string | null;
  readonly authorityBasis?: string | null;
  readonly authorityNote?: string | null;
  readonly contactMobile?: string | null;
  readonly contactEmail?: string | null;
}

function sameWords(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalisePersonName(a ?? '') === normalisePersonName(b ?? '');
}

function sameMobile(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalisePhone(a ?? '') === normalisePhone(b ?? '');
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return normaliseEmail(a ?? '') === normaliseEmail(b ?? '');
}

export function classifyAssignorChange(
  current: AssignorPartySnapshot,
  requested: AssignorPartySnapshot,
): AssignorChangeKind {
  // D7 ITSELF. "The patient is signing" and "somebody else is" are different
  // parties to the contract however alike everything else looks.
  if (current.assignorIsPatient !== requested.assignorIsPatient) return 'party';

  /*
   * "THE PATIENT IS SIGNING" HAS NO PARTY PARTICULARS TO DIFFER IN — no name,
   * no basis, no relationship — which is why the fields are not compared here
   * (the same judgement `successorAlreadySays` makes).
   *
   * A CONTACT IT DID NOT ASK ABOUT IS NOT A REQUEST TO CLEAR ONE. The common
   * Save on this branch is a bare `{ assignorIsPatient: true }` from the desk
   * confirming the default, and reading its silence as "blank the contact"
   * would turn every confirmation into a change. Only a channel the request
   * actually supplied is compared — and a supplied one that differs is
   * reported so the service can refuse it in words rather than discarding it
   * quietly: the patient's contact lives on the patient record.
   */
  if (requested.assignorIsPatient) {
    const asksMobile = (requested.contactMobile ?? '').trim().length > 0;
    const asksEmail = (requested.contactEmail ?? '').trim().length > 0;
    if (asksMobile && !sameMobile(current.contactMobile, requested.contactMobile)) return 'contact_only';
    if (asksEmail && !sameEmail(current.contactEmail, requested.contactEmail)) return 'contact_only';
    return 'none';
  }

  // THE PARTICULARS FIRST, because a party change subsumes any contact that
  // travelled with it — a new signer arrives with their own number.
  if (!sameWords(current.name, requested.name)) return 'party';
  if (!sameWords(current.authorityBasis, requested.authorityBasis)) return 'party';
  if (!sameWords(current.authorityNote, requested.authorityNote)) return 'party';
  if (!sameWords(current.relationshipToPatient, requested.relationshipToPatient)) return 'party';

  if (!sameMobile(current.contactMobile, requested.contactMobile)) return 'contact_only';
  if (!sameEmail(current.contactEmail, requested.contactEmail)) return 'contact_only';
  return 'none';
}
