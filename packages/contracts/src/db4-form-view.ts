/* ---------------------------------------------------------------------------
 * THE DB4 AS THE PATIENT READS IT ON THE TABLET.
 *
 * D-2026-09-27-01: *"patient sees the db4 with the cost on it"*, and
 * *"mask on the tablet, full on the form"*.
 *
 * A PROJECTION OF THE DB4 PRINT RECORD, NOT A SECOND COPY OF IT. This is built
 * on the server from the same `PrintJobEnvelope` that `SignedDb4Renderer` draws
 * the chart-folder form from, by the same service, in the same request that
 * locks the particulars. Three renderings of one source — the tablet, the
 * Assignment Agreement and the Signed-DB4 — and the reason there are three
 * renderings rather than three sources is `ParticularsScreen`'s own rule: a
 * sentence written on the client would be a second copy of the operative words
 * of a contract, free to drift from the one that was signed.
 *
 * ── WHY THE MASKING HAPPENS HERE AND NOT ON THE CLIENT ──
 *
 * `medicareCardNumberMasked` is the ONLY Medicare field on this type, and that
 * is the whole control. A full number sent to the tablet and masked in the
 * markup is not masked: it sits in the JSON payload, in the network tab, in the
 * React tree and in any memory dump of the browser, on a device that lives in a
 * waiting room and is handed to strangers all day. The tablet cannot leak a
 * value it was never given.
 *
 * So: the server masks, and the type makes the unmasked value unrepresentable.
 * Anyone adding `medicareCardNumber` here should read D-2026-09-27-01 part 3
 * first — it amends D-2026-09-14-03 for the screen and only for the screen.
 *
 * ── WHAT IS DELIBERATELY ABSENT ──
 *
 * The out-of-scope pathology statement (s 65C(4) items 1–4, CLAUDE.md §8). It
 * is filtered here exactly as `SignedDb4Renderer.drawAssignment` filters it, so
 * the screen and the form agree: one statement where the practice's paper has
 * two. See D-2026-09-14-02.
 * ------------------------------------------------------------------------- */

/** One service row, reproduced from the form. */
export interface Db4FormViewService {
  readonly serviceDate?: string;
  readonly mbsItemNumber?: string;
  readonly description?: string;
  /**
   * THE AMOUNT AS PRACSOFT PRINTED IT, carried as the string on the page and
   * never as a number. Parsing it to a number and formatting it again would be
   * AoB originating a figure, which hard rule 4 forbids even where the figure
   * happens to agree (D-2026-09-14-02: *"AoB never originates or computes an
   * amount; it may reproduce the amount the practice's billing software
   * printed"*).
   *
   * It is display only. It is not in the locked particulars, not hashed into
   * the Assignment Agreement, and not written back.
   */
  readonly benefitAssigned?: string;
}

/** The patient block, as the form prints it — with the one redaction. */
export interface Db4FormViewPatient {
  readonly givenNames?: string;
  readonly familyName?: string;
  readonly dateOfBirth?: string;
  readonly address?: string;
  /** The practice's chart number — the only key a DB4 is matched on (hard rule 1). */
  readonly patientRecordNumber?: string;
  /**
   * MASKED FOR THE WAITING ROOM, e.g. `•••• ••237 1` — the last four, in the
   * card's own 4-5-1 grouping. Enough for the patient to CHECK the screen
   * against the card in their hand, which one digit was not (Carl, 27
   * September 2026: *"showing just a single digit does not help"*); not enough
   * for anyone else to use. The six that make the number usable never leave
   * the server, and the full number is on the Signed-DB4 and nowhere near this
   * payload.
   *
   * THE LINT RULE BELOW FIRES HERE, AND THE NAME IS KEPT ANYWAY. Renaming this
   * to something the rule does not match — `cardMasked`, say — would silence
   * the guard against the single most likely design mistake in this product
   * and make the field invisible to everyone who greps for it later. The
   * exception is declared instead, which is the same thing `print-capture.ts`
   * does for the unmasked field and for the same reason: hard rule 1's actual
   * prohibitions are intact. This value is never used to verify a patient,
   * never to find or match one, never written to a log, an error message or a
   * vault event, and never sent to the rules service. It is content on a form,
   * redacted, on its way to a screen.
   */
  // eslint-disable-next-line no-restricted-syntax
  readonly medicareCardNumberMasked?: string;
  /** The IRN is one digit and identifies nobody on its own; it is shown as printed. */
  readonly irn?: string;
}

