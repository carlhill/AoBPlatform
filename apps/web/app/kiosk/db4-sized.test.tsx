/**
 * THE SIZED PATH, WHICH jsdom NEVER TAKES ON ITS OWN (review of d0e4f94).
 *
 * jsdom has no layout, so K-3 always falls back to the three fixed pages there
 * and every other unit test sees the old screen. These force the sized path
 * through the screen's measurer seam (`sheetMeasurer`), with the real filler
 * deciding the breaks from stand-in heights, and pin what it promises:
 *
 *   1. Each sheet's Continue waits for that sheet's ticks, and only those
 *      (D-2026-09-27-07): a services sheet that is not the section's last
 *      carries none and is not gated; the last one carries the tick and is.
 *   2. "Page X of Y" counts sheets, and the sheet's heading is described by
 *      it, so focusing the heading announces where the patient is (WCAG
 *      2.4.3 / 1.3.1).
 *   3. A re-measure that hides the focused control moves focus to the
 *      sheet's heading rather than dropping it on the body (WCAG 2.4.3).
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Db4FormView } from '@aobplatform/contracts';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import type { SignatureValidation } from './rules/signature-gate';
import { FIRST_DB4_PAGE, fillDb4Sheets, fitsByHeight, type Db4Block, type Db4Page } from './rules/db4-pages';
import { strings } from './strings';
import styles from './kiosk.module.css';

const noop = () => undefined;
const VALID: SignatureValidation = { state: 'valid', artefactHash: 'd'.repeat(64), ruleSetVersion: 'test-rules-1' };

const STATEMENTS = [
  { key: 'episodic_assign_v1', text: 'I assign my right to the Medicare benefit to Dr Sam Example.' },
  { key: 'episodic_details_correct_v1', text: 'I confirm the details above are correct.' },
];

/** Obviously fake; no Medicare field at all, which the type allows. */
const DB4: Db4FormView = {
  headingLines: ['MEDICARE - ONLINE CLAIMING', 'BULK BILL ASSIGNMENT OF BENEFIT FORM'],
  formCode: 'DB4',
  formReference: 'TST0000012092026120300',
  serviceDate: '2026-10-10',
  servicingLocationName: 'Testville Family Medical Practice',
  servicingLocationAddressLines: ['78 Test Street'],
  patient: { givenNames: 'Alex', familyName: 'Testpatient', dateOfBirth: '1965-10-10', irn: '1' },
  providers: [{ role: 'servicing', name: 'Dr Sam Example', providerNumber: '0000000T' }],
  services: [0, 1, 2, 3].map((index) => ({
    serviceDate: '2026-10-10',
    mbsItemNumber: String(23 + index),
    description: `Stand-in service ${index + 1}`,
    benefitAssigned: '45.05',
  })),
  privacyNotice: ['Stand-in privacy notice.'],
  statements: [{ key: 'assign_to_health_professional', text: 'Stand-in assignment statement.' }],
  sourceSha256: 'e'.repeat(64),
  printJobId: '00000000-0000-4000-8000-0000000000c1',
  parserTemplateVersion: 'test-template-1',
};

