import type { Db4FormView, Db4PrintRecordCheck, PrintJobEnvelope } from '@aobplatform/contracts';
import {
  DB4_PRINT_RECORD_CHECKS,
  DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST,
  DB4_PLACEMENT_REASONS,
} from '@aobplatform/contracts';
// The alias is one disable instead of one per line, and it leaves the guard
// against the single most likely design mistake in this product live for the
// rest of the file.
// eslint-disable-next-line no-restricted-syntax
import { buildDb4FormView, checkDb4PrintRecord, maskMedicareCardNumber as mask } from './db4-form-view';

/**
 * THE DB4 THE PATIENT READS ON THE TABLET (D-2026-09-27-01).
 *
 * The three things this file exists to hold:
 *
 *  - The card number is MASKED here, on the server, and the unmasked value has
 *    no field to travel in. The assertion that it never reaches the wire is in
 *    `db4-assignment.e2e-spec.ts` against a real response body, because that is
 *    the only assertion that proves it; these are the shapes of the mask.
 *  - The amount is the STRING PracSoft printed — never parsed, never
 *    reformatted, never totalled (hard rule 4 as narrowed, D-2026-09-14-02).
 *  - The pathology offer is filtered exactly as `SignedDb4Renderer` filters it,
 *    so the screen and the chart-folder form agree.
 *
 * FAKE IDENTITIES, AND THE MEDICARE NUMBER BELOW FAILS ITS OWN CHECKSUM ON
 * PURPOSE — 2 999 99999 9 weights to 353, so the printed check digit is wrong
 * (CLAUDE.md §7).
 */

const FAKE_MEDICARE = '2999 99999 9';

function envelope(over: Record<string, unknown> = {}): PrintJobEnvelope {
  return {
    documentType: 'db4_assignment',
    sourceSha256: '0'.repeat(64),
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-09-12T02:03:41.000Z',
    heading: {
      lines: [
        'MEDICARE - ONLINE CLAIMING',
        'BULK BILL ASSIGNMENT OF BENEFIT FORM',
        'This form is the approved form as prescribed under section 20A of the Health Insurance Act 1973',
      ],
    },
    form: { formCode: 'DB4', formReference: 'TEST0001', serviceDate: '2026-09-12', locationId: 'TST00100' },
    servicingLocation: {
      name: 'Sampletown Family Medical Practice',
      addressLines: ['1 Example Street'],
      suburb: 'Sampletown',
      state: 'NSW',
      postcode: '2000',
    },
    patient: {
      pmsLinkageKey: 'chart:00001',
      patientRecordNumber: '00001',
      // eslint-disable-next-line no-restricted-syntax -- the fixture's own field, invalid by construction.
      medicareCardNumber: FAKE_MEDICARE,
      irn: '1',
      givenNames: 'Testy',
      familyName: 'Fakename',
      dateOfBirth: '1965-10-10',
      address: '18 Example Street, Sampletown NSW 2000',
      mobile: '+61400000001',
    },
    providers: [
      { role: 'servicing', pmsProviderKey: 'provider:1111111T', name: 'Dr Fake Servicing', providerNumber: '1111111T' },
      { role: 'payee', pmsProviderKey: 'provider:2222222W', name: 'Dr Fake Payee', providerNumber: '2222222W' },
    ],
    services: [
      { serviceDate: '2026-09-12', time: '12:03', mbsItemNumber: '23', description: 'Level B', benefitAssigned: '45.05' },
      { serviceDate: '2026-09-12', time: '12:03', mbsItemNumber: '75870', description: 'Attendance', benefitAssigned: '22.40' },
    ],
    assignment: {
      privacyNotice: ['Privacy Notice: Your personal information is protected by law.'],
      statementsJoinedBy: 'or',
      statements: [
        {
          key: 'assign_to_health_professional',
          text: 'I assign my right to benefits to the health professional who rendered the services.',
          ticked: true,
          inScope: true,
        },
        {
          key: 'offer_to_assign_to_pathology_practitioner',
          text: 'I offer to assign my right to benefits to the Approved Pathology Practitioner.',
          ticked: true,
          inScope: false,
        },
      ],
    },
    ...over,
    // `capturedAt` is a branded `IsoTimestamp` in the contract; the fixture is
    // a plain object, so the cast goes through `unknown` like every other
    // envelope fixture in this repo.
  } as unknown as PrintJobEnvelope;
}

