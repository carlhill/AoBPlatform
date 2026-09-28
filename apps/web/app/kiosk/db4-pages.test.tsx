/**
 * THE DB4 IS READ AS THREE PAGES, AND THE GATE DOES NOT MOVE (Carl, 27
 * September 2026, from a live tablet: *"I think we need to break this down into
 * maybe four pages from step 2. 2A: Date / time and header info to identify the
 * patient. 2B: Dr seen and items in the table. 2C: legal blurb and tick-boxes
 * for approval. Then continue with sign-off."*).
 *
 * WHAT THESE PIN, in the order the ruling asks for them:
 *
 *   1. A session with no DB4 Print Record is NOT paginated — the path does not
 *      run, which is D-2026-09-27-02 restated for this feature. Neither is a
 *      caller that hands the screen no page state, because the pages have to be
 *      remembered somewhere the screen outlives.
 *   2. The three pages carry what Carl said they carry, and no block appears on
 *      two of them.
 *   3. 2A is the FORM'S header reproduced, not a second identity check — there
 *      is no control on it to confirm anything.
 *   4. The pages are PAGES WITHIN A STEP. The step chip counts the ceremony and
 *      says the same thing on all three (`rules/ceremony-steps.ts`, untouched).
 *   5. HARD RULE 2 (REQ-REG-06). The outstanding count spans all three pages,
 *      the sign-off control stays shut until every box anywhere is ticked, and
 *      a box waiting on another page gets a control that TAKES the patient to
 *      it rather than a sentence telling them to look (CLAUDE.md §7).
 *   6. Every statement key the real `agreement-templates.json` carries lands on
 *      exactly one page. A dropped affirmation is a Continue that will not open
 *      with nothing on screen to explain it, and then a signature the server
 *      refuses.
 *   7. K-4's Back lands on 2C, the page the patient left, rather than at the
 *      top of the form.
 *   8. The print job id and the source hash are in the footer on a TEST device
 *      only, with the masked payload the tablet was actually sent — and the
 *      Print Record itself is still not reachable from here (hard rule 1).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  AGREEMENT_TEMPLATES,
  CONFIRMABLE_DETAIL_TYPES,
  type TabletSessionPayload,
} from '@aobplatform/domain';
import type { Db4FormView } from '@aobplatform/contracts';
import { Ceremony } from './Ceremony';
import { AmountAsPrinted, ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import type { SignatureValidation } from './rules/signature-gate';
import {
  DB4_PAGES,
  FIRST_DB4_PAGE,
  LAST_DB4_PAGE,
  nextDb4Page,
  previousDb4Page,
  statementPage,
  type Db4Page,
} from './rules/db4-pages';
import type { KioskWaitingRow } from './api';
import { strings } from './strings';

const noop = () => undefined;
const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };

const VALID: SignatureValidation = {
  state: 'valid',
  artefactHash: 'd'.repeat(64),
  ruleSetVersion: 'test-rules-1',
};

/**
 * THE REAL STATEMENT KEYS, with stand-in words. The KEYS are what this feature
 * is about — they are what `rules/db4-pages.ts` maps — so they are the shipped
 * ones. The TEXT is not: those words are versioned content and a test that
 * asserted the shipped sentences would be asserting content rather than
 * behaviour (`affirmations.test.tsx` makes the same split).
 */
const STATEMENTS = [
  { key: 'episodic_assign_v1', text: 'I assign my right to the Medicare benefit to Dr Sam Example.' },
  { key: 'episodic_details_correct_v1', text: 'I confirm the details above are correct.' },
];

/** Obviously fake identities throughout, and the number arrives already masked. */
const MASKED_NUMBER = '••• ••••• 1';

