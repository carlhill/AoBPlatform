import type {
  Db4FormView,
  Db4FormViewProvider,
  Db4FormViewService,
  Db4FormViewStatement,
  Db4PrintRecordCheck,
  PrintJobEnvelope,
} from '@aobplatform/contracts';
import { db4PrintedNamePartsDiffering } from '@aobplatform/contracts';

/* ---------------------------------------------------------------------------
 * THE DB4 AS THE PATIENT READS IT — built here, on the server, once.
 *
 * D-2026-09-27-01: *"patient sees the db4 with the cost on it"* and *"mask on
 * the tablet, full on the form"*. The tablet draws the practice's own form
 * rather than an abstraction of it, so a patient who has seen the paper
 * recognises the screen.
 *
 * A PROJECTION OF THE SAME ENVELOPE `SignedDb4Service.documentFor` HANDS THE
 * RENDERER, minus the signature and minus the card number. That symmetry is
 * the point: one source — the DB4 Print Record — and three renderings of it
 * (the tablet, the Assignment Agreement, the Signed-DB4). A sentence composed
 * on the client would be a second copy of the operative words of a contract,
 * free to drift from the one that was signed.
 *
 * EVERY VALUE IS COPIED, NOT ONE IS COMPUTED. No parsing, no reformatting, no
 * defaulting, no inference and above all no total: hard rule 4 as narrowed by
 * D-2026-09-14-02 — AoB never originates or computes an amount; it may
 * reproduce the amount the practice's billing software printed. `text()` below
 * is the whole of the conversion, and it converts nothing: a value that is not
 * already a string is absent.
 *
 * NOTHING HERE IS HASHED, STORED OR WRITTEN BACK (hard rule 13). The block
 * rides on a response and dies with it. It is not in the locked particulars,
 * it does not enter `renderPayload`, and it cannot move a byte of the
 * Assignment Agreement.
 *
 * PURE, AND IT NEVER THROWS (hard rule 8). The envelope is JSON off a queue
 * row, typed by a cast — every field may be absent, and any field may be the
 * wrong shape. A form view that could throw would be a patient unable to sign
 * because a picture of their form could not be drawn.
 * ------------------------------------------------------------------------- */

/** The character the masks are built from — the same glyph `maskMobile` uses. */
const DOT = '•';

/**
 * WHAT A MASKED CARD NUMBER LOOKS LIKE: `••• ••••• 1`. Three groups, because
 * that is how the number is printed, and a FIXED number of dots in the first
 * two, because a proportional mask says how long the value is (the reasoning
 * `maskEmail` and `maskMobile` already record in `packages/domain`).
 */
/**
 * NOTHING REVEALED — and shaped like the card, `•••• ••••• •`, so a patient
 * comparing the screen to the thing in their wallet is looking at the same
 * 4-5-1 grouping either way.
 */
const MASK_GROUPS = `${DOT.repeat(4)} ${DOT.repeat(5)} ${DOT}`;

/**
 * THE LEADING SIX, WHICH NEVER LEAVE THIS PROCESS: the whole first group and
 * the first two of the second.
 */
const MASK_LEAD = `${DOT.repeat(4)} ${DOT.repeat(2)}`;

/**
 * HOW MANY DIGITS THE PATIENT IS SHOWN (Carl, 27 September 2026, from a live
 * tablet: *"show the last 4 digits of the medicare number. Showing just a
 * single digit does not help"*).
 *
 * IT WAS ONE, AND ONE DID NOT DO THE JOB THE FIELD IS THERE FOR. The screen
 * asks the patient to check what is shown against the card they are holding
 * (`strings.chrome` → `maskedCardNote`), and a single issue digit is not
 * something anybody can check anything against — nearly every card in the room
 * would match it.
 */
const DIGITS_SHOWN = 4;

/**
 * BELOW THIS MANY DIGITS NOTHING IS REVEALED. A Medicare card number has ten,
 * and revealing four of a value with eight would be giving away half of
 * whatever the parser actually read. Raised from four with `DIGITS_SHOWN`: the
 * threshold has to move when the reveal does, or a short misparse leaks a
 * larger fraction of itself than a real card number would.
 */
const MIN_DIGITS_TO_REVEAL = 8;

