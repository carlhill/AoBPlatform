import type {
  Db4FormView,
  Db4FormViewProvider,
  Db4FormViewService,
  Db4FormViewStatement,
  PrintJobEnvelope,
} from '@aobplatform/contracts';

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
const MASK_GROUPS = `${DOT.repeat(3)} ${DOT.repeat(5)}`;

/**
 * BELOW THIS MANY DIGITS NOTHING IS REVEALED. A Medicare card number has ten;
 * a value with three or fewer is not one, and showing the last of three would
 * be showing a third of whatever it actually is.
 */
const MIN_DIGITS_TO_SHOW_ONE = 4;

/**
 * `2454 23237 1` → `••• ••••• 1`.
 *
 * ENOUGH TO RECOGNISE, NOT ENOUGH TO HARVEST — D-2026-09-27-01 part 3, which
 * amends D-2026-09-14-03 for the screen and only for the screen. A sheet of
 * paper is handed to one person; a tablet is held up in a waiting room with
 * other patients three seats away, and a Medicare card number is a high-value
 * fraud identifier. The form in the chart folder still prints it in full.
 *
 * WHY THE LAST DIGIT IS THE ONE SHOWN. It is the card's issue number — the
 * digit that changes when a card is reissued and the only one on the card that
 * identifies nobody by itself. The nine that make the number usable never
 * leave this process. Beside it the tablet shows the IRN as printed, which is
 * one digit and identifies nobody either, and between them the patient can see
 * that the form on the screen is about their card and their position on it.
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
  if (digits.length < MIN_DIGITS_TO_SHOW_ONE) return MASK_GROUPS;
  return `${MASK_GROUPS} ${digits.slice(-1)}`;
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
    parserTemplateVersion: text(source.parserTemplateVersion),
  };
}
