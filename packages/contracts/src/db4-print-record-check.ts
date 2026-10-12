import type { Db4PlacementReason } from './print-capture';

/* ---------------------------------------------------------------------------
 * IS THE DB4 PRINT RECORD COMPLETE ENOUGH TO REPRODUCE? — the codes, named
 * once, read by the push that refuses and by the console that explains.
 *
 * Carl, 27 September 2026, from a live tablet: *"If no $ do not allow the
 * approval to progress. Check all details when the reception pushes to the
 * tablet."*
 *
 * ── THIS IS NOT A STATUTORY VALIDATION, AND THAT DISTINCTION IS THE WHOLE
 *    DESIGN ──
 *
 * NO DOLLAR AMOUNT IS IN THE s 65C DATA SET (hard rule 4, REQ-REG-04). An
 * agreement with no amount anywhere near it is statutorily COMPLETE, and
 * nothing here says otherwise — none of these codes means "this agreement is
 * invalid", and an agreement that never came off a printed DB4 is never asked
 * any of these questions at all.
 *
 * WHAT THEY MEASURE IS CONFIDENCE IN OUR OWN REPRODUCTION. A real PracSoft DB4
 * for a bulk-bill claim prints a benefit against its service rows, so a DB4
 * Print Record carrying none most likely means AOBPRINTER's template did not
 * read the form properly — the same failure `parserTemplateVersion` exists to
 * track, and a PracSoft layout change is the ordinary cause of it. The patient
 * is about to be shown that reproduction on a tablet and asked to check it
 * against what they know, so a reproduction we do not believe should not reach
 * them.
 *
 * NOTHING HERE ORIGINATES, PARSES OR COMPUTES AN AMOUNT. `benefitAssigned` is
 * tested for PRESENCE, as a non-empty string, and is never converted to a
 * number, compared, summed, rounded or reformatted (D-2026-09-14-02: *"AoB
 * never originates or computes an amount; it may reproduce the amount the
 * practice's billing software printed"*). `"0.00"` is an amount the practice
 * printed and it PASSES — deciding that a zero means "no amount" would be AoB
 * forming an opinion about a figure, which is the thing hard rule 4 forbids.
 *
 * ── WHERE THE REFUSAL HAPPENS, AND WHY IT IS AT THE DESK ──
 *
 * AT THE PUSH, IN FRONT OF RECEPTION — never on the tablet in front of the
 * patient. The tablet-side block was put to Carl on 27 September 2026 and he
 * rejected it: *"Check all details when the reception pushes to the tablet."*
 *
 * HARD RULE 8 (REQ-REC-04) IS THE REASON. A refusal at the desk is a redirect
 * a staff member can act on in a few seconds — reprint the form, or capture on
 * paper, or capture after the service — and the patient is seen and billed
 * either way, so evidence is slowed and service is not. A dead Continue button
 * in front of somebody who has already sat down is the exact failure that rule
 * exists to prevent, and it would be worse than useless: the person looking at
 * it is the one person in the building who cannot fix a print record.
 *
 * ── A CODE NAMES A FIELD, NEVER A VALUE ──
 *
 * Hard rule 9 (REQ-VER-04). Every code below says WHICH part of the form could
 * not be read, and not one of them can carry a name, a chart number, a card
 * number, an address, an item number or an amount. That is what makes them
 * safe in an HTTP body, a log line and a vault event, and it is why the codes
 * — rather than a sentence assembled from the record — are the contract.
 *
 * ── AND THE WORDS ARE NOT HERE ──
 *
 * Never a bare 409 (CLAUDE.md §7, *"shortcuts to the answer, not directions to
 * a screen"*), and never a sentence written in core either. The refusal
 * carries these codes, the console maps each one to its own string-table entry
 * with the control that fixes it (REQ-LANG-01), and a code the console has not
 * mapped shows its own code so it can be diagnosed rather than becoming a
 * shrug. That is the construction `practice_surface_not_in_use` already uses,
 * for the same reasons.
 *
 * ── THREE OF THESE ARE THE GUARD; FOUR ARE A BACKSTOP. READ THIS BEFORE YOU
 *    TRUST ANY OF THEM ──
 *
 * `db4-assignment.handler.ts` is the ONLY writer of `Agreement.sourcePrintJobId`
 * (`linkToPrintJob`), and it writes it only after its own ingest gates have
 * passed on the very same envelope. So a print record missing a chart number,
 * missing every service item, missing a servicing provider NUMBER or missing a
 * date of service NEVER BECOMES AN AGREEMENT AT ALL: the job row records
 * `no_chart_number`, `no_service_items`, `no_servicing_provider` or
 * `no_service_date` and nothing is placed. Four of the seven checks below
 * therefore cannot fire on any agreement that exists today, and it would be
 * dishonest to present them as protection.
 *
 * THEY ARE KEPT ANYWAY, DECLARED AS A BACKSTOP, because the invariant that
 * makes them unreachable is a fact about today's code and not a structural
 * one: it is "there happens to be exactly one writer of that column, and it
 * happens to gate on these fields first". `DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST`
 * below states the correspondence field by field, and
 * `every_backstop_check_names_the_ingest_reason_that_covers_it` pins it — so a
 * relaxed ingest gate is a test to update rather than a hole to rediscover.
 *
 * WHAT IS ACTUALLY LIVE, on the agreements a practice has right now:
 *  - `print_record_benefit_missing` — nothing at ingest looks at an amount.
 *    This is the gap Carl's ruling names.
 *  - `print_record_irn_missing` — `irn` is `@IsOptional()` at ingest and
 *    nothing downstream requires it (Carl, 27 September 2026, from a live
 *    tablet: a card number read without its IRN, on a screen whose own note
 *    tells the patient to check the IRN).
 *  - `print_record_servicing_provider_name_missing` — but ONLY FOR AN EMPTY
 *    NAME, NOT AN ABSENT ONE, and that distinction was found by trying it
 *    (28 September 2026, seeding test records). `ProviderDto.name` in
 *    `inbound-print-jobs.controller.ts` is a REQUIRED `@IsString()`, so an
 *    envelope that OMITS the name is refused at the boundary with a 400 and
 *    never becomes a print record at all. An empty string passes the DTO,
 *    reaches the table, and is what `read()` treats as nothing — so the
 *    reachable fault is a parser that emitted the field without finding a
 *    value, which is the ordinary shape of a half-read line.
 *
 * THE NAME/NUMBER SPLIT IS WHY THAT LIST IS HONEST NOW. Until 28 September
 * these two were ONE code, which had to be declared gated at ingest (on the
 * strength of its number half) while being live (through its name half) —
 * two different answers to one question, in one row of the table below.
 * ------------------------------------------------------------------------- */