/**
 * `2454 23237 1` → `•••• ••237 1`.
 *
 * ENOUGH TO RECOGNISE, NOT ENOUGH TO HARVEST — D-2026-09-27-01 part 3, which
 * amends D-2026-09-14-03 for the screen and only for the screen. A sheet of
 * paper is handed to one person; a tablet is held up in a waiting room with
 * other patients three seats away, and a Medicare card number is a high-value
 * fraud identifier. The form in the chart folder still prints it in full.
 *
 * WHY FOUR, AND WHY THESE FOUR (Carl, 27 September 2026, amending his own
 * ruling of the same day: *"show the last 4 digits of the medicare number.
 * Showing just a single digit does not help"*). The first version showed only
 * the issue digit, on the reasoning that it identifies nobody by itself — true,
 * and useless: the screen asks the patient to CHECK what is shown against the
 * card in their hand, and one digit in ten matches almost any card in the
 * room. Four is the convention a bank statement uses for the same job, and it
 * leaves the six that make the number usable inside this process.
 *
 * THE GROUPING IS THE CARD'S OWN, 4-5-1, so the revealed digits sit where the
 * patient's eye already expects them. Beside them the tablet shows the IRN as
 * printed — one digit, identifying nobody — and between them the patient can
 * see that the form is about their card and their position on it.
 *
 * HARD RULE 1 IS UNTOUCHED. This value is never used to verify a patient,
 * never to find or match one, never written to a log, an error message or a
 * vault event, and never sent to the rules service. It is content on a form,
 * redacted, on its way to a screen.
 *
 * IT NEVER THROWS AND IT NEVER PASSES ANYTHING THROUGH. Absent, empty, short,
 * lettered or absurdly long, the answer is a mask or nothing at all — there is
 * no input for which some part of an unrecognised value is returned verbatim.
 */
// eslint-disable-next-line no-restricted-syntax -- the name is the point: see D-2026-09-27-01 part 3 and the note above.
export function maskMedicareCardNumber(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return value.trim().length > 0 ? MASK_GROUPS : undefined;
  if (digits.length < MIN_DIGITS_TO_REVEAL) return MASK_GROUPS;
  // The last four, split where the card splits them: three close the middle
  // group, the issue digit stands alone.
  const shown = digits.slice(-DIGITS_SHOWN);
  return `${MASK_LEAD}${shown.slice(0, -1)} ${shown.slice(-1)}`;
}

/** A string the parser found, or nothing. Never a coercion — see the header. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > 0 ? value : undefined;
}

/** The strings in an array, in order, or nothing when there are none. */
function textLines(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((line): line is string => typeof line === 'string' && line.length > 0);
  return kept.length > 0 ? kept : undefined;
}

/** The objects in an array, in order. A malformed entry is skipped, never repaired. */
function rows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

/**
 * THE PATIENT BLOCK, WITH THE ONE REDACTION.
 *
 * Everything else is what the form prints: the name, the chart number, the
 * date of birth and the address. The chart number is the only key a DB4 is
 * matched on (hard rule 1) and it is already on the practice's paper.
 */
function patientOf(envelope: Record<string, unknown>): Db4FormView['patient'] {
  const patient = (envelope.patient ?? {}) as Record<string, unknown>;
  return {
    givenNames: text(patient.givenNames),
    familyName: text(patient.familyName),
    dateOfBirth: text(patient.dateOfBirth),
    address: text(patient.address),
    patientRecordNumber: text(patient.patientRecordNumber),
    /*
     * THE ONE PLACE IN THIS FILE THAT READS THE NUMBER, and the value goes
     * straight into the mask and nowhere else. It is not returned, not logged,
     * not stored and not put in an event — the masked string is the only thing
     * that exists past this line.
     */
    // eslint-disable-next-line no-restricted-syntax -- read only to be masked (D-2026-09-27-01 part 3).
    medicareCardNumberMasked: maskMedicareCardNumber(patient.medicareCardNumber),
    irn: text(patient.irn),
  };
}

/**
 * THE SERVICING LOCATION, LAID OUT AS THE FORM LAYS IT OUT — the address lines
 * as printed and then the suburb/state/postcode line, assembled exactly as
 * `SignedDb4Renderer.drawServicingLocation` assembles it, so the screen and the
 * chart-folder form read the same.
 */