/**
 * The view, for a record that has one. `buildDb4FormView` returns `undefined`
 * when the parser read too little to be worth drawing (see
 * `a_form_view_with_nothing_on_it_is_never_built`), so a test about the
 * CONTENT of a view says out loud that it expected one rather than reaching
 * past the type with a `!`.
 */
function built(source: PrintJobEnvelope): Db4FormView {
  const view = buildDb4FormView(source);
  if (!view) throw new Error('expected this envelope to build a form view');
  return view;
}

describe('the DB4 form view', () => {
  describe('the mask', () => {
    it('the_medicare_card_number_is_masked_before_it_can_reach_a_tablet', () => {
      const view = built(envelope());
      // eslint-disable-next-line no-restricted-syntax -- the MASKED field, which is the only one there is.
      expect(view.patient?.medicareCardNumberMasked).toBe('•••• ••999 9');
      /*
       * THE FIELD DOES NOT EXIST ON THE TYPE AND MUST NOT EXIST ON THE VALUE.
       * A masked string beside the full one would be a mask in name only.
       */
      expect(JSON.stringify(view)).not.toContain(FAKE_MEDICARE);
      expect(JSON.stringify(view)).not.toContain(FAKE_MEDICARE.replace(/ /g, ''));
      expect(Object.keys(view.patient ?? {})).not.toContain('medicareCardNumber');
      // The IRN is one digit and identifies nobody on its own; it is printed.
      expect(view.patient?.irn).toBe('1');
    });

    it('the_mask_is_a_fixed_width_so_it_cannot_say_how_long_the_number_is', () => {
      /*
       * FOUR DIGITS, NOT ONE, SINCE 27 SEPTEMBER 2026. These assertions read
       * `'••• ••••• 9'` until Carl looked at it on a tablet: *"show the last 4
       * digits of the medicare number. Showing just a single digit does not
       * help."* One digit cannot be checked against anything. The grouping is
       * now the card's own 4-5-1 so the revealed digits land where the eye
       * expects them.
       */
      // Two numbers of different lengths mask to strings of the same length.
      expect(mask('2999 99999 9')).toBe('•••• ••999 9');
      expect(mask('29999999999999')).toBe('•••• ••999 9');
      expect(mask('2999999999')).toBe('•••• ••999 9');
      // Separators are not carried through either — the shape is ours, fixed.
      expect(mask('2999-99999-4')).toBe('•••• ••999 4');
    });

    it('a_value_too_short_to_be_a_card_number_reveals_none_of_itself', () => {
      /*
       * THE THRESHOLD MOVED WITH THE REVEAL. Showing the last four of a real
       * ten-digit number gives away four of ten; showing the last four of a
       * seven-digit misparse gives away four of seven. So nothing under eight
       * digits reveals anything at all — the fraction is the thing being
       * controlled, not the count.
       */
      expect(mask('1234567')).toBe('•••• ••••• •');
      expect(mask('12345678')).toBe('•••• ••567 8');
    });

    it('the_mask_never_throws_and_never_passes_a_value_through', () => {
      // Absent: there is nothing to show, and an empty mask would suggest
      // there was something. The field is simply not on the block.
      expect(mask(undefined)).toBeUndefined();
      expect(mask(null)).toBeUndefined();
      expect(mask('')).toBeUndefined();
      expect(mask('   ')).toBeUndefined();
      // Not a string at all — a number, an object, an array off malformed JSON.
      expect(mask(2999999999)).toBeUndefined();
      expect(mask({})).toBeUndefined();
      expect(mask(['2999 99999 9'])).toBeUndefined();
      // Too short to reveal anything: a third of a value is not a mask.
      expect(mask('9')).toBe('•••• ••••• •');
      expect(mask('123')).toBe('•••• ••••• •');
      // Lettered or otherwise unreadable: masked whole, because a malformed
      // value is still somebody's data (the rule `maskEmail` already follows).
      expect(mask('UNKNOWN')).toBe('•••• ••••• •');
      expect(mask('not a card number')).toBe('•••• ••••• •');
      // Absurd input is still bounded: the answer is the mask, never the input.
      const absurd = mask('9'.repeat(10_000));
      expect(absurd).toBe('•••• ••999 9');
    });
  });

  describe('the amount', () => {
    it('the_printed_amount_is_carried_as_the_string_pracsoft_printed', () => {
      const view = built(envelope());
      expect(view.services?.map((service) => service.benefitAssigned)).toEqual(['45.05', '22.40']);
      // STRINGS, not numbers: a parse and a re-format is AoB originating a
      // figure even when the figure agrees (hard rule 4, D-2026-09-14-02).
      for (const service of view.services ?? []) expect(typeof service.benefitAssigned).toBe('string');
      // AND NO TOTAL. Not a field, not a key, not anywhere on the block — a
      // sum is a figure we computed.
      const keys = Object.keys(view).concat(Object.keys(view.services?.[0] ?? {}));
      expect(keys).not.toContain('total');
      expect(JSON.stringify(view)).not.toContain('67.45');
    });

    it('an_amount_the_parser_could_not_read_is_absent_rather_than_invented', () => {
      const view = built(envelope({ services: [{ mbsItemNumber: '23', description: 'Level B' }] }));
      expect(view.services?.[0].benefitAssigned).toBeUndefined();
      expect(view.services?.[0].mbsItemNumber).toBe('23');
    });
  });

  describe('the form, as the form has it', () => {
    it('the_pathology_offer_is_filtered_exactly_as_the_signed_db4_filters_it', () => {
      const view = built(envelope());
      expect(view.statements?.map((statement) => statement.key)).toEqual(['assign_to_health_professional']);
      expect(JSON.stringify(view)).not.toContain('Pathology');
    });

    it('a_statement_whose_template_predates_inScope_is_shown', () => {
      // Absent means in scope — the renderer's rule, and the same here, so a
      // form read by an older parser template still shows its assignment.
      const view = built(
        envelope({ assignment: { statements: [{ key: 'assign_to_health_professional', text: 'I assign.' }] } }),
      );
      expect(view.statements).toHaveLength(1);
    });

    it('the_view_is_the_envelope_the_signed_db4_is_drawn_from', () => {
      const view = built(envelope());
      expect(view.headingLines?.[1]).toBe('BULK BILL ASSIGNMENT OF BENEFIT FORM');
      expect(view.formCode).toBe('DB4');
      expect(view.formReference).toBe('TEST0001');
      expect(view.serviceDate).toBe('2026-09-12');
      expect(view.servicingLocationName).toBe('Sampletown Family Medical Practice');
      // The address lines as printed, then suburb/state/postcode — assembled
      // exactly as `SignedDb4Renderer.drawServicingLocation` assembles them.
      expect(view.servicingLocationAddressLines).toEqual(['1 Example Street', 'Sampletown NSW 2000']);
      // Both providers, because both are on the form.
      expect(view.providers?.map((provider) => provider.role)).toEqual(['servicing', 'payee']);
      expect(view.patient?.patientRecordNumber).toBe('00001');
      expect(view.parserTemplateVersion).toBe('pracsoft3-db4-2026-09-1');
    });
  });

  describe('hard rule 8 — a form view that could not be built blocks nothing', () => {
    it('a_malformed_print_record_builds_a_partial_view_and_never_throws', () => {
      const shapes: unknown[] = [
        {},
        { patient: null, services: null, assignment: null, heading: null },
        { patient: 'not an object', services: 'not an array', providers: 42 },
        { services: [null, 'not a row', { benefitAssigned: 4505 }], assignment: { statements: 'no' } },
        { heading: { lines: [1, 2, 3] }, servicingLocation: { addressLines: {} } },
      ];
      for (const shape of shapes) {
        expect(() => buildDb4FormView(shape as PrintJobEnvelope)).not.toThrow();
      }
      // A number where a string was printed is ABSENT, never coerced: a
      // coercion here would be us formatting an amount. Carried on a record
      // that HAS a name and a row, so the view is built and the cell can be
      // inspected — the emptiness rule below is a separate question.
      const coerced = buildDb4FormView({
        patient: { givenNames: 'Testalina', familyName: 'Fakesurname' },
        services: [{ benefitAssigned: 4505 }],
      } as unknown as PrintJobEnvelope);
      expect(coerced?.services?.[0].benefitAssigned).toBeUndefined();
    });

    it('an_envelope_that_is_not_an_object_at_all_builds_no_view', () => {
      for (const nothing of [undefined, null]) {
        expect(buildDb4FormView(nothing as unknown as PrintJobEnvelope)).toBeUndefined();
      }
    });
  });

  describe('a_form_view_with_nothing_on_it_is_never_built', () => {
    /*
     * Regression, 27 September 2026, found in review, and the only defect in
     * this feature that would have reached a patient.
     *
     * K-3 draws the DB4 block INSTEAD OF the six rows it repeats, and the
     * client's discriminator is truthiness. A print record whose fields the
     * parser could not read produced a block that existed and said nothing,
     * which suppressed all six rows and left the assignor affirming and
     * signing in front of an empty frame — while the locked particulars behind
     * them were complete. The fallback is not a worse screen; it is the
     * ORIGINAL screen, drawn from particulars hard rule 2 guarantees are
     * whole.
     */
    it('builds nothing when the parser read no patient name', () => {
      const view = buildDb4FormView(
        envelope({ patient: { patientRecordNumber: '00001' }, services: [{ mbsItemNumber: '23' }] }),
      );
      expect(view).toBeUndefined();
    });

    it('builds nothing when the parser read no service row', () => {
      const view = buildDb4FormView(envelope({ patient: { givenNames: 'Testalina' }, services: [] }));
      expect(view).toBeUndefined();
    });

    it('builds the view when a name and one row survived, however little else did', () => {
      // Deliberately threadbare: no heading, no location, no statements, no
      // provider. That is a degraded form, not an empty one, and the patient
      // is better off reading it than reading nothing.
      const view = buildDb4FormView({
        patient: { familyName: 'Fakesurname' },
        services: [{ mbsItemNumber: '23', benefitAssigned: '45.05' }],
      } as unknown as PrintJobEnvelope);
      expect(view?.services?.[0].benefitAssigned).toBe('45.05');
      expect(view?.headingLines).toBeUndefined();
    });
  });

  /* -------------------------------------------------------------------------
   * THE PUSH-TIME CHECK ON THE PRINT RECORD (Carl, 27 September 2026, from a
   * live tablet: *"If no $ do not allow the approval to progress. Check all
   * details when the reception pushes to the tablet."*).
   *
   * A CONFIDENCE CHECK ON OUR OWN REPRODUCTION, NOT A STATUTORY VALIDATION —
   * an agreement with no amount is statutorily complete (hard rule 4), and
   * what a missing benefit most likely means is that AOBPRINTER's template did
   * not read the form properly.
   *
   * THE REFUSAL LANDS AT THE DESK, NEVER ON THE TABLET (hard rule 8), which is
   * `push`'s job; these are the facts it decides on.
   * ---------------------------------------------------------------------- */
  describe('the print record check', () => {
    /** The checks a record fails, as a plain array the assertions can read. */
    const checks = (over: Record<string, unknown> = {}): readonly Db4PrintRecordCheck[] =>
      checkDb4PrintRecord(envelope(over));

    it('a_complete_print_record_fails_no_check', () => {
      // The fixture is a whole form: two named providers, two rows, both with
      // the amount PracSoft printed. Nothing here should ever refuse it.
      expect(checks()).toEqual([]);
    });

    /* ---------------------------------------------------------------------
     * THE ONE GENUINELY NEW CHECK. Nothing upstream looks at an amount:
     * ingest does not, the rules engine does not and must not (hard rule 4),
     * and the particulars have no field for one — so a record whose amount
     * column the template lost reaches a tablet today.
     * ------------------------------------------------------------------ */
    it('a_print_record_with_no_amount_on_any_row_is_refused', () => {
      const none = checks({
        services: [
          { serviceDate: '2026-09-12', mbsItemNumber: '23', description: 'Level B' },
          { serviceDate: '2026-09-12', mbsItemNumber: '75870', description: 'Attendance' },
        ],
      });
      expect(none).toEqual(['print_record_benefit_missing']);
    });

    it('one_row_with_an_amount_is_enough_for_the_whole_record', () => {
      // A form may legitimately list a row the practice claims no benefit on.
      // Refusing a push over one blank cell would be stricter than the ruling.
      const partial = checks({
        services: [
          { serviceDate: '2026-09-12', mbsItemNumber: '23' },
          { serviceDate: '2026-09-12', mbsItemNumber: '75870', benefitAssigned: '22.40' },
        ],
      });
      expect(partial).toEqual([]);
    });

    it('benefit_is_checked_for_presence_and_never_converted_to_a_number', () => {
      /*
       * HARD RULE 4, AS NARROWED BY D-2026-09-14-02. The check asks whether
       * the string PracSoft printed survived the parse. It does not read the
       * figure, does not check that it IS a figure, and does not care what it
       * says.
       *
       * `"0.00"` IS AN AMOUNT THE PRACTICE PRINTED. Treating a zero as "no
       * amount" would be AoB forming an opinion about a figure — exactly what
       * hard rule 4 forbids — and it would refuse a push over a row the
       * practice deliberately billed at nothing.
       */
      expect(checks({ services: [{ serviceDate: '2026-09-12', benefitAssigned: '0.00' }] })).toEqual([]);
      // A grouped amount, a currency symbol, a dash: all present, none parsed.
      expect(checks({ services: [{ serviceDate: '2026-09-12', benefitAssigned: '1,234.55' }] })).toEqual([]);
      expect(checks({ services: [{ serviceDate: '2026-09-12', benefitAssigned: '$7.05' }] })).toEqual([]);
      expect(checks({ services: [{ serviceDate: '2026-09-12', benefitAssigned: 'BULK BILLED' }] })).toEqual([]);
      /*
       * AND A NUMBER IS ABSENT, not coerced — the same rule the projection
       * follows. A JSON number in that cell is a record the parser wrote
       * wrongly, and reading it would be us accepting a figure in a shape the
       * form never printed.
       */
      expect(checks({ services: [{ serviceDate: '2026-09-12', benefitAssigned: 4505 }] })).toEqual([
        'print_record_benefit_missing',
      ]);
      // Empty and blank are absent too: a cell with nothing in it is a cell
      // the template did not read.
      expect(checks({ services: [{ serviceDate: '2026-09-12', benefitAssigned: '' }] })).toEqual([
        'print_record_benefit_missing',
      ]);
      expect(checks({ services: [{ serviceDate: '2026-09-12', benefitAssigned: '   ' }] })).toEqual([
        'print_record_benefit_missing',
      ]);
    });

    /* ---------------------------------------------------------------------
     * LIVE THROUGH ITS NAME HALF. Ingest requires the servicing provider's
     * provider NUMBER (`no_servicing_provider`) and never looks at the name,
     * so a half-read provider line still places an agreement — and the
     * patient would be shown a form that does not say who they are assigning
     * to.
     * ------------------------------------------------------------------ */
    /* ---------------------------------------------------------------------
     * THE SECOND GENUINELY NEW CHECK, AND THE SECOND LIVE ONE (Carl, 27
     * September 2026, from a live tablet: *"if a medicare# is provided then
     * the IRN must also be provided. Check this on button 'Send to tablet' at
     * reception"*).
     *
     * WHAT HE WAS LOOKING AT WAS A SCREEN CONTRADICTING ITSELF. The tablet
     * drew a masked Medicare number and, beneath it, the note telling the
     * patient to check *"the IRN beside your name"* — with no IRN row on the
     * page, because `ParticularsScreen` draws that row only when there is a
     * value. The patient was being asked to check a field that was not there.
     *
     * NOT AN IDENTITY CHECK (hard rule 1, REQ-VER-02). Presence of a parsed
     * field, never a value, and the card is not treated as identifying
     * anybody.
     * ------------------------------------------------------------------ */
    it('a_print_record_with_a_card_number_and_no_irn_is_refused', () => {
      const halfRead = checks({
        patient: {
          patientRecordNumber: '00001',
          givenNames: 'Testy',
          familyName: 'Fakename',
          // eslint-disable-next-line no-restricted-syntax -- the fixture's own field, invalid by construction.
          medicareCardNumber: FAKE_MEDICARE,
        },
      });
      expect(halfRead).toEqual(['print_record_irn_missing']);
    });

    it('a_print_record_with_no_card_number_at_all_is_not_asked_for_an_irn', () => {
      /*
       * CONDITIONAL, EXACTLY AS CARL PUT IT: *"IF a medicare# is provided"*.
       * A record carrying neither is the `no-card-number` case he tested
       * minutes earlier and reported working — the tablet draws neither field
       * and no note refers to either, so nothing on that screen contradicts
       * anything. Refusing it would block a push over a form that reads
       * correctly, which is the opposite of what this check is for.
       */
      const neither = checks({
        patient: { patientRecordNumber: '00001', givenNames: 'Testy', familyName: 'Fakename' },
      });
      expect(neither).toEqual([]);
      // AND AN EMPTY STRING IS NOT A CARD NUMBER. `read()` treats blank as
      // absent, so a template that emitted the field without finding a value
      // is the same case as one that did not emit it.
      // eslint-disable-next-line no-restricted-syntax -- the fixture's own field, and blank by design.
      expect(checks({ patient: { patientRecordNumber: '00001', medicareCardNumber: '   ' } })).toEqual([]);
    });

    it('a_print_record_whose_servicing_provider_has_no_name_is_refused', () => {
      const unnamed = checks({
        providers: [
          { role: 'servicing', providerNumber: '1111111T' },
          { role: 'payee', name: 'Dr Fake Payee', providerNumber: '2222222W' },
        ],
      });
      expect(unnamed).toEqual(['print_record_servicing_provider_missing']);
    });

    it('a_print_record_whose_servicing_provider_has_no_provider_number_is_refused', () => {
      const unnumbered = checks({
        providers: [{ role: 'servicing', name: 'Dr Fake Servicing' }],
      });
      expect(unnumbered).toEqual(['print_record_servicing_provider_missing']);
    });

    it('a_print_record_with_no_servicing_provider_row_at_all_is_refused', () => {
      // The payee is on the form too, and it is not a substitute: the
      // assignment is with the SERVICING provider (s 65C(5)(a)).
      const payeeOnly = checks({
        providers: [{ role: 'payee', name: 'Dr Fake Payee', providerNumber: '2222222W' }],
      });
      expect(payeeOnly).toEqual(['print_record_servicing_provider_missing']);
    });

    /* ---------------------------------------------------------------------
     * THE THREE BACKSTOPS. Each is refused at ingest before an agreement can
     * exist, so none can fire on a real row today — which is stated here so a
     * reader does not mistake them for the guard that is holding.
     * ------------------------------------------------------------------ */
    it('a_print_record_that_identifies_no_patient_is_refused', () => {
      const anonymous = checks({ patient: { dateOfBirth: '1965-10-10' } });
      expect(anonymous).toEqual(['print_record_patient_unidentified']);
      // EITHER ONE IS ENOUGH. A chart number with no name is a real and
      // reachable state, and it is deliberately NOT refused: the projection
      // already declines to build a view, so the tablet falls back to the
      // original screen drawn from the locked particulars.
      expect(checks({ patient: { patientRecordNumber: '00001' } })).toEqual([]);
      expect(checks({ patient: { familyName: 'Fakesurname' } })).toEqual([]);
    });

    it('a_print_record_with_no_service_rows_is_refused', () => {
      /*
       * BOTH CODES, AND THE OVERLAP IS ON PURPOSE. With no rows there is no
       * row carrying an amount either, so both statements are true and each
       * is separately worth knowing. Suppressing one to make a tidier list
       * would be the platform deciding which true thing reception may read.
       */
      expect(checks({ services: [] })).toEqual([
        'print_record_services_missing',
        'print_record_benefit_missing',
      ]);
    });

    it('a_print_record_with_no_service_date_is_refused', () => {
      /*
       * READ AS `db4-assignment.handler.ts` READS IT — the form first, its
       * rows second. A DB4 prints the same date in both places, and
       * disagreeing with the handler about where to look would produce two
       * different answers about one page.
       */
      const undated = checks({
        form: { formCode: 'DB4', formReference: 'TEST0001' },
        services: [{ mbsItemNumber: '23', benefitAssigned: '45.05' }],
      });
      expect(undated).toEqual(['print_record_service_date_missing']);
      // A date on the rows but not on the form is still a dated record.
      const rowDated = checks({
        form: { formCode: 'DB4', formReference: 'TEST0001' },
        services: [{ serviceDate: '2026-09-12', mbsItemNumber: '23', benefitAssigned: '45.05' }],
      });
      expect(rowDated).toEqual([]);
    });

    it('every_failed_check_comes_back_at_once_not_one_at_a_time', () => {
      /*
       * CLAUDE.md §7 — *"every blocked, wrong or waiting message names its
       * specific reason"*. Reception fixes the form ONCE. Returning the first
       * failure would have somebody press Send five times to be told five
       * things, with a patient waiting through every one of them.
       */
      const ruined = checkDb4PrintRecord({
        form: {},
        patient: {},
        providers: [],
        services: [],
      } as unknown as PrintJobEnvelope);
      /*
       * EVERY CHECK BUT THE CONDITIONAL ONE (Carl, 27 September 2026). This
       * used to assert the whole list, and it cannot any more: an empty
       * record has no Medicare card number, and `print_record_irn_missing`
       * only asks for an IRN when a card number was read. So the most ruined
       * record possible fails five of the six, and the sixth is absent
       * because its precondition is absent rather than because it passed.
       *
       * IT IS SPELLED OUT RATHER THAN FILTERED OUT. Deriving the expectation
       * from the code under test would make this test agree with whatever the
       * validator does; naming the five means a check that stops firing shows
       * up here.
       */
      expect(ruined).toEqual([
        'print_record_patient_unidentified',
        'print_record_services_missing',
        'print_record_servicing_provider_missing',
        'print_record_service_date_missing',
        'print_record_benefit_missing',
      ]);
      // AND WITH A CARD NUMBER READ, ALL SIX — the conditional one joins the
      // list in its declared position rather than being appended to the end.
      const alsoHalfRead = checkDb4PrintRecord({
        form: {},
        // eslint-disable-next-line no-restricted-syntax -- the fixture's own field, invalid by construction.
        patient: { medicareCardNumber: FAKE_MEDICARE },
        providers: [],
        services: [],
      } as unknown as PrintJobEnvelope);
      expect(alsoHalfRead).toEqual([...DB4_PRINT_RECORD_CHECKS]);
      // AND IN THE DECLARED ORDER, always. A list that reshuffles itself
      // between two presses of Send is a list nobody trusts.
      for (const list of [ruined, alsoHalfRead]) {
        expect(list).toEqual(
          list.slice().sort((a, b) => DB4_PRINT_RECORD_CHECKS.indexOf(a) - DB4_PRINT_RECORD_CHECKS.indexOf(b)),
        );
      }
    });

    it('the_print_record_check_never_throws', () => {
      /*
       * HARD RULE 8 (REQ-REC-04). The envelope is JSON off a queue row, typed
       * by a cast: every field may be absent and any field may be the wrong
       * shape. A check that could throw would turn a malformed record into a
       * 500 at the desk — which is a platform fault stopping a push, where
       * the whole design is that a refusal is something staff can act on.
       */
      const shapes: unknown[] = [
        undefined,
        null,
        {},
        'not an envelope',
        42,
        { patient: null, services: null, providers: null, form: null },
        { patient: 'not an object', services: 'not an array', providers: 42, form: 7 },
        { services: [null, 'not a row', { benefitAssigned: {} }], providers: [null, 'nope'] },
        { form: { serviceDate: 12 }, providers: [{ role: 'servicing', name: 7, providerNumber: [] }] },
      ];
      for (const shape of shapes) {
        expect(() => checkDb4PrintRecord(shape as PrintJobEnvelope)).not.toThrow();
        // And the answer is always an array of declared codes — never a
        // partial, never a thrown value dressed up as a result.
        for (const code of checkDb4PrintRecord(shape as PrintJobEnvelope)) {
          expect(DB4_PRINT_RECORD_CHECKS).toContain(code);
        }
      }
    });

    it('a_refusal_names_a_field_and_never_a_value', () => {
      /*
       * HARD RULE 9 (REQ-VER-04). The codes are the whole answer, and not one
       * of them can carry a name, a chart number, a card number, an address,
       * an item number or an amount. That is what makes them safe in an HTTP
       * body, a log line and a vault event.
       */
      const ruined = checkDb4PrintRecord(
        envelope({
          providers: [{ role: 'servicing', providerNumber: '1111111T' }],
          services: [{ serviceDate: '2026-09-12', mbsItemNumber: '23', description: 'Level B' }],
        }),
      );
      const wire = JSON.stringify(ruined);
      expect(wire).not.toContain('Testy');
      expect(wire).not.toContain('Fakename');
      expect(wire).not.toContain('00001');
      expect(wire).not.toContain(FAKE_MEDICARE);
      expect(wire).not.toContain(FAKE_MEDICARE.replace(/ /g, ''));
      expect(wire).not.toContain('Example Street');
      expect(wire).not.toContain('1111111T');
      expect(wire).not.toContain('45.05');
      // Every element is a declared code and nothing else — no object, no
      // message, no field carrying what it read.
      for (const code of ruined) expect(typeof code).toBe('string');
    });

    it('every_backstop_check_names_the_ingest_reason_that_covers_it', () => {
      /*
       * THE BACKSTOP DECLARATION, PINNED. Three of these six cannot fire on
       * any agreement that exists, because `db4-assignment.handler.ts` is the
       * only writer of `sourcePrintJobId` and refuses the same envelope at
       * ingest first. That is a fact about today's code, not a structural
       * invariant, so it is written down in contracts and asserted here — a
       * relaxed ingest gate becomes a test to update rather than a hole to
       * rediscover.
       *
       * AND THE AMOUNT IS THE GAP. `print_record_benefit_missing` maps to
       * null because nothing upstream looks at an amount, and nothing should
       * compute one (hard rule 4).
       */
      for (const check of DB4_PRINT_RECORD_CHECKS) {
        const covered = DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST[check];
        if (covered !== null) expect(DB4_PLACEMENT_REASONS).toContain(covered);
      }
      expect(DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST.print_record_benefit_missing).toBeNull();
      // AND SO IS THE IRN. `irn` is `@IsOptional()` at ingest and nothing
      // downstream requires it, so this check is the only thing standing
      // there (Carl, 27 September 2026).
      expect(DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST.print_record_irn_missing).toBeNull();
      // The map is exhaustive: a check added without a decision about whether
      // ingest already covers it is a check nobody classified.
      expect(Object.keys(DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST).sort()).toEqual(
        [...DB4_PRINT_RECORD_CHECKS].sort(),
      );
    });
  });
});