/**
 * EVERY CHECK, IN THE ORDER THEY ARE REPORTED. The order is part of the
 * contract: reception reads a list, and a list that reshuffles itself between
 * two presses of Send is a list nobody trusts.
 */
export const DB4_PRINT_RECORD_CHECKS = [
  /**
   * NEITHER A NAME NOR A CHART NUMBER, so nothing on the reproduction says who
   * it is about.
   *
   * BACKSTOP — see the header. A record with no chart number is refused at
   * ingest as `no_chart_number` and never becomes an agreement, so this cannot
   * fire today.
   *
   * EITHER ONE IS ENOUGH, which is why it is written as BOTH being absent. A
   * DB4 prints both, and the chart number is the only key a DB4 is matched on
   * (hard rule 1). A record with the chart number but no name is a real and
   * reachable state, and it is deliberately NOT refused here: `buildDb4FormView`
   * already returns no view at all in that case, so the tablet falls back to
   * the original screen drawn from the locked particulars. That fallback is
   * better than a refusal, because it costs the patient a picture of their
   * form and costs the practice nothing.
   */
  'print_record_patient_unidentified',
  /**
   * A MEDICARE CARD NUMBER WITH NO IRN BESIDE IT (Carl, 27 September 2026,
   * from a live tablet: *"if a medicare# is provided then the IRN must also be
   * provided. Check this on button 'Send to tablet' at reception"*).
   *
   * LIVE, AND THE SECOND OF THE TWO THAT ARE. `inbound-print-jobs.controller.ts`
   * declares `irn` `@IsOptional()` and nothing downstream requires it, so a
   * card number the template read without its IRN places an agreement and
   * reaches a tablet today.
   *
   * WHAT CARL SAW IS WHY IT IS HERE, AND IT IS A SCREEN THAT CONTRADICTS
   * ITSELF. `ParticularsScreen` draws the IRN row only when there is an IRN,
   * while the masking note beside it tells the patient in so many words to
   * check *"the IRN beside your name"*. With the card number read and the IRN
   * not, the patient is asked to check a field that is not on the page — and
   * the one thing that screen exists to do is let somebody compare what we
   * show against the card in their hand.
   *
   * CONDITIONAL, EXACTLY AS CARL PUT IT. No card number, no requirement: a
   * print record carrying neither is the `no-card-number` case, the screen
   * shows neither field, the note about the card is not drawn, and nothing
   * contradicts anything. It is the HALF-READ card that is refused.
   *
   * PRESENCE, NEVER VALUE, AND NOT AN IDENTITY CHECK (hard rules 1 and 9).
   * This asks whether the digit survived the parse. It does not read it, does
   * not range-check it, does not compare it to anything, and above all does
   * not treat the card as identifying anybody — the Medicare card number is
   * NOT an identity identifier (REQ-VER-02), and neither is the IRN beside it.
   * The code names two fields and can carry neither value.
   */
  'print_record_irn_missing',
  /**
   * NO SERVICE ROWS AT ALL. A DB4 exists to list services; a print record with
   * an empty list is a page the template could not find the table on.
   *
   * BACKSTOP — no rows means no MBS item numbers, which ingest refuses as
   * `no_service_items`.
   */
  'print_record_services_missing',
  /**
   * THE SERVICING PROVIDER'S NAME IS MISSING.
   *
   * SPLIT FROM THE PROVIDER NUMBER ON 28 SEPTEMBER 2026 (Carl, at the desk:
   * *"IRN, provider's name or provider number (be specific - which one)"*).
   * One code covering both halves produced a line that named two fields and
   * told reception which of them to look at only by saying "or" -- which, on
   * a form where the number is plainly printed and the name is blank, sends
   * somebody hunting for a fault that is not there. Two codes, two lines, and
   * the band lists exactly the halves that failed.
   *
   * LIVE, THROUGH AN EMPTY NAME -- and only an empty one. Ingest requires the
   * provider NUMBER and never looks at the name, so this half has no ingest
   * twin at all. But `ProviderDto.name` is a REQUIRED `@IsString()`, so an
   * envelope that OMITS the name is refused at the boundary with a 400 and
   * never becomes a print record. An EMPTY STRING passes that DTO and is what
   * `read()` treats as absent, so the reachable fault is a template that
   * emitted the provider line without finding a value in it -- the ordinary
   * shape of a half-read line, and it leaves the patient looking at a form
   * that does not say who they are assigning to.
   *
   * THE NAME IS THE HALF THE PATIENT READS. A provider number means nothing
   * to the person being asked to check the form; the name is the whole of
   * what they can verify on that line.
   */
  'print_record_servicing_provider_name_missing',
  /**
   * THE SERVICING PROVIDER'S PROVIDER NUMBER IS MISSING.
   *
   * BACKSTOP -- ingest refuses `no_servicing_provider` without a provider
   * number, so this cannot fire on any agreement that exists today. It is the
   * fourth backstop, and splitting the old joint code is what revealed that:
   * the joint code was declared as gated at ingest on the strength of its
   * NUMBER half while being live through its NAME half, which is two
   * different answers to one question. Separated, each half states its own
   * reachability truthfully.
   *
   * THE NUMBER IS THE HALF THE PRACTICE READS. It is the number that goes on
   * the claim (s 65C(5)(a)) and the one the assignment is WITH.
   */
  'print_record_servicing_provider_number_missing',
  /**
   * NO DATE OF SERVICE ANYWHERE ON THE RECORD — neither on the form nor on any
   * of its service rows. Read exactly as `db4-assignment.handler.ts` reads it,
   * form first and rows second, because a DB4 prints the same date in both
   * places and disagreeing with the handler about where to look would produce
   * two different answers about one page.
   *
   * BACKSTOP — that same handler refuses `no_service_date` when it finds none.
   */
  'print_record_service_date_missing',
  /**
   * NOT ONE SERVICE ROW CARRIES A BENEFIT — Carl's *"if no $ do not allow the
   * approval to progress"*, and THE ONE GENUINELY NEW CHECK HERE. Nothing
   * anywhere upstream looks at an amount: ingest does not, the rules engine
   * does not and must not (hard rule 4), and the particulars have no field for
   * one. A record whose amount column the template lost places an agreement
   * and reaches a tablet today.
   *
   * PRESENCE, NEVER VALUE. This asks whether the string PracSoft printed
   * survived the parse. It does not read the figure, does not check that it is
   * a figure, and does not care what it says: `"0.00"` passes, `"1,234.55"`
   * passes, and so does anything else non-empty. Deciding that a zero means
   * "no amount" would be AoB interpreting a figure, which is precisely what
   * hard rule 4 forbids.
   *
   * ONE ROW IS ENOUGH. A form may legitimately list a row the practice is not
   * claiming a benefit on, and refusing a whole push over one blank cell would
   * be a stricter rule than the one Carl gave.
   *
   * IT OVERLAPS `print_record_services_missing` ON PURPOSE. A record with no
   * rows reports both, because both are true and each is separately worth
   * knowing; neither is suppressed to make a tidier list.
   */
  'print_record_benefit_missing',
  /**
   * AOBPRINTER SAW SERVICE LINES IT COULD NOT READ (Opus review, 10 October
   * 2026; D-2026-10-11-05).
   *
   * LIVE, AND IT CLOSES THE HOLE THE AMOUNT CHECK LEAVES. That check asks
   * whether ANY row carries an amount, so a form with one row lost among
   * several passed it: a credit (`-$10.00`, `($10.00)`), a whole-dollar amount
   * (`$45`) or a row printed with no amount did not match either shipped
   * template's row pattern and simply vanished from `services`. The patient
   * would then read, and sign, a copy of their form missing a service.
   *
   * READ FROM `unparsedServiceLines`, A COUNT THE DESKTOP SENDS — never the
   * lines themselves. The count is not a patient's (hard rule 9): it rides on
   * `Db4PrintRecordIdentity` so the band can say HOW MANY and on WHICH FORM.
   *
   * CONDITIONAL ON THE COUNT BEING THERE. A record from an AOBPRINTER that
   * predates the count carries none, and is not refused: nobody observed a
   * lost row, and refusing every push from every desktop not yet upgraded
   * would stop working practices over nothing (hard rule 8).
   *
   * REPRINTING DOES NOT FIX IT. The same layout prints the same lines, so the
   * console's copy for this one must not promise that it does (wow.md §13).
   */
  'print_record_service_lines_unread',
  /**
   * THE PRINTED NAME IS NOT THE NAME ON RECORD FOR THAT PMS PATIENT ID (Carl,
   * 11 October 2026; D-2026-10-11-06): *"STOP and tell Reception that PMS is
   * sending a diff name for PMSID xxx. Is this correct?"*
   *
   * LIVE. A DB4 is matched to a patient on the PMS patient ID and on nothing
   * else (hard rule 1), so ingest never compares names. A form printing one
   * name against another patient's ID placed an agreement for the patient on
   * record, and the tablet would have shown them a form in somebody else's
   * name.
   *
   * ONE COMPARISON, SHARED WITH THE DESK'S WARNING BAND (D-2026-10-10-11):
   * `db4PrintedNamePartsDiffering` in `db4-printed-name.ts`, so the band and
   * this refusal can never disagree (Carl, 11 October 2026). Given and family
   * names are compared separately, only where printed; case, spacing, NFC and
   * typographic apostrophes and dashes are ignored, and nothing else is. A
   * middle name, a spelling, or a two-word family name split differently by
   * the template is refused, and reception decides which side is right.
   *
   * A CODE, NEVER EITHER NAME (hard rule 9). The console already shows the
   * name on record and the PMS patient ID on the row; it composes the
   * question from those, and the printed name stays on the print record.
   *
   * NEVER BESIDE `print_record_patient_unidentified`: that one needs no name
   * printed and this one needs a name to compare.
   */
  'print_record_patient_name_differs',
] as const;