function locationLines(envelope: Record<string, unknown>): readonly string[] | undefined {
  const location = (envelope.servicingLocation ?? {}) as Record<string, unknown>;
  const suburbLine = [location.suburb, location.state, location.postcode]
    .map((part) => text(part))
    .filter((part): part is string => !!part)
    .join(' ');
  const all = [...(textLines(location.addressLines) ?? []), ...(suburbLine.length > 0 ? [suburbLine] : [])];
  return all.length > 0 ? all : undefined;
}

/**
 * BOTH PROVIDERS, BECAUSE BOTH ARE ON THE FORM — the servicing one anchors the
 * visit (s 65C(5)(a)) and the payee is printed beside it. `drawProviders`
 * draws both for the same reason: a reproduction that dropped one would not be
 * the same form.
 */
function providersOf(envelope: Record<string, unknown>): readonly Db4FormViewProvider[] | undefined {
  const providers = rows(envelope.providers).map((provider) => ({
    name: text(provider.name),
    providerNumber: text(provider.providerNumber),
    role: text(provider.role),
  }));
  return providers.length > 0 ? providers : undefined;
}

/**
 * THE SERVICE ROWS, WITH THE AMOUNT PRACSOFT PRINTED (D-2026-09-27-01 part 2).
 *
 * `benefitAssigned` is carried as the STRING on the page. It is not parsed to
 * a number, not reformatted, not summed and not totalled: hard rule 4 as
 * narrowed forbids AoB originating a figure, and a total would be one even
 * when it agrees with the paper. A row whose amount the parser could not read
 * simply has none, and the screen says so in its own words.
 */
function servicesOf(envelope: Record<string, unknown>): readonly Db4FormViewService[] | undefined {
  const services = rows(envelope.services).map((service) => ({
    serviceDate: text(service.serviceDate),
    mbsItemNumber: text(service.mbsItemNumber),
    description: text(service.description),
    benefitAssigned: text(service.benefitAssigned),
  }));
  return services.length > 0 ? services : undefined;
}

/**
 * THE IN-SCOPE STATEMENTS ONLY, FILTERED EXACTLY AS THE FORM IS.
 *
 * `SignedDb4Renderer.drawAssignment` keeps `inScope !== false` and this keeps
 * the same, character for character, so the screen and the chart-folder form
 * agree about what the patient is assigning. The statement that is dropped is
 * the offer to assign to an Approved Pathology Practitioner — s 65C(4) items
 * 1–4, out of this product's scope (CLAUDE.md §8) — and the patient's mark must
 * not sit under an assignment this product does not validate, store or write
 * back. Absent means in scope, so a form read by an older parser template still
 * shows its assignment statement.
 */
function statementsOf(envelope: Record<string, unknown>): readonly Db4FormViewStatement[] | undefined {
  const assignment = (envelope.assignment ?? {}) as Record<string, unknown>;
  const statements = rows(assignment.statements)
    .filter((statement) => statement.inScope !== false)
    .map((statement) => ({ key: text(statement.key), text: text(statement.text) }));
  return statements.length > 0 ? statements : undefined;
}

/**
 * THE BLOCK THE LOCK RESPONSE CARRIES for a session that came from a DB4 Print
 * Record — and nothing at all for every other session, which is where
 * D-2026-09-27-02 lives: a practice with no PMS has no print record, so the
 * caller builds no block and the tablet draws exactly what it drew before this
 * feature existed.
 */