const VIEW: ParticularsView = {
  agreementType: 'episodic_pre',
  patientName: 'Alex Testpatient',
  providerName: 'Dr Sam Example',
  providerAddress: '1 Test Street, Testville NSW 2000',
  serviceDate: '2026-10-10',
  agreementDate: '2026-10-10',
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

/** Every block 100px; a frame of 200 and 400 available: two blocks a sheet. */
const twoPerSheet = (blocks: readonly Db4Block[]) =>
  fillDb4Sheets(
    blocks,
    fitsByHeight({
      available: 400,
      frame: 200,
      heights: Object.fromEntries(blocks.map((block) => [block.id, 100])),
      ticks: { services: 100, legal: 100 },
    }),
  );

/** A thin stand-in for the ceremony: it holds the page and the ticks. */
function renderSized(measure = twoPerSheet) {
  let page: Db4Page = FIRST_DB4_PAGE;
  let affirmed: string[] = [];
  let measurer = measure;
  const view = render(<main />);
  const draw = () =>
    view.rerender(
      <ParticularsScreen
        practiceName="Sample Practice"
        locationLine="NSW"
        view={VIEW}
        validation={VALID}
        affirmed={affirmed}
        onToggleAffirmation={(key) => {
          affirmed = affirmed.includes(key) ? affirmed.filter((k) => k !== key) : [...affirmed, key];
          draw();
        }}
        onContinue={noop}
        page={page}
        onPage={(next) => {
          page = next;
          draw();
        }}
        onSeeReception={noop}
        sheetMeasurer={measurer}
      />,
    );
  draw();
  return {
    ...view,
    remeasure(next: typeof measure) {
      measurer = next;
      draw();
    },
  };
}

const pageOf = () => screen.getByTestId('db4-page-of').textContent;
const forward = () =>
  (screen.queryByTestId('db4-page-continue') ?? screen.getByTestId('continue-to-sign')) as HTMLButtonElement;
const hidden = (element: Element) => element.closest(`.${styles.db4Hidden}`) !== null;

describe('the sized path', () => {
  it('each_sheets_continue_waits_for_that_sheets_ticks_and_only_those', () => {
    renderSized();
    // 2A: two heading lines, four practice rows, three patient rows — five
    // sheets of two — then services (provider + 4 rows = 5 blocks), legal.
    const total = Number(/of (\d+)/.exec(pageOf() ?? '')?.[1]);
    expect(total).toBeGreaterThan(3);

    const seen: Array<{ page: string | null; ticks: number; gated: boolean }> = [];
    for (let turn = 0; turn < total; turn += 1) {
      const ticks = screen.queryAllByRole('checkbox').filter((box) => !hidden(box)) as HTMLInputElement[];
      seen.push({ page: pageOf(), ticks: ticks.length, gated: forward().disabled });
      for (const box of ticks) fireEvent.click(box);
      expect(forward().disabled).toBe(false);
      if (screen.queryByTestId('db4-page-continue')) fireEvent.click(forward());
    }
    // Only the services section's last sheet and the legal last sheet carry a
    // tick, and only they were gated before it was given.
    const ticked = seen.filter((sheet) => sheet.ticks > 0);
    expect(ticked).toHaveLength(2);
    for (const sheet of seen) expect(sheet.gated).toBe(sheet.ticks > 0);
    expect(seen[seen.length - 1].page).toBe(strings.particulars.db4.pageOf(total, total));
  });

  it('the_sheets_heading_is_described_by_its_page_line', () => {
    renderSized();
    const heading = screen.getByTestId('db4-page-heading');
    const described = heading.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? '')?.textContent).toBe(pageOf());
  });

  it('a_re_measure_that_hides_the_focused_control_moves_focus_to_the_heading', () => {
    const view = renderSized();
    // Turn to the services section's last sheet and focus its tick.
    while (screen.queryAllByRole('checkbox').filter((box) => !hidden(box)).length === 0) {
      fireEvent.click(forward());
    }
    const tick = screen.queryAllByRole('checkbox').find((box) => !hidden(box)) as HTMLInputElement;
    tick.focus();
    expect(document.activeElement).toBe(tick);
    // A re-measure that puts every block on its own sheet: the patient stays
    // on the block they were reading, which no longer carries the tick.
    act(() =>
      view.remeasure((blocks) =>
        fillDb4Sheets(
          blocks,
          fitsByHeight({
            available: 300,
            frame: 200,
            heights: Object.fromEntries(blocks.map((block) => [block.id, 100])),
            ticks: { services: 100, legal: 100 },
          }),
        ),
      ),
    );
    expect(hidden(tick)).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId('db4-page-heading'));
  });
});