/** One failed check. Never a value, never a sentence — see the header. */
export type Db4PrintRecordCheck = (typeof DB4_PRINT_RECORD_CHECKS)[number];

/**
 * WHICH INGEST REFUSAL ALREADY COVERS WHICH CHECK — the backstop declaration,
 * written down rather than remembered.
 *
 * `null` means no ingest gate looks at this at all, so the check is the only
 * thing standing there. Anything else names the `Db4PlacementReason` that
 * refuses the same envelope before an agreement is ever created, which makes
 * that check a second line rather than the first.
 *
 * IT IS HERE SO THE TWO VOCABULARIES LINE UP WITHOUT BEING MERGED. They answer
 * different questions for different audiences — "why did this form produce no
 * agreement", asked of a job row, against "why will this agreement not go to a
 * tablet", asked at a desk — and one union covering both would let a placement
 * reason be thrown as a push refusal. The correspondence is the useful part,
 * not the identity, and a console showing either can say they are the same
 * fault seen from two ends.
 */
export const DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST: Readonly<
  Record<Db4PrintRecordCheck, Db4PlacementReason | null>
> = {
  print_record_patient_unidentified: 'no_chart_number',
  // THE SECOND GAP. `irn` is `@IsOptional()` at ingest and nothing downstream
  // asks for it, so this check is the only thing standing there.
  print_record_irn_missing: null,
  // No rows means no item numbers, which is the gate ingest actually applies.
  print_record_services_missing: 'no_service_items',
  // THE THIRD GAP, and the reason the joint code had to be split. Ingest
  // never looks at the provider's NAME at all.
  print_record_servicing_provider_name_missing: null,
  // The NUMBER half, which ingest does gate -- `no_servicing_provider`.
  print_record_servicing_provider_number_missing: 'no_servicing_provider',
  print_record_service_date_missing: 'no_service_date',
  // THE GAP. Nothing upstream reads an amount, and nothing should compute one.
  print_record_benefit_missing: null,
  // Ingest places an agreement from the rows it has and never reads the count.
  print_record_service_lines_unread: null,
  // Ingest matches on the PMS patient ID alone and never compares names.
  print_record_patient_name_differs: null,
};