export function buildDb4FormView(envelope: PrintJobEnvelope): Db4FormView | undefined {
  // The envelope is a cast over JSON from a queue row. Anything may be
  // missing or the wrong shape, and nothing here may throw (hard rule 8).
  const source = (envelope ?? {}) as unknown as Record<string, unknown>;
  const form = (source.form ?? {}) as Record<string, unknown>;
  const location = (source.servicingLocation ?? {}) as Record<string, unknown>;
  const assignment = (source.assignment ?? {}) as Record<string, unknown>;
  const heading = (source.heading ?? {}) as Record<string, unknown>;

  const patient = patientOf(source);
  const services = servicesOf(source);

  /*
   * A VIEW WITH NOTHING ON IT IS WORSE THAN NO VIEW AT ALL, so it is not
   * returned. Found in review, 27 September 2026, and it is the one defect in
   * this feature that would have reached a patient.
   *
   * K-3 draws the DB4 block INSTEAD OF the rows it repeats — patient,
   * provider, place of practice, date of service, service description, item
   * numbers. The client's discriminator is truthiness, so a block that exists
   * but carries nothing suppressed all six and drew an empty frame: the
   * assignor would have affirmed and signed with essentially no particulars in
   * front of them, while the locked particulars behind them were complete.
   * Nothing is BLOCKED, so hard rule 8 is not breached — but it lands next to
   * what hard rule 2 is for, and it is strictly worse than the behaviour
   * before this feature existed.
   *
   * It is reachable. The inbound handler's gates guarantee a chart number, a
   * servicing provider, service items and a service date exist IN THE
   * AGREEMENT; they guarantee nothing about what the PARSER could read off the
   * page. Every field here is independently optional by the parser's own
   * contract — "a field AOBPRINTER cannot find on the page is ABSENT"
   * (`print-capture.ts`) — so a PracSoft layout change that partly defeats a
   * template, which is the exact thing `parserTemplateVersion` exists to
   * track, degrades the screen rather than the pipeline.
   *
   * THE TEST IS DELIBERATELY STRICT: a name AND at least one service row. The
   * fallback is not a worse screen, it is the ORIGINAL screen, drawn from the
   * locked particulars — which hard rule 2 guarantees are complete, where this
   * projection guarantees nothing. When the two disagree about how much is
   * known, the complete one should win.
   */
  const hasName = !!(patient?.givenNames ?? patient?.familyName);
  const hasServices = (services?.length ?? 0) > 0;
  if (!hasName || !hasServices) return undefined;

  return {
    /*
     * THE FORM'S OWN HEADING, VERBATIM, INCLUDING THE LINE THAT CALLS IT AN
     * APPROVED FORM. Hard rule 12 forbids US claiming approval for OUR forms;
     * it does not let us edit the government's words off the government's
     * page. The renderer reproduces the same four lines and says whose page it
     * is in the footer, and the tablet carries the same footer.
     */
    headingLines: textLines(heading.lines),
    formCode: text(form.formCode),
    formReference: text(form.formReference),
    serviceDate: text(form.serviceDate),
    servicingLocationName: text(location.name),
    servicingLocationAddressLines: locationLines(source),
    patient,
    providers: providersOf(source),
    services,
    privacyNotice: textLines(assignment.privacyNotice),
    statements: statementsOf(source),
    /*
     * PROVENANCE, FOR A TEST DEVICE'S FOOTER. An identifier, not content
     * (hard rule 9), and the only trace of the printed bytes that still
     * exists — D-2026-09-14-02 kept the record and the hash and dropped the
     * PracSoft PDF entirely.
     */
    sourceSha256: text(source.sourceSha256),
    parserTemplateVersion: text(source.parserTemplateVersion),
  };
}