const DB4: Db4FormView = {
  headingLines: [
    'MEDICARE - ONLINE CLAIMING',
    'BULK BILL ASSIGNMENT OF BENEFIT FORM',
    'This form is the form prescribed under section 20A of the Health Insurance Act 1973',
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
  providers: [{ role: 'servicing', name: 'Dr Sam Example', providerNumber: '0000000T' }],
  services: [
    {
      serviceDate: '2026-09-27',
      mbsItemNumber: '23',
      description: 'Level B Surgery',
      benefitAssigned: '45.05',
    },
  ],
  privacyNotice: ['Your personal information is protected by law, including the Privacy Act 1988.'],
  statements: [
    {
      key: 'assign_to_health_professional',
      text: 'I assign my right to benefits to the health professional who rendered the services.',
    },
  ],
  sourceSha256: 'e'.repeat(64),
  printJobId: '7c3f9a21-0000-4000-8000-000000000001',
  parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
};

const VIEW: ParticularsView = {
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
  artefactHash: 'd'.repeat(64),
  statements: STATEMENTS,
  templateVersion: 'episodic-generic-1',
  db4Form: DB4,
};

/**
 * A THIN STAND-IN FOR THE CEREMONY, which is where the page and the ticks
 * really live — the page because K-4's Back has to land on the one the patient
 * left, the ticks because Back to K-P1 must not cost anybody a re-tick.
 */
function renderPaged(
  overrides: Partial<ParticularsView> = {},
  options: { blueprintPanels?: boolean; start?: Db4Page } = {},
) {
  let page: Db4Page = options.start ?? FIRST_DB4_PAGE;
  let affirmed: string[] = [];
  const view = render(<div />);
  const draw = () =>
    view.rerender(
      <ParticularsScreen
        {...CHROME}
        view={{ ...VIEW, ...overrides }}
        validation={VALID}
        affirmed={affirmed}
        onToggleAffirmation={(key) => {
          affirmed = affirmed.includes(key) ? affirmed.filter((k) => k !== key) : [...affirmed, key];
          draw();
        }}
        onContinue={noop}
        blueprintPanels={options.blueprintPanels ?? false}
        page={page}
        onPage={(next) => {
          page = next;
          draw();
        }}
        onSeeReception={noop}
      />,
    );
  draw();
  return { ...view, page: () => page };
}

describe('rules/db4-pages — where each part of the form is read', () => {
  it('the_pages_run_in_order_and_the_ends_stop', () => {
    expect(DB4_PAGES).toEqual(['header', 'services', 'legal']);
    expect(FIRST_DB4_PAGE).toBe('header');
    expect(LAST_DB4_PAGE).toBe('legal');
    expect(previousDb4Page('header')).toBeNull();
    expect(nextDb4Page('header')).toBe('services');
    expect(nextDb4Page('services')).toBe('legal');
    expect(nextDb4Page('legal')).toBeNull();
    expect(previousDb4Page('legal')).toBe('services');
  });

  it('an_unknown_statement_key_lands_on_the_legal_page_and_never_nowhere', () => {
    /*
     * A DROPPED AFFIRMATION IS THE FAILURE MODE THAT MATTERS. It would leave
     * the sign-off control shut with nothing on any page explaining why, and
     * then a signature the server refuses for a key the tablet never showed.
     * So an unplaced key goes to the page the sign-off is on, where it is read
     * immediately before signing rather than behind a page already turned.
     */
    expect(statementPage('a_statement_nobody_told_this_file_about_v9')).toBe(LAST_DB4_PAGE);
    expect(statementPage('')).toBe(LAST_DB4_PAGE);
  });

  it('the_details_correct_statement_is_read_after_the_services', () => {
    /*
     * IT REFERS TO THE PATIENT DETAILS AND TO THE SERVICES, so it belongs at
     * the foot of 2B, after both have been read. Its words are the instrument's
     * and are NOT reworded to suit a layout (hard rule 14) — the placement
     * moves, the sentence does not.
     */
    expect(statementPage('episodic_details_correct_v1')).toBe('services');
    expect(statementPage('episodic_assign_v1')).toBe('legal');
    expect(statementPage('enduring_assign_v1')).toBe('legal');
    expect(statementPage('enduring_scope_and_ending_v1')).toBe('legal');
  });

  it('every_real_statement_key_lands_on_exactly_one_page', () => {
    /*
     * OVER THE SHIPPED CONTENT, NOT A FIXTURE. `agreement-templates.json` is
     * the instrument and may grow a statement without this repository's screen
     * code being touched; if one ever fails to reach a page — or reaches two —
     * a patient is stuck at a Continue that will not open. Asserted by
     * RENDERING all three pages and counting the tick boxes, because the
     * mapping being total is not the same claim as the screen drawing it.
     */
    for (const template of AGREEMENT_TEMPLATES.templates) {
      expect(template.statements.length).toBeGreaterThan(0);

      const drawn = new Map<string, number>();
      for (const page of DB4_PAGES) {
        const view = renderPaged({ statements: template.statements }, { start: page });
        for (const statement of template.statements) {
          if (view.queryByTestId(`affirm-${statement.key}`)) {
            drawn.set(statement.key, (drawn.get(statement.key) ?? 0) + 1);
          }
        }
        view.unmount();
      }

      for (const statement of template.statements) {
        expect(drawn.get(statement.key)).toBe(1);
      }
    }
  });
});

describe('D-2026-09-27-02 — nothing to paginate, nothing paginated', () => {
  it('a_session_with_no_print_record_is_never_paginated', () => {
    /*
     * THE ADDITIVE RULE AGAIN, ONE LEVEL UP. A practice with no PMS prints no
     * DB4, so there is nothing to split — and the screen must not run the new
     * path and arrive at the same answer, it must not run it. No page line, no
     * page turns, and every row and every tick box on the one page.
     */
    const view = renderPaged({ db4Form: null });

    expect(view.queryByTestId('db4-page-of')).toBeNull();
    expect(view.queryByTestId('db4-page-continue')).toBeNull();
    expect(view.queryByTestId('db4-page-back')).toBeNull();
    expect(view.queryByTestId('go-to-outstanding-tick')).toBeNull();
    for (const statement of STATEMENTS) {
      expect(view.getByTestId(`affirm-${statement.key}`)).toBeTruthy();
    }
    expect(view.getByTestId('continue-to-sign')).toBeTruthy();
  });

  it('a_screen_given_no_page_state_draws_the_whole_form', () => {
    /*
     * THE PAGES HAVE TO BE REMEMBERED SOMEWHERE THE SCREEN OUTLIVES — K-4's
     * Back lands on 2C — so the ceremony holds them and K-3 paginates only when
     * it is handed them. A caller that passes none gets the whole form on one
     * page, which is safe: every affirmation is then on that page and the gate
     * is exactly what it was.
     */
    const view = render(
      <ParticularsScreen
        {...CHROME}
        view={VIEW}
        validation={VALID}
        affirmed={[]}
        onToggleAffirmation={noop}
        onContinue={noop}
        onSeeReception={noop}
      />,
    );

    expect(view.queryByTestId('db4-page-of')).toBeNull();
    expect(view.getByTestId('db4-services')).toBeTruthy();
    expect(view.getByTestId('db4-privacy-notice')).toBeTruthy();
    for (const statement of STATEMENTS) {
      expect(view.getByTestId(`affirm-${statement.key}`)).toBeTruthy();
    }
  });
});

describe('the three pages Carl asked for', () => {
  it('page_2a_is_the_forms_header_and_the_patient_and_asks_nothing', () => {
    /*
     * "2A: Date / time and header info to identify the patient." IT IS THE
     * FORM'S OWN HEADER REPRODUCED, NOT A SECOND IDENTITY CHECK — the patient
     * may already have proved who they are on K-2 or ticked their details on
     * K-P1, and asking twice is the thing Carl explicitly did not want. So
     * there is no control of any kind on this page and no tick box.
     */
    const view = renderPaged();

    expect(view.getByTestId('db4-page-of').textContent).toBe(strings.particulars.db4.pageOf(1, 3));
    expect(view.getByText('BULK BILL ASSIGNMENT OF BENEFIT FORM')).toBeTruthy();
    expect(view.getByTestId('db4-patient')).toBeTruthy();
    expect(view.getByText(MASKED_NUMBER)).toBeTruthy();
    expect(view.getByText(strings.particulars.agreementDate)).toBeTruthy();
    expect(view.getByText(strings.particulars.assignor)).toBeTruthy();

    /*
     * AND THEY ARE IN THE LEFT COLUMN, UNDER THE DATE OF SERVICE (Carl, 28
     * September 2026: *"move Date of this agreement and Signing below Date of
     * service / Too much wasted white space"*).
     *
     * ASSERTED BY POSITION, BECAUSE PRESENCE IS WHAT THE TWO LINES ABOVE
     * ALREADY ASSERT and they passed just as happily while the pair sat in a
     * band across the foot of the page. A layout Carl asked for twice is worth
     * a test that can tell the two layouts apart.
     *
     * AND HEADED, because inside the practice's own column that heading is the
     * only thing saying these two facts are not on the practice's paper (hard
     * rule 12). Losing it would be the regression that matters, so it is
     * checked here and not only looked at.
     */
    const columns = view.getByTestId('db4-header-columns');
    const left = columns.firstElementChild as HTMLElement;
    const ours = view.getByTestId('db4-agreement-facts');
    expect(left.contains(ours)).toBe(true);
    expect(ours.textContent).toContain(strings.particulars.db4.thisAgreement);
    /*
     * LAST IN THE COLUMN, which is both where Carl put them and what keeps
     * the practice's own run of facts — reference, date of service, the place
     * that printed them — unbroken above.
     */
    const order = Array.from(left.children);
    expect(order.indexOf(ours)).toBe(order.length - 1);
    const serviceDateRow = order.find((el) => el.textContent?.includes(strings.particulars.db4.serviceDate));
    expect(serviceDateRow).toBeTruthy();
    expect(order.indexOf(ours)).toBeGreaterThan(order.indexOf(serviceDateRow as Element));

    // 2B and 2C are not on it.
    expect(view.queryByTestId('db4-services')).toBeNull();
    expect(view.queryByTestId('db4-providers')).toBeNull();
    expect(view.queryByTestId('db4-privacy-notice')).toBeNull();

    // AND NOTHING ON IT ASKS THE PATIENT FOR ANYTHING — no tick box, no field.
    expect(view.queryByTestId('affirmations')).toBeNull();
    expect(view.container.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('page_2b_is_the_provider_and_the_services_with_the_amount_as_printed', () => {
    /*
     * "2B: Dr seen and items in the table." The amounts are untouched: the
     * string PracSoft printed, reproduced and never parsed (hard rule 4 as
     * narrowed by D-2026-09-14-02).
     */
    const view = renderPaged({}, { start: 'services' });

    expect(view.getByTestId('db4-page-of').textContent).toBe(strings.particulars.db4.pageOf(2, 3));
    expect(view.getByTestId('db4-providers')).toBeTruthy();
    const cells = view.getByTestId('db4-service-0').querySelectorAll('td');
    expect(cells[3]?.textContent).toBe('45.05');

    // The details-correct tick is read here, after the details and the rows.
    expect(view.getByTestId('affirm-episodic_details_correct_v1')).toBeTruthy();
    expect(view.queryByTestId('affirm-episodic_assign_v1')).toBeNull();

    // Neither neighbour's blocks are on it.
    expect(view.queryByTestId('db4-patient')).toBeNull();
    expect(view.queryByTestId('db4-privacy-notice')).toBeNull();
  });

  it('page_2c_is_the_legal_blurb_the_ticks_and_the_way_to_sign_off', () => {
    /*
     * "2C: legal blurb and tick-boxes for approval. Then continue with
     * sign-off." The tags close the document here too, because this is where
     * the document ends.
     */
    const view = renderPaged({}, { start: 'legal' });

    expect(view.getByTestId('db4-page-of').textContent).toBe(strings.particulars.db4.pageOf(3, 3));
    expect(view.getByTestId('db4-privacy-notice')).toBeTruthy();
    expect(view.getByTestId('db4-assignment')).toBeTruthy();
    expect(view.getByTestId('affirm-episodic_assign_v1')).toBeTruthy();
    expect(view.getByTestId('continue-to-sign')).toBeTruthy();
    expect(view.queryByTestId('db4-page-continue')).toBeNull();
    expect(view.getByText(strings.particulars.tagAmountIsThePractices)).toBeTruthy();
  });

  it('the_pages_turn_forwards_and_back_without_leaving_the_step', () => {
    /*
     * 2A → 2B → 2C and back again. Back on 2A is the CEREMONY's Back, which is
     * not drawn here at all because these particulars are locked and K-5 was
     * skipped — there is nothing behind the step.
     */
    const view = renderPaged();
    expect(view.queryByTestId('db4-page-back')).toBeNull();
    expect(view.queryByTestId('particulars-back')).toBeNull();

    fireEvent.click(view.getByTestId('db4-page-continue'));
    expect(view.page()).toBe('services');
    // 2B CARRIES A TICK, AND SINCE 27 SEPTEMBER 2026 ITS CONTINUE WAITS FOR IT
    // (Carl: "Continue button should be enabled after the box is ticked").
    fireEvent.click(view.getByTestId('affirm-episodic_details_correct_v1'));
    fireEvent.click(view.getByTestId('db4-page-continue'));
    expect(view.page()).toBe('legal');

    fireEvent.click(view.getByTestId('db4-page-back'));
    expect(view.page()).toBe('services');
    fireEvent.click(view.getByTestId('db4-page-back'));
    expect(view.page()).toBe('header');
  });

  it('the_agreements_own_facts_are_separated_by_a_rule_and_the_class_is_applied', () => {
    /*
     * CARL, 28 SEPTEMBER 2026: *"a little lower and put draw a line
     * separator"* — the hairline the old full-width band carried, kept now
     * that the band is gone and the facts sit at the foot of 2A's left
     * column.
     *
     * TWO ASSERTIONS, BECAUSE EITHER HALF CAN FAIL ON ITS OWN, and the
     * expensive way to learn that was `pushDesk.tsx` on this same day: a rule
     * written in one stylesheet and referenced through the wrong import is
     * `undefined`, React renders no class, and every content test stays
     * green while the element is unstyled. So the rule must EXIST and the
     * element must NAME it.
     *
     * jsdom applies no cascade, so this cannot prove the line is painted —
     * only that nothing has quietly removed it. A Playwright assertion on
     * the computed border is the honest version and is owed, alongside the
     * one the benefit column already owes.
     */
    const css = readFileSync(join(__dirname, 'kiosk.module.css'), 'utf8');
    expect(css).toMatch(/\.db4Agreement\s*\{[^}]*border-top:\s*1px solid var\(--line\)/);
    expect(css).toMatch(/\.db4Agreement\s*\{[^}]*margin-top:/);

    const ours = renderPaged().getByTestId('db4-agreement-facts');
    /* Composed with the ordinary section style, never instead of it. */
    expect(ours.className).toContain('db4Agreement');
    expect(ours.className).toContain('db4Section');
  });

  it('the_benefit_column_is_right_aligned_and_the_selector_actually_wins', () => {
    /*
     * CARL, 27 SEPTEMBER 2026: *"right justify the $ in the table"* -- asked
     * TWICE, because the first fix read correctly in the file and did nothing
     * on the screen. `.db4Table th, .db4Table td { text-align: left }` is
     * specificity (0,1,1) and a bare `.db4ColBenefit` is (0,1,0), so the
     * cascade threw the rule away silently.
     *
     * WHY THIS TEST READS CSS RATHER THAN RENDERING. jsdom applies no
     * stylesheet and computes no cascade, so no amount of rendering can catch
     * a rule that loses -- `getComputedStyle` would report the same thing
     * either way. Asserting the SELECTOR is the only guard available below a
     * real browser, and the failure it guards against is one that already
     * happened once. A Playwright assertion on the computed value is the
     * honest version and is owed.
     */
    const css = readFileSync(join(__dirname, 'kiosk.module.css'), 'utf8');
    for (const rule of ['.db4Table .db4ColBenefit', '.db4Table .db4Benefit']) {
      expect(css).toContain(rule);
    }
    // AND THE UNQUALIFIED FORMS ARE GONE, so the losing rule cannot come back
    // alongside the winning one and read as though it were doing the work.
    expect(css).not.toMatch(/^\.db4ColBenefit\s*\{/m);
    expect(css).not.toMatch(/^\.db4Benefit\s*\{/m);
  });

  it('the_amount_is_split_for_alignment_and_not_one_character_changes', () => {
    /*
     * CARL, 28 SEPTEMBER 2026: *"we will need to put decimals or at least
     * position the numbers to line up - you think"*. The answer was POSITION,
     * never decimals — padding `45` to `45.00` would be AoB writing a figure
     * the practice never printed, which is hard rule 4 as narrowed by
     * D-2026-09-14-02.
     *
     * THIS IS THE TEST THAT MATTERS, and unlike the alignment guard above it
     * needs no browser: the split is CONTENT, so jsdom can prove the round
     * trip exactly. Whatever PracSoft printed comes back out character for
     * character — symbol, grouping comma, however many decimals, or none.
     */
    for (const printed of ['45', '$45.05', '1234.5', '1,234.55', '0.00', '', '45.005']) {
      const { container, unmount } = render(<AmountAsPrinted value={printed} />);
      expect(container.textContent).toBe(printed);
      unmount();
    }

    // AND THE POINT IS WHERE THE ALIGNMENT HANGS OFF: the last dot, because in
    // en-AU the comma groups thousands and the dot separates the fraction.
    const { container } = render(<AmountAsPrinted value="1,234.55" />);
    const [whole, fraction] = Array.from(container.querySelectorAll('span > span'));
    expect(whole.textContent).toBe('1,234');
    expect(fraction.textContent).toBe('.55');

    /*
     * THE EMPTY FRACTION SLOT IS STILL DRAWN. It is what reserves the width
     * that puts the points in a line; dropping it on a whole amount would pull
     * that row right by its neighbours' fractions, which is the ragged column
     * this exists to fix. The CSS gives it a `min-width` for the same reason.
     */
    const whole45 = render(<AmountAsPrinted value="45" />);
    expect(whole45.container.querySelectorAll('span > span')).toHaveLength(2);
    const css = readFileSync(join(__dirname, 'kiosk.module.css'), 'utf8');
    expect(css).toContain('.db4Table .db4AmountFraction');
    expect(css).toMatch(/\.db4Table \.db4AmountFraction \{[^}]*min-width/);
  });

  it('a_pages_continue_waits_for_that_pages_own_tick', () => {
    /*
     * CARL, 27 SEPTEMBER 2026, FROM A LIVE TABLET: *"on page 1 or 3 Continue
     * button should be enabled after the box is ticked. Same rule on the next
     * page"*. He was looking at 2B: a live Continue sitting under an unticked
     * box reading "I confirm the details above are correct", which invites
     * somebody to page straight past an affirmation.
     *
     * A SECOND GATE, EARLIER — NEVER A REPLACEMENT FOR THE SIGNATURE GATE.
     * `readyToSign` still spans every page and is what hard rule 2
     * (REQ-REG-06) rests on; this only stops a patient reaching the last page
     * with work behind them.
     *
     * AND THE BLOCKED CONTROL IS GENUINELY UNPRESSABLE, not merely styled so:
     * `GuardedButton`'s blocked branch renders a real `button[disabled]` with
     * no handler, so the assertion below is that the page did not turn rather
     * than that something looked grey.
     */
    const view = renderPaged();

    // 2A carries no statement, so its Continue is open by construction.
    fireEvent.click(view.getByTestId('db4-page-continue'));
    expect(view.page()).toBe('services');

    const blocked = view.getByTestId('db4-page-continue');
    expect(blocked.hasAttribute('disabled')).toBe(true);
    expect(blocked.textContent).toContain(strings.particulars.db4.continueNotTicked(1));
    fireEvent.click(blocked);
    expect(view.page()).toBe('services');

    fireEvent.click(view.getByTestId('affirm-episodic_details_correct_v1'));
    const open = view.getByTestId('db4-page-continue');
    expect(open.hasAttribute('disabled')).toBe(false);
    expect(open.textContent).toContain(strings.particulars.db4.continueToNextPage);
    fireEvent.click(open);
    expect(view.page()).toBe('legal');

    // AND UNTICKING SHUTS IT AGAIN. The gate reads the affirmations rather
    // than remembering that somebody once passed it.
    fireEvent.click(view.getByTestId('db4-page-back'));
    expect(view.page()).toBe('services');
    fireEvent.click(view.getByTestId('affirm-episodic_details_correct_v1'));
    expect(view.getByTestId('db4-page-continue').hasAttribute('disabled')).toBe(true);
  });

  it('a_page_with_no_statements_is_not_gated_at_all', () => {
    /*
     * 2A HAS NO AFFIRMATION, and its Continue must not acquire one. The rule
     * is "this page's own ticks", so a page with none is open — by the filter
     * returning nothing rather than by a special case naming the page.
     */
    const view = renderPaged();
    const first = view.getByTestId('db4-page-continue');
    expect(first.hasAttribute('disabled')).toBe(false);
    expect(view.queryByTestId('affirmations')).toBeNull();
  });

  it('a_page_turn_moves_focus_to_the_new_pages_heading', () => {
    /*
     * WCAG 2.2 AA ON A PATIENT SURFACE (CLAUDE.md §6). A page turn that swaps
     * the content under a stationary cursor is a page turn a screen-reader user
     * is never told about. Focus is NOT stolen on arrival — the ceremony's own
     * heading and by-line are the first things a patient reads.
     */
    const view = renderPaged();
    expect(document.activeElement).not.toBe(view.queryByTestId('db4-page-heading'));

    fireEvent.click(view.getByTestId('db4-page-continue'));
    const heading = view.getByTestId('db4-page-heading');
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe(strings.particulars.db4.pageHeading.services);
    expect(document.activeElement).toBe(heading);
  });
});

describe('hard rule 2 (REQ-REG-06) — the gate spans every page', () => {
  it('continue_to_sign_stays_shut_while_a_box_on_another_page_is_unticked', () => {
    /*
     * THE COUNT IS EVERY PAGE'S, NOT THIS PAGE'S. A gate that only saw the
     * boxes in front of it would open on 2C with 2B's affirmation untouched,
     * and the tablet would send a signature the server refuses — with the
     * patient told nothing about why.
     */
    const view = renderPaged({}, { start: 'legal' });

    // Both outstanding: the label counts two, and one of them is on 2B.
    expect(view.getByTestId('continue-to-sign').textContent).toBe(
      strings.particulars.continueNotAffirmed(2),
    );

    fireEvent.click(view.getByTestId('affirm-episodic_assign_v1'));
    const blocked = view.getByTestId('continue-to-sign');
    expect(blocked.textContent).toBe(strings.particulars.continueNotAffirmed(1));
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
  });

  it('the_blocked_control_takes_the_patient_to_the_outstanding_box', () => {
    /*
     * CLAUDE.md §7 — shortcuts to the answer, not directions to a screen. The
     * blocked primary stays a real `button[disabled]` with no handler, because
     * that is hard rule 2 on this screen; the way to the box is the control
     * beside it, and it TAKES the patient there.
     */
    const view = renderPaged({}, { start: 'legal' });
    fireEvent.click(view.getByTestId('affirm-episodic_assign_v1'));

    fireEvent.click(view.getByTestId('go-to-outstanding-tick'));
    expect(view.page()).toBe('services');
    expect(view.getByTestId('affirm-episodic_details_correct_v1')).toBeTruthy();
  });

  it('every_page_ticked_opens_the_sign_off_control_and_nothing_else_does', () => {
    const view = renderPaged({}, { start: 'services' });
    fireEvent.click(view.getByTestId('affirm-episodic_details_correct_v1'));

    fireEvent.click(view.getByTestId('db4-page-continue'));
    expect(view.getByTestId('continue-to-sign')).toBeTruthy();
    // Still shut: 2C's own box is outstanding, and it is on this page.
    expect(view.queryByTestId('go-to-outstanding-tick')).toBeNull();

    fireEvent.click(view.getByTestId('affirm-episodic_assign_v1'));
    const open = view.getByTestId('continue-to-sign');
    expect((open as HTMLButtonElement).disabled).toBe(false);
    expect(open.textContent).toBe(strings.particulars.continueToSign);
  });
});

describe('the test device sees the provenance; a patient sees none of it', () => {
  it('the_print_job_id_and_the_source_hash_are_test_device_only', () => {
    /*
     * Carl: *"the print job id, that hash, and the Print Record itself ... show
     * this in the footer with the other audit ids"*. Two of the three: the
     * record itself carries the UNMASKED card number and stays on a
     * workstation (hard rule 1, `packages/contracts/src/db4-form-view.ts`).
     */
    const patientTablet = renderPaged();
    expect(patientTablet.queryByTestId('kiosk-print-job-identity')).toBeNull();
    expect(patientTablet.queryByTestId('kiosk-print-source-identity')).toBeNull();
    expect(patientTablet.queryByTestId('db4-payload')).toBeNull();
    patientTablet.unmount();

    const testDevice = renderPaged({}, { blueprintPanels: true });
    expect(testDevice.getByTestId('kiosk-print-job-identity').textContent).toBe(
      strings.chrome.printJobIdentity('7c3f9a21'),
    );
    expect(testDevice.getByTestId('kiosk-print-source-identity').textContent).toBe(
      strings.chrome.printSourceIdentity('eeeeeeee'),
    );
  });

  it('the_payload_panel_shows_the_masked_block_and_never_an_unmasked_number', () => {
    /*
     * THE AGREED SUBSTITUTE FOR LINKING THE PRINT RECORD: the block as the
     * tablet actually received it, so somebody checking a rendering can see
     * whether the screen drew what it was given. Nothing here can print an
     * unmasked number because `Db4FormView` has no field one could arrive in —
     * the fixture below carries an extra, obviously fake one with an invalid
     * checksum so that a future edit reaching for it fails here.
     */
    const withAnUnmaskedValue = {
      ...DB4,
      patient: { ...DB4.patient, medicareCardNumber: '1111 11111 1' },
    } as Db4FormView;
    const view = renderPaged({ db4Form: withAnUnmaskedValue }, { blueprintPanels: true });

    const panel = view.getByTestId('db4-payload');
    expect(panel.textContent).toContain(MASKED_NUMBER);
    expect(panel.textContent).toContain('7c3f9a21-0000-4000-8000-000000000001');
    // And it is a panel, not a door: nothing on this screen links to the record.
    expect(view.container.querySelectorAll('a')).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------
 * The same three pages, driven through the real `Ceremony` — because the page
 * state is the ceremony's and the two claims that matter cannot be made
 * anywhere else: that the STEP chip does not move, and that K-4's Back lands
 * on the page the patient left. `./api` is mocked wholesale, on the reasoning
 * `ceremony-steps.test.tsx` gives.
 * ---------------------------------------------------------------------- */

const RILEY: KioskWaitingRow = {
  captureRequestId: 'cr-riley',
  agreementId: 'ag-riley',
  patientId: 'pt-riley',
  patientName: 'Riley Example',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-27',
  appointmentTime: '09:00',
  agreementStatus: 'awaiting_signature',
  agreementType: 'episodic_pre',
  waitingSince: '2026-09-27T08:00:00.000Z',
  signable: true,
  blockedReason: null,
};

const LOCKED = {
  id: RILEY.agreementId,
  type: 'episodic_pre',
  status: 'awaiting_signature',
  patientId: RILEY.patientId,
  assignorId: 'as-1',
  assignorIsPatient: true,
  particulars: { patientName: RILEY.patientName, serviceDate: '2026-09-27' },
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'd'.repeat(64),
  particularsLockedAt: '2026-09-27T08:30:00.000Z',
  templateVersion: 'episodic-generic-1',
  renderPayload: { template: { statements: STATEMENTS } },
  db4Form: DB4,
};

const SESSION: TabletSessionPayload = {
  id: '22222222-2222-4222-8222-222222222222',
  state: 'pushed',
  agreementType: 'episodic_pre',
  patient: {
    givenNames: 'Riley',
    familyName: 'Example',
    dateOfBirth: '1988-03-09',
    address: '7 Sample Road, Sampletown NSW 2000',
    mobile: '0400 000 000',
    email: 'riley@example.invalid',
  },
  assignor: { isPatient: true },
  patientId: 'e609b40e-63aa-56e1-8f5b-2e9bc5aa5133',
  detailsCheck: 'required',
  agreementId: RILEY.agreementId,
  captureRequestId: 'cr-riley-pushed',
};

const {
  confirmSessionDetails,
  fetchAgreement,
  fetchKioskMe,
  fetchTabletSession,
  fetchWaitingList,
  setTabletSessionState,
} = vi.hoisted(() => ({
  confirmSessionDetails: vi.fn(),
  fetchAgreement: vi.fn(),
  fetchKioskMe: vi.fn(),
  fetchTabletSession: vi.fn(),
  fetchWaitingList: vi.fn(),
  setTabletSessionState: vi.fn(),
}));

vi.mock('./pairing', () => ({
  PAIRING_CREDENTIAL_KEY: 'aob.kiosk.pairing',
  PERSISTABLE_KEYS: ['aob.kiosk.pairing'],
  readPairingCredential: () => 'fake-device-credential',
  writePairingCredential: () => true,
  clearPairingCredential: vi.fn(),
}));

vi.mock('./api', () => ({
  sendKioskHeartbeat: vi.fn(async () => ({
    command: null,
    pollMs: 0,
    outOfUse: false,
    reload: false,
  })),
  KioskApiError: class KioskApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  isUnpaired: () => false,
  fetchKioskMe,
  fetchWaitingList,
  fetchPracticeStaffNames: vi.fn(async () => []),
  fetchCopyOffer: vi.fn(async () => ({ channels: [], declineKey: 'not_now', version: 'test-copy-1' })),
  requestCopy: vi.fn(async () => ({ channel: 'email', queued: true })),
  fetchTabletSession,
  confirmSessionDetails,
  setTabletSessionState,
  claimWaitingRow: vi.fn(),
  fetchAgreement,
  startChallenge: vi.fn(),
  attemptChallenge: vi.fn(),
  transitionAgreement: vi.fn(),
  changeAssignor: vi.fn(),
  lockParticulars: vi.fn(),
  signAgreement: vi.fn(),
  completeCapture: vi.fn(),
}));

beforeEach(() => {
  for (const mock of [
    confirmSessionDetails,
    fetchAgreement,
    fetchKioskMe,
    fetchTabletSession,
    fetchWaitingList,
    setTabletSessionState,
  ]) {
    mock.mockReset();
  }
  confirmSessionDetails.mockResolvedValue({ id: SESSION.id, state: 'details_confirmed' });
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-1',
    deviceLabel: 'Reception tablet 1',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: ['name', 'date_of_birth', 'address'],
    showsWaitingList: false,
    reload: false,
  });
  fetchWaitingList.mockResolvedValue({
    kind: 'changed' as const,
    etag: '"rev-1"',
    body: {
      practiceId: 'practice-1',
      revision: 'rev-1',
      pollMs: 60_000,
      identifierTypes: ['name', 'date_of_birth', 'address'],
      waiting: [],
      hidden: true,
      reload: false,
    },
  });
  fetchTabletSession.mockResolvedValue({ session: SESSION });
  setTabletSessionState.mockResolvedValue({ id: SESSION.id, state: 'reading' });
  fetchAgreement.mockResolvedValue(LOCKED);
});

/**
 * K-P1, ticked and passed — the pushed route's own first screen, exactly as
 * `ceremony-steps.test.tsx` drives it. It is not the subject here; K-3 is.
 */
async function reachTheParticulars(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
  }
  fireEvent.click(screen.getByTestId('check-details-continue'));
  await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
}

/** Turn every page of the form, ticking whatever box each one carries. */
async function readAndTickEveryPage(): Promise<void> {
  fireEvent.click(screen.getByTestId('db4-page-continue'));
  fireEvent.click(screen.getByTestId('affirm-episodic_details_correct_v1'));
  fireEvent.click(screen.getByTestId('db4-page-continue'));
  fireEvent.click(screen.getByTestId('affirm-episodic_assign_v1'));
  await waitFor(() =>
    expect((screen.getByTestId('continue-to-sign') as HTMLButtonElement).disabled).toBe(false),
  );
}

describe('the pages are pages within a step, not steps', () => {
  it('the_pages_are_not_steps_and_the_chip_does_not_move', async () => {
    /*
     * CARL'S OWN NAMING IS THE RULING: 2A, 2B and 2C are pages of step 2, so
     * `rules/ceremony-steps.ts` is untouched and the chip says the same thing
     * on all three. The DOCUMENT's own count is a separate line by the
     * heading, and the two are never confused.
     */
    render(<Ceremony />);
    await reachTheParticulars();

    const chip = strings.chrome.stepOf(2, 3);
    expect(screen.getByText(chip)).toBeTruthy();
    expect(screen.getByTestId('db4-page-of').textContent).toBe(strings.particulars.db4.pageOf(1, 3));

    fireEvent.click(screen.getByTestId('db4-page-continue'));
    expect(screen.getByText(chip)).toBeTruthy();
    expect(screen.getByTestId('db4-page-of').textContent).toBe(strings.particulars.db4.pageOf(2, 3));

    // THE PAGE'S OWN TICK FIRST (Carl, 27 September 2026). The CHIP is what
    // this test is about and it must not move for any of this.
    fireEvent.click(screen.getByTestId('affirm-episodic_details_correct_v1'));
    expect(screen.getByText(chip)).toBeTruthy();
    fireEvent.click(screen.getByTestId('db4-page-continue'));
    expect(screen.getByText(chip)).toBeTruthy();
    expect(screen.getByTestId('db4-page-of').textContent).toBe(strings.particulars.db4.pageOf(3, 3));
    // And no number the ceremony does not have has appeared anywhere.
    expect(screen.queryByText(strings.chrome.stepOf(4, 5))).toBeNull();
  });

  it('back_from_the_signature_lands_on_the_page_the_patient_left', async () => {
    /*
     * THE REASON THE PAGE IS THE CEREMONY'S STATE AND NOT K-3'S. K-4's Back
     * returns to K-3, and a patient who stepped to the pen from 2C and changed
     * their mind must come back to 2C — not to the top of a form they have
     * just read. `SignatureScreen`'s Back is unchanged: one `setStep`, no
     * fetch, and nothing on the agreement moves.
     */
    render(<Ceremony />);
    await reachTheParticulars();
    await readAndTickEveryPage();

    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('sign-control-tap')).toBeTruthy());

    fireEvent.click(screen.getByTestId('signature-back'));
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());

    expect(screen.getByTestId('db4-page-of').textContent).toBe(strings.particulars.db4.pageOf(3, 3));
    expect(screen.getByTestId('continue-to-sign')).toBeTruthy();
    // And the ticks came back with it, so nobody re-reads the form to sign.
    expect((screen.getByTestId('continue-to-sign') as HTMLButtonElement).disabled).toBe(false);
  });
});
