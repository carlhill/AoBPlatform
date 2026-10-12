import type { Db4ParticularChange, Db4ReprintAction } from '@aobplatform/contracts';

/* ---------------------------------------------------------------------------
 * WHAT TO DO WITH A DB4 THAT HAS BEEN PRINTED AGAIN — the rule, as a pure
 * function, with no database in it.
 *
 * Carl, 28 September 2026: *"I should be able to correct the missing data (as
 * though corrected from the PMS) and reprint to AOBPrinter and resend to AOB
 * for reprocessing."* — and then, on the three-way rule put to him: *"Agreed -
 * repoint when only the reproduction improved, supersede when a particular
 * changed, refuse under a signature."*
 *
 * ── WHY THERE IS A DECISION HERE AT ALL ──
 *
 * Until today the answer was FIRST FORM WINS: `linkToPrintJob` filtered on
 * `sourcePrintJobId IS NULL`, so a reprint was a no-op. That is right for a
 * RE-SPOOL of the same page and wrong for a CORRECTION, and the two are
 * indistinguishable from the outside — both arrive as a new job against the
 * same form reference. The difference is in the content, which is what this
 * function reads.
 *
 * (The re-spool case never reaches here at all: identical bytes are the same
 * job by `@@unique([practiceId, documentType, sourceSha256])`, so a second
 * print of an unchanged page is deduplicated at the door.)
 *
 * ── THE THREE OUTCOMES, AND WHY THE LINE FALLS WHERE IT DOES ──
 *
 * REPOINT when only the REPRODUCTION improved. The commonest correction by
 * far is a field that was never a particular in the first place: an amount
 * (hard rule 4 — no dollar amount is in the s 65C data set), an IRN or card
 * number (hard rule 1 — not an identity identifier), the provider's printed
 * NAME (the agreement resolves its provider from the NUMBER, through the
 * affiliation). None of these can change what the agreement SAYS; they change
 * only the page we would show the patient and reproduce in a Signed-DB4. So
 * the agreement is untouched and the pointer moves to the better page.
 *
 * SUPERSEDE when a PARTICULAR changed. A different date of service, a
 * different set of item numbers, a different servicing provider or a
 * different patient is not a better picture of the same agreement — it is a
 * different agreement. Hard rule 2 and HARD-02: a locked particular is never
 * EDITED, and the regime's own correction for a wrong one is a new agreement.
 * Repointing here would leave an agreement whose locked particulars disagree
 * with the form it claims to reproduce, which is the one outcome worse than
 * refusing.
 *
 * REFUSE under a SIGNATURE, always, and before either of the above. A signed
 * agreement is evidence: its particulars were locked, rendered, hashed and
 * assented to, and the Signed-DB4 reproduces the page that was in front of
 * the person when they signed. Moving that pointer afterwards would make the
 * evidence reproduce a page nobody saw. Superseding is no better — the thing
 * that needs correcting has already been agreed. Both are refused, the job
 * row records why, and a human decides.
 *
 * ── IT NEVER BLOCKS CARE, AND IT NEVER DESTROYS ANYTHING ──
 *
 * Hard rule 8 (REQ-REC-04): nothing here can stop a patient being seen or
 * billed — the worst case is a job row carrying a code somebody reads later.
 * And the superseded agreement keeps its own true record (hard rule 13); the
 * old print job row is never altered or deleted, because the vault is
 * append-only in spirit here as well (hard rule 11).
 *
 * ── PARTICULARS ARE COMPARED AS TYPES, REPORTED AS TYPES ──
 *
 * Hard rule 9 (REQ-VER-04). `Db4ParticularChange` names WHICH KIND of
 * particular moved — `patient`, `servicing_provider`, `service_date`,
 * `service_items` — and can carry no chart number, no provider number, no
 * date and no item number. That is what lets the answer ride on a job row, in
 * a log line and in a vault event.
 * ------------------------------------------------------------------------ */