/* ---------------------------------------------------------------------------
 * AND THE SAME ENVELOPE, ASKED A DIFFERENT QUESTION: DO WE BELIEVE THIS
 * REPRODUCTION ENOUGH TO PUT IT IN FRONT OF A PATIENT?
 *
 * Carl, 27 September 2026, from a live tablet: *"If no $ do not allow the
 * approval to progress. Check all details when the reception pushes to the
 * tablet."*
 *
 * WHY IT LIVES IN THIS FILE. It reads the SAME `PrintJobEnvelope` the
 * projection above is built from, under the same rule — a value that is not
 * already a non-empty string is ABSENT, never coerced — and it uses the same
 * `text()` and `rows()` to apply it. In a file of its own those two helpers
 * would have to be exported or copied, and a copy is how the check and the
 * projection come to disagree about what "the parser read a name" means. One
 * envelope, one set of readers.
 *
 * IT IS PURE AND IT DECIDES NOTHING. It returns facts about a record; the push
 * path turns them into a refusal, and that separation is what lets every case
 * below be tested without a database, a device or a session.
 *
 * ── IT IS A CONFIDENCE CHECK, NOT A STATUTORY VALIDATION ──
 *
 * NO DOLLAR AMOUNT IS IN THE s 65C DATA SET (hard rule 4, REQ-REG-04), so an
 * agreement with no amount is statutorily COMPLETE and nothing here says
 * otherwise. What a missing benefit means is that our own reproduction is
 * probably wrong: a real PracSoft DB4 for a bulk-bill claim prints a benefit
 * against its rows, so a record carrying none most likely means AOBPRINTER's
 * template did not read the form — which is what `parserTemplateVersion`
 * exists to track, and what a PracSoft layout change looks like from here.
 *
 * NOTHING HERE ORIGINATES, PARSES OR COMPUTES AN AMOUNT. `benefitAssigned` is
 * tested for PRESENCE and never converted to a number, compared, summed or
 * reformatted (D-2026-09-14-02). `"0.00"` passes: deciding a zero means "no
 * amount" would be AoB forming an opinion about a figure.
 *
 * ── THE REFUSAL BELONGS AT THE DESK (hard rule 8, REQ-REC-04) ──
 *
 * The tablet-side block was put to Carl and he rejected it. A refusal when
 * reception presses Push is a redirect somebody can act on — reprint, or
 * paper, or capture after the service — and the patient is seen and billed
 * either way. A dead Continue button in front of somebody who has already sat
 * down is what that rule exists to prevent, and the person looking at it is
 * the one person in the building who cannot fix a print record.
 *
 * ── THREE OF THESE ARE THE GUARD; FOUR ARE A BACKSTOP ──
 *
 * `db4-assignment.handler.ts` ORIGINATES every `Agreement.sourcePrintJobId`,
 * and it writes one only after its own gates have passed on this same
 * envelope. A record with no chart number, no MBS item numbers, no servicing
 * provider number or no service date is refused there as `no_chart_number` /
 * `no_service_items` / `no_servicing_provider` / `no_service_date` and NEVER
 * BECOMES AN AGREEMENT, so those four checks cannot fire on any row that
 * exists today.
 *
 * IT IS NO LONGER THE ONLY WRITER, AND THAT DOES NOT WEAKEN THE ABOVE.
 * `createSupersedingDraft` copies the column onto a replacement (28 September
 * 2026) — but it copies an id the handler already vetted, so every value in
 * that column still came through those gates. The claim that matters is
 * ORIGINATION, not exclusivity, and an earlier version of this comment said
 * the wrong one of the two.
 *
 * They are kept because that invariant is a fact about today's code — one
 * writer, gating on those fields first — rather than a structural one, and
 * because an ingest gate relaxed in six months should meet a check that is
 * already standing. `DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST` states the
 * correspondence field by field and a named test pins it, so their backstop
 * status is declared rather than assumed.
 *
 * WHAT IS ACTUALLY LIVE: the benefit (nothing upstream looks at an amount),
 * and the servicing provider's NAME (ingest requires only their number).
 * ------------------------------------------------------------------------- */

/**
 * A FIELD THE TEMPLATE ACTUALLY READ — a string with something in it once
 * trimmed.
 *
 * THE CHECK TRIMS WHERE THE PROJECTION DOES NOT, and that difference is the
 * point rather than an inconsistency. `text()` copies the form VERBATIM,
 * because what the projection draws must be what the page said, spaces and
 * all. This asks a different question — is there anything there — and a cell
 * holding three spaces holds nothing. It is the same reading
 * `db4-assignment.handler.ts` takes of its own gates, which trim the form
 * reference, the chart number and every item number before testing them.
 *
 * IT IS NOT A COERCION AND NOT A PARSE. Nothing that was not already a string
 * comes back, and the string that comes back is never READ — only its
 * existence is, which is what keeps the benefit check clear of hard rule 4.
 */
function read(value: unknown): string | undefined {
  const found = text(value)?.trim();
  return found && found.length > 0 ? found : undefined;
}

/**
 * WHICH PROVIDER THE ASSIGNMENT IS WITH — `role === 'servicing'`, exactly as
 * `db4-assignment.handler.ts` picks it. The payee is on the form too and is
 * not a substitute: the servicing provider is the one whose number goes on the
 * claim (s 65C(5)(a)) and the one the patient is assigning to.
 */
function servicingProviderOf(source: Record<string, unknown>): Record<string, unknown> | undefined {
  return rows(source.providers).find((provider) => provider.role === 'servicing');
}

/**
 * A DATE OF SERVICE ANYWHERE ON THE RECORD — the form first, its rows second,
 * which is the order `db4-assignment.handler.ts` reads it in. A DB4 prints the
 * same date in both places; looking in a different order would give two
 * different answers about one page.
 */
function anyServiceDateIn(source: Record<string, unknown>): string | undefined {
  const form = (source.form ?? {}) as Record<string, unknown>;
  return read(form.serviceDate) ?? rows(source.services).map((service) => read(service.serviceDate)).find(Boolean);
}