/**
 * THE REFUSAL ITSELF, NAMED ONCE AND READ BY BOTH SIDES.
 *
 * The push answers with this code and the FULL list of failed checks, never
 * just the first: reception fixes the form once rather than pressing Send five
 * times to be told five things (CLAUDE.md §7). The console keys its copy off
 * the individual checks; this code is what tells it which list it is reading.
 *
 * IT IS NOT `agreement_not_pushable`, which would be a lie. The agreement is
 * fine — its particulars are locked, complete and validated. It is the DB4
 * Print Record behind them that we cannot vouch for.
 */
export const DB4_PRINT_RECORD_REFUSED_CODE = 'print_record_incomplete';


/**
 * WHICH PRINT RECORD THE REFUSAL IS ABOUT (Carl, 27 September 2026, at the
 * desk: *"message needs to say what data is missing on the print and also
 * some unique id to identify the print and the location of the file"*, and
 * then — correctly — *"we must have some unique ref from AOBPrinter which we
 * must be storing for audit"*).
 *
 * THE CHECKS SAY WHAT IS MISSING; THIS SAYS WHICH PAGE. A practice prints all
 * morning, and “reprint the form” is not an instruction anybody can follow
 * until they know WHICH form — so the refusal names it. Without this the band
 * is CLAUDE.md §7's dead end wearing a longer sentence.
 *
 * ── AOBPRINTER'S OWN REF IS `sourceSha256`, AND IT IS THE AUDIT KEY ──
 *
 * It is not merely stored, it is the IDENTITY of a print job:
 * `@@unique([practiceId, documentType, sourceSha256])` on `InboundPrintJob` is
 * what makes the same document printed twice the same job rather than two.
 * Everything else here is a convenience for a human; this is the ref that ties
 * a record to the bytes AOBPRINTER hashed at the practice.
 *
 * ── THERE IS STILL NO FILE PATH, AND THE QUEUE IS THE HONEST SUBSTITUTE ──
 *
 * NOTHING IN THIS PLATFORM EVER HELD THE FILE. AOBPRINTER parses the print job
 * at the practice and sends the PARSED RECORD plus the hash of the source
 * bytes — `sourceSha256` is commented *"provenance without possession (8.2)"*
 * and that is the design. No path, spool id or file name is captured by the
 * envelope (`print-capture.ts`), accepted by the DTO
 * (`inbound-print-jobs.controller.ts`) or stored on the row, so there is
 * nothing of that kind to report and a plausible-looking path would be worse
 * than saying so.
 *
 * WHAT DOES ANSWER “WHERE DID THIS COME FROM” is the pair the envelope
 * already carries: `queueName`/`queueLabel`, the print queue the form came
 * off, described in `print-capture.ts` as *"attribution, never PII"*. At a
 * practice with a printer at the front desk and another in the treatment room
 * that is the location somebody can actually walk to, which a spool path on a
 * clinical workstation is not.
 *
 * ── AND NOT ONE FIELD HERE IS A PATIENT'S ──
 *
 * Hard rule 9 (REQ-VER-04) and REQ-LOG-08. A form reference, a job id, a
 * queue name, two timestamps, a template version and a hash of the source
 * describe the DOCUMENT AND THE MACHINERY. There is no name, no chart number,
 * no card number, no address and no amount, which is what lets this ride in
 * an HTTP body, sit in a support ticket and be read aloud over a phone.
 */
