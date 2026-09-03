/**
 * REQ-VER-02 / hard rule 1 — the Medicare card number is NOT an identity
 * identifier, and the exclusion is not configurable.
 *
 * WHERE THE FIELD SET COMES FROM. The server sends `identifierTypes` on the
 * waiting-list response and the verification screen renders from that list.
 * The kiosk holds no configuration of its own, so there is no setting on this
 * device that could add a seventh type — and the list that does arrive is put
 * through the domain's own `assertValidIdentifierSet` before a single input
 * is drawn. A practice that somehow configured a card number would produce a
 * screen that refuses to render the challenge, not a screen with a card field
 * on it.
 *
 * NOTE WHAT IS ABSENT. There is no label for a card number in the string
 * table, no branch here that would reach one, and no fallback that would draw
 * an input for an unrecognised type. The absence is the enforcement.
 *
 * Values typed into these fields are sent once to
 * `POST /verification/challenges/:id/attempt` and discarded — the kiosk never
 * stores them, and the evidence records TYPES and outcomes only (REQ-VER-04).
 */
import { assertValidIdentifierSet, type ApprovedIdentifierType } from '@aobplatform/domain';
import { strings } from '../strings';

export interface IdentifierField {
  readonly type: ApprovedIdentifierType;
  readonly label: string;
  readonly hint?: string;
}

/**
 * Builds the field set for the challenge. Throws (via the domain guard) on any
 * type outside the approved six, and on fewer than the floor of three.
 *
 * The caller catches and routes the patient to reception — a broken challenge
 * configuration must never trap somebody at a tablet (REQ-REC-04).
 */
export function identifierFieldsFor(types: readonly string[]): readonly IdentifierField[] {
  assertValidIdentifierSet(types);
  return types.map((type) => ({
    type,
    label: strings.verify.identifierNames[type] ?? type,
    hint: strings.verify.identifierHints[type],
  }));
}

/** True when every field the challenge asked for has been given something. */
export function challengeIsComplete(
  fields: readonly IdentifierField[],
  stated: Readonly<Record<string, string>>,
): boolean {
  return fields.every((field) => (stated[field.type] ?? '').trim().length > 0);
}