export interface Db4FormViewProvider {
  readonly name?: string;
  readonly providerNumber?: string;
  readonly role?: string;
}

export interface Db4FormViewStatement {
  readonly key?: string;
  readonly text?: string;
}

/**
 * The block the lock response carries for a session that came from a DB4 Print
 * Record. **Absent for every other session**, and that absence is the whole of
 * D-2026-09-27-02: a walk-up at a practice with no PMS has no print record, so
 * no block is built, so `ParticularsScreen` draws exactly what it drew before
 * this feature existed. The new path does not run rather than running and
 * producing the same answer.
 */
export interface Db4FormView {
  /** The form's own heading lines, reproduced verbatim (hard rule 12, with the footer). */
  readonly headingLines?: readonly string[];
  readonly formCode?: string;
  readonly formReference?: string;
  readonly serviceDate?: string;
  readonly servicingLocationName?: string;
  readonly servicingLocationAddressLines?: readonly string[];
  readonly patient?: Db4FormViewPatient;
  readonly providers?: readonly Db4FormViewProvider[];
  readonly services?: readonly Db4FormViewService[];
  readonly privacyNotice?: readonly string[];
  /** In-scope statements only; the pathology offer is filtered out. */
  readonly statements?: readonly Db4FormViewStatement[];
  /**
   * THE HASH OF THE PRINTED BYTES AOBPRINTER READ — the provenance of the
   * page, and an IDENTIFIER rather than content (hard rule 9).
   *
   * Shown in the kiosk footer beside the session and patient ids, on a TEST
   * DEVICE ONLY, so somebody checking a rendering can tie what is on the
   * screen to the exact print run it came from. D-2026-09-14-02 left this hash
   * and the DB4 Print Record as the only provenance there is: *"We no longer
   * keep a copy of the PracSoft DB4 at all."*
   *
   * THE RECORD IT HASHES IS NOT REACHABLE FROM THE TABLET, and that is
   * deliberate (Carl, 27 September 2026). The raw record carries the UNMASKED
   * Medicare card number — it is the thing `maskMedicareCardNumber` masks
   * from — so a link to it from a waiting-room device would undo
   * D-2026-09-27-01 part 3 one tap at a time. What a test device may show is
   * the MASKED projection it was actually sent, which is also the more useful
   * answer to "did the screen draw what it was given". The raw record stays
   * reachable from a workstation, where a full card number is already at home.
   */
  readonly sourceSha256?: string;
  /**
   * THE PRINT JOB THIS FORM CAME OFF — the agreement's own `sourcePrintJobId`,
   * carried to the screen so the two ends of one print run can be matched by
   * eye (Carl, 27 September 2026: *"the print job id, that hash, and the Print
   * Record itself ... show this in the footer with the other audit ids"*).
   *
   * AN IDENTIFIER, NOT CONTENT (hard rule 9). It is a value this platform
   * minted, it names a queue row rather than a person, and it carries no
   * identifier VALUE of any kind — which is the same reasoning the session and
   * patient ids in the kiosk footer already rest on. Nothing reads a patient
   * out of it and nothing verifies anybody with it.
   *
   * SHOWN ON A TEST DEVICE ONLY, beside `sourceSha256`, behind the same flag
   * the parser template version and the "ready to sign" panel sit behind. On a
   * patient's screen an internal id is a developer's note.
   *
   * IT IS NOT A LINK, AND THE RECORD IT NAMES STAYS UNREACHABLE FROM THE
   * TABLET — see `sourceSha256` above, which is the ruling this field does not
   * amend. Two ids and a hash let somebody standing at the tablet find the
   * print run from a workstation; they do not bring the unmasked card number
   * into the waiting room.
   */
  readonly printJobId?: string;
  /**
   * The parser template that read the form. Shown on a TEST device only — on a
   * patient's screen it is a developer's note, which is the same objection that
   * moved the "ready to sign" panel behind the test flag.
   */
  readonly parserTemplateVersion?: string;
}