export interface Db4PrintRecordIdentity {
  /** The `InboundPrintJob` row — our id for it. */
  readonly printJobId: string;
  /**
   * AOBPRINTER'S UNIQUE REF, and the audit key (see above). SHA-256 hex of the
   * source print job: provenance without possession (8.2). This is what exists
   * INSTEAD of a file.
   */
  readonly sourceSha256: string;
  /**
   * WHAT IS PRINTED ON THE PAGE — the reference reception matches against the
   * paper in their hand and the record in PracSoft.
   *
   * OPTIONAL IN THE TYPE, PRESENT ON EVERY AGREEMENT THAT EXISTS. An earlier
   * version of this comment said it was *"absent when the template could not
   * read it, which is a real state"*; it is not one, and seeding a record
   * without it to see what happened is how that was found (28 September
   * 2026). `db4-assignment.handler.ts` refuses such an envelope at ingest as
   * `no_form_reference`, so it never becomes an agreement and never reaches a
   * push. The field stays optional because the TYPE describes an envelope,
   * which may legitimately lack one; the BAND still renders without it,
   * because a band that throws on a field the type allows to be missing is a
   * worse failure than a missing row.
   */
  readonly formReference?: string;
  /**
   * WHICH PRINT QUEUE PRODUCED IT. Attribution, never PII
   * (`print-capture.ts`). The nearest honest answer to *"where did this come
   * from"*, and at a practice with more than one printer it is the useful one.
   */
  readonly queueName?: string;
  readonly queueLabel?: string;
  /** When AOBPRINTER captured it, BY THE DESKTOP'S CLOCK. ISO 8601. */
  readonly capturedAt?: string;
  /** When this platform received it, by the server's. ISO 8601. */
  readonly receivedAt: string;
  /**
   * WHICH PARSER TEMPLATE READ THE FORM (8.2). The first thing worth knowing
   * when a field is missing: a PracSoft layout change against an older
   * template is the ordinary cause of everything these checks detect.
   */
  readonly parserTemplateVersion?: string;
  /**
   * HOW MANY SERVICE LINES THAT TEMPLATE COULD NOT READ (D-2026-10-11-05).
   * A count about the machinery, never a line's content, so it sits with the
   * rest of the identity: `print_record_service_lines_unread` names the fault
   * and this says how many, so the band can say "2 service lines on form …".
   * Absent on a record from a desktop that predates the count.
   */
  readonly unparsedServiceLines?: number;
}