/** The four DB4-determined particulars, as this function needs to see them. */
export interface Db4Particulars {
  /** Our id for the patient the chart number resolved to — never the chart number. */
  readonly patientId: string;
  /** The SERVICING provider's number: the one the assignment is with (s 65C(5)(a)). */
  readonly servicingProviderNumber: string | null;
  readonly serviceDate: string | null;
  readonly mbsItemNumbers: readonly string[];
}

export interface Db4ReprintInput {
  /** The print job the agreement points at today. Null before anything linked. */
  readonly linkedPrintJobId: string | null;
  /** The job that has just arrived. */
  readonly arrivingPrintJobId: string;
  /** Has anybody signed it. A signature closes every door below. */
  readonly signed: boolean;
  /**
   * WHAT THE AGREEMENT SAYS. Null when its particulars were never locked, in
   * which case there is nothing yet to disagree with and the pointer may move
   * freely — the lock that follows reads the record, not the old page.
   */
  readonly locked: Db4Particulars | null;
  /** What the arriving form says. */
  readonly arriving: Db4Particulars;
}

export interface Db4ReprintDecision {
  readonly action: Db4ReprintAction;
  /**
   * WHICH KINDS OF PARTICULAR MOVED. Empty for every action but `supersede`,
   * and never a value (hard rule 9).
   */
  readonly changed: readonly Db4ParticularChange[];
}

/**
 * ORDER-INSENSITIVE, because a form's rows are a set of services and not a
 * sequence. A template that reads the same three items in a different order
 * has not changed the agreement, and treating it as a change would supersede
 * a contract over a parser's iteration order.
 *
 * DUPLICATES ARE KEPT, because a DB4 may legitimately print the same item
 * twice (seeded and confirmed: `duplicate-items`, set 3) and two of an item is
 * not one of it.
 */
function sameItems(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * WHICH PARTICULARS MOVED between the locked agreement and the arriving form.
 *
 * ABSENT IS NOT A CHANGE. A corrected reprint whose template failed to read a
 * field this time reports that field as missing, and treating missing as
 * "different" would supersede an agreement because a parser got WORSE. The
 * checks at the push are what catch a degraded reproduction; this function
 * only ever acts on a field the new form actually states.
 */
export function db4ParticularsChanged(
  locked: Db4Particulars,
  arriving: Db4Particulars,
): readonly Db4ParticularChange[] {
  const changed: Db4ParticularChange[] = [];
  if (locked.patientId !== arriving.patientId) changed.push('patient');
  if (
    arriving.servicingProviderNumber !== null &&
    locked.servicingProviderNumber !== arriving.servicingProviderNumber
  ) {
    changed.push('servicing_provider');
  }
  if (arriving.serviceDate !== null && locked.serviceDate !== arriving.serviceDate) {
    changed.push('service_date');
  }
  if (arriving.mbsItemNumbers.length > 0 && !sameItems(locked.mbsItemNumbers, arriving.mbsItemNumbers)) {
    changed.push('service_items');
  }
  return changed;
}

export function decideDb4Reprint(input: Db4ReprintInput): Db4ReprintDecision {
  const none: readonly Db4ParticularChange[] = [];

  /*
   * NOTHING LINKED YET — the ordinary first form. This is the path that has
   * always existed and it keeps its old name, so a reader of the job row can
   * still tell an original from a correction at a glance.
   */
  if (input.linkedPrintJobId === null) return { action: 'linked', changed: none };

  /*
   * ALREADY POINTING HERE. Asked twice, answered once — the same posture as
   * `asking again produces no second document`.
   */
  if (input.linkedPrintJobId === input.arrivingPrintJobId) {
    return { action: 'already_linked', changed: none };
  }

  /* A SIGNATURE CLOSES EVERY DOOR. Checked before the comparison, because
     what the corrected form says cannot matter once somebody has signed. */
  if (input.signed) return { action: 'refused_signed', changed: none };

  /* NEVER LOCKED, so there is nothing to disagree with yet. */
  if (input.locked === null) return { action: 'repointed', changed: none };

  const changed = db4ParticularsChanged(input.locked, input.arriving);
  return changed.length === 0
    ? { action: 'repointed', changed: none }
    : { action: 'supersede', changed };
}
