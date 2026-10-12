/**
 * THE PATIENT READS THEIR OWN DB4 ON THE TABLET (D-2026-09-27-01), AND THE
 * PRACTICE WITH NO PMS STILL READS WHAT IT ALWAYS DID (D-2026-09-27-02).
 *
 * WHAT THESE PIN, in the order the two decisions ask for them:
 *
 *   1. A session with no DB4 Print Record renders the walk-up particulars. Not
 *      "renders something equivalent" — the additive path must not RUN, which
 *      is why the first test compares the two ways of saying "no print record"
 *      and the whole of the existing kiosk suite is the rest of the proof. If
 *      an existing test ever has to be edited to keep this green, that is the
 *      finding, not the fix (CLAUDE.md §7a rule 5).
 *   2. With a print record, the form is drawn as the form: heading lines, the
 *      patient block, the servicing location, the providers, the service rows
 *      WITH the amount PracSoft printed, the privacy notice and the in-scope
 *      statement.
 *   3. The amount is reproduced and never originated (hard rule 4 as narrowed
 *      by D-2026-09-14-02), and it is display only — `composeSignRequest` has
 *      no field it could occupy.
 *   4. The Medicare number is drawn masked and nothing draws an unmasked one
 *      (hard rule 1, D-2026-09-27-01 part 3).
 *   5. No signature region of any kind is reproduced, although the practice's
 *      paper carries one (hard rule 3).
 *   6. The document is marked up as a document — a real table with real column
 *      headers, a labelled region, h2 then h3 — because a page image was
 *      refused on exactly those grounds and the replacement has to clear the
 *      bar (WCAG 2.2 AA, CLAUDE.md §6).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { Db4FormView } from '@aobplatform/contracts';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { composeSignRequest } from './rules/signature-payload';
import type { SignatureValidation } from './rules/signature-gate';
import { strings } from './strings';

const noop = () => undefined;
const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };

const VALID: SignatureValidation = {
  state: 'valid',
  artefactHash: 'c'.repeat(64),
  ruleSetVersion: 'test-rules-1',
};

/** The walk-up view — a practice with no PMS, which is the whole of -02. */
const WALK_UP: ParticularsView = {
  agreementType: 'episodic_pre',
  patientName: 'Alex Testpatient',
  providerName: 'Dr Sam Example',
  providerAddress: '1 Test Street, Testville NSW 2000',
  serviceDate: '2026-09-27',
  agreementDate: '2026-09-27',
  basicServiceDescription: 'General practitioner attendance',
  mbsItemNumbers: [] as string[],
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  particularsLocked: true,
  ruleSetVersion: 'test-rules-1',
  mappingVersion: 'test-mapping-1',
  artefactHash: 'c'.repeat(64),
};

/**
 * THE MASKED NUMBER AS THE SERVER SENDS IT. `Db4FormView` has no unmasked
 * Medicare field at all, so this is the only form the tablet can ever hold.
 */
const MASKED_NUMBER = '••• ••••• 1';

/**
 * A DB4 as the lock returns it. Obviously fake identities throughout, and the
 * second statement — the pathology offer, s 65C(4) items 1–4, out of scope —
 * is already absent because the server filters it before the block is built.
 */
