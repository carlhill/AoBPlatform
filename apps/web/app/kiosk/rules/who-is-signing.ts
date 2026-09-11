/**
 * WHO IS SIGNING, READ ONCE FOR THE WHOLE CEREMONY (Carl, 7 Sep 2026).
 *
 * WHY THIS FILE EXISTS. K-4 has stated who is signing since f70e450, and the
 * branch that decides it — patient, or somebody else, with or without a stated
 * relationship — lived inline in `SignatureScreen`. The header now names the
 * party on EVERY page of the pushed ceremony, and a second copy of that branch
 * is how two screens end up naming two different people from one record. So
 * the branch moved here and K-4 reads it from here; there is exactly one
 * reading of D7 on this device.
 *
 * `assignorIsPatient` IS THE DISCRIMINATOR AND IS NEVER INFERRED (CLAUDE.md
 * §3, D7). Not from whether `assignorName` happens to be set, not from whether
 * it equals the patient's name. "Assignor" and "patient" are different fields
 * because they are different people often enough to matter, and a helper that
 * guessed would be the conflation the domain model exists to prevent.
 *
 * NOTHING LEGAL IS DECIDED HERE. This file chooses a sentence; the relationship
 * words come from the string table via `relationshipLabel`, and the list behind
 * them is versioned content (`assignor-relationships.json`, hard rule 14).
 */
import { relationshipLabel } from './assignor';
import { strings } from '../strings';

/**
 * The four facts a screen needs to say who is signing. Built once in
 * `Ceremony.tsx` from the locked particulars and the pushed session, and passed
 * down — a screen never looks any of them up, which is what stops the reading
 * step and the signing step from disagreeing.
 */
export interface SigningParties {
  patientName: string;
  assignorIsPatient: boolean;
  assignorName: string | null;
  assignorRelationship: string | null;
}

/**
 * K-4's fuller statement, above the pad: "Alex Fictional is signing." or "Kim
 * Fictional is signing for Alex Fictional as their Mother."
 *
 * ALL THREE FACTS ON THE OTHER-PARTY BRANCH — who, who for, and on what
 * footing — because those are the three a wrong pairing shows up in, and the
 * pen is the last place it can be caught.
 *
 * A RECORD WITH NO RELATIONSHIP GETS THE SENTENCE WITHOUT ONE. "as their ." is
 * worse than silence, and inventing a legal footing nobody declared is worse
 * than both.
 */
export function signingStatement(parties: SigningParties): string {
  const { patientName, assignorIsPatient, assignorName, assignorRelationship } = parties;
  if (assignorIsPatient) return strings.signature.signingByPatient(patientName);
  if (assignorRelationship) {
    return strings.signature.signingByOther(
      assignorName ?? '',
      patientName,
      relationshipLabel(assignorRelationship),
    );
  }
  return strings.signature.signingByOtherUnstated(assignorName ?? '', patientName);
}

/**
 * The header's second line, on every page: "by Alex Fictional", or "by Kim
 * Fictional for Alex Fictional".
 *
 * NO RELATIONSHIP HERE, and that is a choice rather than an omission. The
 * footing belongs where the pen is; repeating "as their Mother" at the top of
 * five screens makes a heading into a paragraph, and the heading's job is to
 * answer "whose agreement is this" at a glance.
 *
 * A RECORD THAT SAYS "NOT THE PATIENT" BUT NAMES NOBODY GETS "for <patient>",
 * NOT "by <patient>". Falling back to the patient would be this header
 * asserting D7 is the patient when the record says it is not -- a wrong fact
 * at the top of every page, which is worse than a line that says less. The
 * defensive branch says the one thing that is known and claims nothing about
 * the signer; K-4 still states the pairing above the pad.
 */
export function signingByLine(parties: SigningParties): string {
  const { patientName, assignorIsPatient, assignorName } = parties;
  if (assignorIsPatient) return strings.chrome.signingBy(patientName);
  if (!assignorName) return strings.chrome.signingForPatient(patientName);
  return strings.chrome.signingByFor(assignorName, patientName);
}
