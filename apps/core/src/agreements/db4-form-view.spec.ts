import type { Db4FormView, PrintJobEnvelope } from '@aobplatform/contracts';
// The alias is one disable instead of one per line, and it leaves the guard
// against the single most likely design mistake in this product live for the
// rest of the file.
// eslint-disable-next-line no-restricted-syntax
import { buildDb4FormView, maskMedicareCardNumber as mask } from './db4-form-view';

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
      expect(view.patient?.medicareCardNumberMasked).toBe('••• ••••• 9');
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
      // Two numbers of different lengths mask to strings of the same length.
      expect(mask('2999 99999 9')).toBe('••• ••••• 9');
      expect(mask('29999999999999')).toBe('••• ••••• 9');
      expect(mask('2999999999')).toBe('••• ••••• 9');
      // Separators are not carried through either — the shape is ours, fixed.
      expect(mask('2999-99999-4')).toBe('••• ••••• 4');
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
      expect(mask('9')).toBe('••• •••••');
      expect(mask('123')).toBe('••• •••••');
      // Lettered or otherwise unreadable: masked whole, because a malformed
      // value is still somebody's data (the rule `maskEmail` already follows).
      expect(mask('UNKNOWN')).toBe('••• •••••');
      expect(mask('not a card number')).toBe('••• •••••');
      // Absurd input is still bounded: the answer is the mask, never the input.
      const absurd = mask('9'.repeat(10_000));
      expect(absurd).toBe('••• ••••• 9');
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
});