const DB4: Db4FormView = {
  headingLines: [
    'MEDICARE - ONLINE CLAIMING',
    'BULK BILL ASSIGNMENT OF BENEFIT FORM',
    'This form is the form prescribed under section 20A of the Health Insurance Act 1973',
    'Bulk bill claim for assessment by Services Australia',
  ],
  formCode: 'DB4',
  formReference: 'TST0000012092026120300',
  serviceDate: '2026-09-27',
  servicingLocationName: 'Testville Family Medical Practice',
  servicingLocationAddressLines: ['78 Test Street', 'Testville NSW 2000'],
  patient: {
    givenNames: 'Alex',
    familyName: 'Testpatient',
    dateOfBirth: '1965-10-10',
    address: '18 Example St, Testville NSW 2000',
    patientRecordNumber: '00680',
    medicareCardNumberMasked: MASKED_NUMBER,
    irn: '1',
  },
  providers: [
    { role: 'servicing', name: 'Dr Sam Example', providerNumber: '0000000T' },
    { role: 'payee', name: 'Dr Pat Sample', providerNumber: '0000001W' },
  ],
  services: [
    {
      serviceDate: '2026-09-27',
      mbsItemNumber: '23',
      description: 'Level B Surgery',
      benefitAssigned: '45.05',
    },
    {
      serviceDate: '2026-09-27',
      mbsItemNumber: '75870',
      description: 'Professional attendance by a general practitioner',
      benefitAssigned: '22.40',
    },
  ],
  privacyNotice: ['Your personal information is protected by law, including the Privacy Act 1988.'],
  statements: [
    {
      key: 'assign_to_health_professional',
      text: 'I assign my right to benefits to the health professional who rendered the services.',
    },
  ],
  parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
};

function renderScreen(view: ParticularsView, blueprintPanels = false) {
  return render(
    <ParticularsScreen
      {...CHROME}
      view={view}
      validation={VALID}
      onContinue={noop}
      blueprintPanels={blueprintPanels}
      onSeeReception={noop}
    />,
  );
}

describe('D-2026-09-27-02 — the practice with no PMS keeps the build it has', () => {
  it('a_session_with_no_print_record_renders_the_walk_up_particulars', () => {
    const view = renderScreen(WALK_UP);

    // The new path is not on the screen at all.
    expect(view.queryByTestId('db4-form')).toBeNull();

    // And the rows that have always been here are all still here, unchanged.
    expect(view.getByText(strings.particulars.patient)).toBeTruthy();
    expect(view.getByText(strings.particulars.provider)).toBeTruthy();
    expect(view.getByText(strings.particulars.placeOfPractice)).toBeTruthy();
    expect(view.getByText(strings.particulars.serviceDate)).toBeTruthy();
    expect(view.getByText(strings.particulars.agreementDate)).toBeTruthy();
    expect(view.getByText(strings.particulars.service)).toBeTruthy();
    expect(view.getByText(WALK_UP.basicServiceDescription as string)).toBeTruthy();

    // Including the tag, which is still true here: no amount is shown.
    expect(view.getByText(strings.particulars.tagNoAmount)).toBeTruthy();
    expect(view.queryByText(strings.particulars.tagAmountIsThePractices)).toBeNull();

    // And the way forward, which no cosmetic change may ever take away.
    expect(view.getByTestId('continue-to-sign')).toBeTruthy();
  });

  it('an_absent_print_record_and_an_explicit_null_render_the_same_markup', () => {
    /*
     * "ADDITIVE" MEANS THE PATH DOES NOT RUN, rather than running and arriving
     * at the same answer. A view that never heard of `db4Form` and one that was
     * handed `null` must produce the same DOM as each other — and the existing
     * kiosk suite, passing untouched, is what says that DOM is still today's.
     */
    const absent = renderScreen(WALK_UP);
    const explicitlyNull = renderScreen({ ...WALK_UP, db4Form: null });
    expect(explicitlyNull.container.innerHTML).toBe(absent.container.innerHTML);
  });
});