/** The name of the patient the agreement is FOR, as our record holds it. */
export interface PatientNameOnRecord {
  readonly givenNames?: string | null;
  readonly familyName?: string | null;
}

/**
 * THE CHECKS THIS PRINT RECORD FAILS, ALL OF THEM, IN THE DECLARED ORDER.
 *
 * ALL OF THEM, NOT THE FIRST. Reception fixes the form once; returning one
 * failure at a time would have somebody press Send five times to be told five
 * things, with a patient waiting through every press (CLAUDE.md §7).
 *
 * AN EMPTY ARRAY MEANS THE RECORD IS FINE, and it is the answer for every
 * envelope this function cannot make sense of as well — see below.
 *
 * IT NEVER THROWS (hard rule 8). The envelope is JSON off a queue row typed by
 * a cast: every field may be absent and any field may be the wrong shape. A
 * throw here would be a platform fault stopping a push at a desk, where the
 * entire point of this check is that its refusal is something staff can act
 * on.
 *
 * AND IT RETURNS CODES, NEVER CONTENT (hard rule 9, REQ-VER-04). Not one of
 * these values can carry a name, a chart number, a card number, an address, an
 * item number or an amount, which is what makes them safe in an HTTP body, a
 * log line and a vault event.
 */
export function checkDb4PrintRecord(
  envelope: PrintJobEnvelope,
  /*
   * THE PATIENT ON RECORD, when the caller has one. Optional because the
   * envelope alone cannot say who the agreement is for; a caller that does
   * not pass it is not asked the name question (D-2026-10-11-06).
   */
  onRecord?: PatientNameOnRecord | null,
): readonly Db4PrintRecordCheck[] {
  const source = (envelope ?? {}) as unknown as Record<string, unknown>;
  const patient = (source.patient ?? {}) as Record<string, unknown>;
  const services = rows(source.services);
  const servicing = servicingProviderOf(source);

  const failed: Db4PrintRecordCheck[] = [];

  /*
   * BACKSTOP (ingest: `no_chart_number`). BOTH absent, not either: a chart
   * number with no name is reachable and is deliberately allowed through,
   * because `buildDb4FormView` already declines to build a view in that case
   * and the tablet falls back to the original screen drawn from the locked
   * particulars. That fallback costs a picture of a form; a refusal would cost
   * the push.
   */
  const identified =
    !!(read(patient.givenNames) ?? read(patient.familyName)) || !!read(patient.patientRecordNumber);
  if (!identified) failed.push('print_record_patient_unidentified');

  /*
   * A CARD NUMBER WITH NO IRN BESIDE IT (Carl, 27 September 2026: *"if a
   * medicare# is provided then the IRN must also be provided. Check this on
   * button 'Send to tablet' at reception"*).
   *
   * CONDITIONAL ON THE CARD NUMBER, exactly as Carl put it. A record carrying
   * neither is the `no-card-number` case and passes here: the tablet draws
   * neither field and the masking note is not drawn either, so nothing on the
   * screen refers to anything that is missing. What is refused is the
   * HALF-READ card — the state where `ParticularsScreen` shows a masked card
   * number and a note telling the patient to check *"the IRN beside your
   * name"*, with no IRN row on the page to check.
   *
   * PRESENCE, NEVER VALUE, AND NOT AN IDENTITY CHECK (hard rules 1 and 9).
   * `read()` is the whole test. Nothing here parses the digit, range-checks
   * it, or treats the card as identifying anybody: the Medicare card number is
   * NOT an identity identifier (REQ-VER-02).
   */
  // eslint-disable-next-line no-restricted-syntax -- PRESENCE only, never read as an identifier (hard rule 1).
  if (read(patient.medicareCardNumber) && !read(patient.irn)) {
    failed.push('print_record_irn_missing');
  }

  /* BACKSTOP (ingest: `no_service_items`). A DB4 exists to list services. */
  if (services.length === 0) failed.push('print_record_services_missing');

  /*
   * NAME AND NUMBER ARE TWO CHECKS, NOT ONE (Carl, 28 September 2026, at the
   * desk: *"IRN, provider's name or provider number (be specific - which
   * one)"*). The form prints both and the two readers differ — the patient
   * checks the name, the practice checks the number — so a band that says
   * "name or number" leaves reception looking at a line where one of the two
   * is plainly there.
   *
   * NO SERVICING PROVIDER AT ALL FAILS BOTH, because both halves are then
   * genuinely unreadable and each is separately true.
   *
   * THE NAME HALF IS LIVE, through an EMPTY name and only an empty one:
   * `ProviderDto.name` is a required `@IsString()`, so an ABSENT name is
   * refused at the boundary and an empty one is not. The NUMBER half is a
   * backstop — ingest refuses `no_servicing_provider` without it.
   */
  if (!servicing || !read(servicing.name)) {
    failed.push('print_record_servicing_provider_name_missing');
  }
  if (!servicing || !read(servicing.providerNumber)) {
    failed.push('print_record_servicing_provider_number_missing');
  }

  /* BACKSTOP (ingest: `no_service_date`). */
  if (!anyServiceDateIn(source)) failed.push('print_record_service_date_missing');

  /*
   * THE ONE GENUINELY NEW CHECK — Carl's *"if no $ do not allow the approval
   * to progress"*.
   *
   * PRESENCE OF THE STRING PRACSOFT PRINTED, AND NOTHING MORE. `read()` is the
   * whole of the test: it does not read the figure, does not check that it IS
   * a figure, and does not care what it says. `"0.00"` and `"1,234.55"` both
   * pass; a JSON number does not, because a number in that cell is a value the
   * form never printed in that shape.
   *
   * ONE ROW IS ENOUGH. A form may legitimately list a row the practice claims
   * no benefit on, and refusing a whole push over one blank cell would be a
   * stricter rule than the one Carl gave.
   *
   * WITH NO ROWS THIS FIRES TOO, alongside `print_record_services_missing`.
   * Both statements are true and each is separately worth knowing; suppressing
   * one to make a tidier list would be the platform choosing which true thing
   * reception may read.
   */
  if (!services.some((service) => !!read(service.benefitAssigned))) {
    failed.push('print_record_benefit_missing');
  }

  /*
   * A SERVICE LINE AOBPRINTER SAW AND COULD NOT READ (D-2026-10-11-05). The
   * check above passes as soon as ONE row has an amount, so a form with a
   * credit, a whole-dollar amount or an amount-less row among good ones lost
   * that row silently. The desktop now counts them; any count above zero means
   * the patient's copy would be missing a service.
   *
   * ONLY A NUMBER IS A COUNT. Absent — a desktop that predates the count — is
   * not refused, because nobody observed a lost row (hard rule 8); any other
   * shape is a record the DTO would not have let through, and is not read.
   */
  if (typeof source.unparsedServiceLines === 'number' && source.unparsedServiceLines > 0) {
    failed.push('print_record_service_lines_unread');
  }

  /*
   * THE PRINTED NAME AGAINST THE PATIENT ON RECORD (Carl, 11 October 2026:
   * *"STOP and tell Reception that PMS is sending a diff name for PMSID xxx.
   * Is this correct?"*; D-2026-10-11-06).
   *
   * Ingest matched this form to a patient on the PMS patient ID alone (hard
   * rule 1), so nothing upstream ever compared the names.
   *
   * ONE RULE, SHARED WITH THE DESK'S WARNING BAND (D-2026-10-10-11). The
   * comparison is `db4PrintedNamePartsDiffering` from contracts, the same
   * function that decides `nameDiffers` on the row, so the band and this
   * refusal can never disagree (Carl, 11 October 2026). Only a part that was
   * PRINTED is compared; when both were, the same whole name split at a
   * different space is the same name; case, spacing, NFC and typographic
   * apostrophes and dashes are ignored, and nothing else is.
   *
   * THE RECORDED NAME IS READ AS THE DESK ROW READS IT: any string, an empty
   * one included. Treating '' as "no record" here while the band compared it
   * would draw a band saying Send is stopped on a row Send could reach. No
   * record passed in at all is a caller that cannot say.
   *
   * A CODE, NEVER EITHER NAME (hard rule 9).
   */
  const recordedGiven = onRecord?.givenNames;
  const recordedFamily = onRecord?.familyName;
  if (
    typeof recordedGiven === 'string' &&
    typeof recordedFamily === 'string' &&
    db4PrintedNamePartsDiffering(
      { givenNames: text(patient.givenNames) ?? null, familyName: text(patient.familyName) ?? null },
      { givenNames: recordedGiven, familyName: recordedFamily },
    ).length > 0
  ) {
    failed.push('print_record_patient_name_differs');
  }

  return failed;
}