describe('D-2026-09-27-01 — the patient reads their own DB4', () => {
  it('the_db4_form_is_drawn_when_the_lock_carries_a_print_record', () => {
    const view = renderScreen({ ...WALK_UP, db4Form: DB4 });
    const form = view.getByTestId('db4-form');

    // The form's own heading lines, as printed, all four of them.
    for (const line of DB4.headingLines as string[]) {
      expect(view.getByText(line)).toBeTruthy();
    }
    // Whose page this is, under them (hard rule 12).
    expect(view.getByTestId('db4-provenance').textContent).toBe(strings.particulars.db4.provenance);

    // The servicing location and the providers, as the form prints them.
    expect(view.getByText('Testville Family Medical Practice')).toBeTruthy();
    expect(view.getByText('78 Test Street')).toBeTruthy();
    expect(view.getByText(strings.particulars.db4.servicingProvider)).toBeTruthy();
    expect(view.getByText(strings.particulars.db4.payeeProvider)).toBeTruthy();
    expect(view.getByText('0000001W')).toBeTruthy();

    // The patient block.
    expect(view.getByText('Alex Testpatient')).toBeTruthy();
    expect(view.getByText('18 Example St, Testville NSW 2000')).toBeTruthy();
    expect(view.getByText('00680')).toBeTruthy();

    // The service rows, with the amounts.
    expect(view.getByText('Level B Surgery')).toBeTruthy();
    expect(view.getByText('75870')).toBeTruthy();

    // The privacy notice and the ONE in-scope statement; the pathology offer
    // was filtered on the server and never reached this component.
    expect(form.textContent).toContain('Privacy Act 1988');
    expect(form.textContent).toContain('I assign my right to benefits to the health professional');
    expect(form.textContent).not.toMatch(/pathology/i);

    /*
     * AND THE ROWS THE FORM REPEATS ARE GONE, so the patient is not shown the
     * same five facts twice. The agreement's own facts stay: the date of THIS
     * agreement, and who is signing.
     */
    expect(view.queryByText(strings.particulars.placeOfPractice)).toBeNull();
    expect(view.queryByText(strings.particulars.service)).toBeNull();
    expect(view.getByText(strings.particulars.agreementDate)).toBeTruthy();
    expect(view.getByText(strings.particulars.assignor)).toBeTruthy();
  });

  it('the_amount_is_reproduced_as_printed_and_never_calculated', () => {
    const view = renderScreen({ ...WALK_UP, db4Form: DB4 });
    const rows = view.getAllByTestId(/^db4-service-/);
    expect(rows).toHaveLength(2);

    // Each amount is the STRING the practice printed — no symbol we chose, no
    // reformatting, no parsing (hard rule 4 as narrowed by D-2026-09-14-02).
    const cells = rows.map((row) => row.querySelectorAll('td')[3]?.textContent);
    expect(cells).toEqual(['45.05', '22.40']);

    // Nothing totals anything. 67.45 is the sum this screen must never know.
    expect(view.getByTestId('db4-form').textContent).not.toContain('67.45');
  });

  it('the_amount_tag_says_what_is_true_of_the_screen', () => {
    /*
     * "No amount shown" beside a column of amounts is the tag catching itself
     * out, and a reviewer who catches one tag out stops trusting the other two.
     */
    const withAmounts = renderScreen({ ...WALK_UP, db4Form: DB4 });
    expect(withAmounts.getByText(strings.particulars.tagAmountIsThePractices)).toBeTruthy();
    expect(withAmounts.queryByText(strings.particulars.tagNoAmount)).toBeNull();
    // Queries reach the whole document, so the first screen leaves before the
    // second arrives or both tags are on it.
    withAmounts.unmount();

    // And a print record whose rows carry none keeps the tag that is still true.
    const withoutAmounts = renderScreen({
      ...WALK_UP,
      db4Form: { ...DB4, services: [{ mbsItemNumber: '23', description: 'Level B Surgery' }] },
    });
    expect(withoutAmounts.getByText(strings.particulars.tagNoAmount)).toBeTruthy();
    expect(withoutAmounts.queryByText(strings.particulars.tagAmountIsThePractices)).toBeNull();
  });

  it('the_amount_never_enters_the_signature_payload', () => {
    /*
     * DISPLAY ONLY, AND STRUCTURALLY SO. The sign body is composed by a pure
     * function from a method, a capture id, the drawing and the statement KEYS.
     * There is no field on it an amount could occupy, and this asserts the key
     * set rather than the absence of one name — a body that grew a field would
     * fail here before anybody had to think of what to call it.
     */
    const body = composeSignRequest('tap_to_approve', 'capture-1', null, ['assign_v1']);
    expect(body).not.toBeNull();
    expect(Object.keys(body as object).sort()).toEqual([
      'affirmations',
      'captureRequestId',
      'method',
    ]);
    expect(JSON.stringify(body)).not.toContain('45.05');
  });

  it('the_medicare_number_is_drawn_masked_and_an_unmasked_one_is_never_drawn', () => {
    /*
     * HARD RULE 1, AND D-2026-09-27-01 PART 3. The tablet is handed a masked
     * number and nothing else; the fixture below carries an extra, unmasked
     * property it has no business drawing — an obviously fake number with an
     * invalid checksum — so that a future edit which reached for it would fail
     * here rather than on a tablet in a waiting room.
     */
    const withAnUnmaskedValue = {
      ...DB4,
      patient: { ...DB4.patient, medicareCardNumber: '1111 11111 1' },
    } as Db4FormView;
    const view = renderScreen({ ...WALK_UP, db4Form: withAnUnmaskedValue });
    const form = view.getByTestId('db4-form');

    expect(form.textContent).toContain(MASKED_NUMBER);
    expect(form.textContent).not.toContain('1111 11111 1');
    // And the patient is told why their card looks different from the screen.
    expect(form.textContent).toContain(strings.particulars.db4.maskedCardNote);
  });

  it('no_practitioner_signature_field_on_the_reproduced_form', () => {
    /*
     * HARD RULE 3. The practice's paper has a signature box on it and this
     * reproduction does not draw one — of either party. The assignor's mark is
     * taken on K-4, where the gate is.
     */
    const view = renderScreen({ ...WALK_UP, db4Form: DB4 });
    const form = view.getByTestId('db4-form');
    expect(form.textContent).not.toMatch(/signature/i);
    expect(form.querySelectorAll('input, canvas, textarea')).toHaveLength(0);
  });

  it('the_form_is_marked_up_as_a_document_and_not_as_a_picture', () => {
    /*
     * THE WCAG HALF OF WHY A RENDERED PDF WAS REFUSED (D-2026-09-27-01 part 4).
     * A labelled region, one h2 for the form's own title with h3 sections under
     * it, and a real table whose columns have headers.
     */
    const view = renderScreen({ ...WALK_UP, db4Form: DB4 });

    expect(view.getByRole('region', { name: strings.particulars.db4.regionLabel })).toBeTruthy();

    // The form's title is the ONE h2 — the other heading lines are sentences.
    const h2s = view.getAllByRole('heading', { level: 2 });
    expect(h2s.map((h) => h.textContent)).toEqual(['BULK BILL ASSIGNMENT OF BENEFIT FORM']);
    expect(view.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);

    const table = view.getByTestId('db4-services');
    expect(table.tagName).toBe('TABLE');
    expect(table.querySelector('caption')?.textContent).toBe(strings.particulars.db4.servicesCaption);
    const headers = [...table.querySelectorAll('thead th')];
    expect(headers.map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col']);
    expect(headers.map((th) => th.textContent)).toEqual([
      strings.particulars.db4.columnDate,
      strings.particulars.db4.columnItem,
      strings.particulars.db4.columnDescription,
      strings.particulars.db4.columnBenefit,
    ]);
  });

  it('the_parser_template_version_is_a_test_device_note', () => {
    /*
     * THE SAME RULING AS THE "READY TO SIGN" PANEL (Carl, 4 Sep 2026): a parser
     * version beside a document a patient is being asked to read is a
     * developer's note on a patient's screen.
     */
    const patientTablet = renderScreen({ ...WALK_UP, db4Form: DB4 });
    expect(patientTablet.queryByTestId('db4-parser-template')).toBeNull();
    patientTablet.unmount();

    const testDevice = renderScreen({ ...WALK_UP, db4Form: DB4 }, true);
    expect(testDevice.getByTestId('db4-parser-template').textContent).toBe(
      strings.particulars.db4.parserTemplate('pracsoft3-db4-2026-09-1'),
    );
  });
});
