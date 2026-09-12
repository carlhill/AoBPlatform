/**
 * THE PRACTICE'S DAY REGISTER, RENDERED (Carl, 12 September 2026).
 *
 * IT EXISTS BECAUSE THIS PAGE CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open a practice screen in a headless
 * check.
 *
 * WHAT IT PINS:
 *
 *  - THE FIRST READ SENDS NO DATE, and the control is seeded from the SERVER's
 *    answer. A browser that filled the field in from its own clock would head
 *    the register with the wrong day for the whole of a Sydney morning.
 *  - CHOOSING A DAY RE-READS THAT DAY, and nothing else changes.
 *  - THE ROWS CARRY A NAME, A TIME, A PROVIDER, TWO WORDS ABOUT THE AGREEMENT
 *    AND ONE ABOUT THE VISIT. No Medicare number (hard rule 1), no date of
 *    birth, no address, no amount (hard rule 4).
 *  - AN UNMAPPED STATUS SHOWS ITS OWN CODE rather than a blank or a generic
 *    line (CLAUDE.md §7) — a blank in that column would read as "there is no
 *    agreement".
 *  - NOTHING ON THE PAGE ACTS. No request leaves it but the GETs it reads with.
 *  - AND THE FRONT DESK LINKS HERE (the button Carl asked for), asserted by
 *    rendering that page rather than by trusting this one.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DayRegister, DayRegisterRow } from '@aobplatform/contracts';
import { DayView, agreementStatusLabel, signedLabel } from './DayView';
import { FrontDeskView } from '../frontdesk/FrontDeskView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

/**
 * A ROW AS THE SERVER HANDS IT BACK — obviously fake identities, and no
 * Medicare-format number anywhere because there is no field for one at either
 * end (hard rule 1). `patientRecordNumber` is the practice's own handle and IS
 * an approved identifier (REQ-VER-02).
 */
const row = (over: Partial<DayRegisterRow> = {}): DayRegisterRow => ({
  arrivalId: 'arrival-1',
  patientId: '11111111-1111-4000-8000-000000000001',
  patientName: 'Jamie Sampleton',
  patientRecordNumber: 'DEV-JAMIE-SAMPLETON',
  arrivedAt: '2026-09-11T23:05:00.000Z',
  seenByName: 'Dr Example Provider',
  agreementProviderName: null,
  agreementId: 'agreement-1',
  agreementStatus: 'stored',
  agreementSigned: true,
  visitState: 'completed',
  ...over,
});

const NURSED = row({
  arrivalId: 'arrival-2',
  patientId: '22222222-2222-4000-8000-000000000002',
  patientName: 'Alex Nursevisit',
  patientRecordNumber: 'DEV-ALEX-NURSEVISIT',
  arrivedAt: '2026-09-12T00:30:00.000Z',
  seenByName: 'Nurse Example Patel',
  agreementProviderName: 'Dr Example Provider',
  agreementId: 'agreement-2',
  agreementStatus: 'draft',
  agreementSigned: false,
  visitState: null,
});

const BLOODS = row({
  arrivalId: 'arrival-3',
  patientId: '33333333-3333-4000-8000-000000000003',
  patientName: 'Sam Bloodsonly',
  patientRecordNumber: 'DEV-SAM-BLOODSONLY',
  arrivedAt: '2026-09-12T01:00:00.000Z',
  seenByName: 'Example Ray',
  agreementId: null,
  agreementStatus: null,
  agreementSigned: false,
  visitState: null,
});

const UNMATCHED = row({
  arrivalId: 'arrival-4',
  patientId: null,
  patientName: null,
  patientRecordNumber: 'DEV-UNKNOWN-9',
  arrivedAt: '2026-09-12T02:00:00.000Z',
  seenByName: null,
  agreementId: null,
  agreementStatus: null,
  agreementSigned: false,
  visitState: null,
});

const calls: Array<{ url: string; method: string }> = [];

const register = (over: Partial<DayRegister> = {}): DayRegister => ({
  date: '2026-09-12',
  timezone: 'Australia/Sydney',
  rows: [row(), NURSED, BLOODS, UNMATCHED],
  ...over,
});

/** The server answers whatever day it was asked for; today when asked for none. */
function stubFetch(byDate: (date: string | null) => DayRegister | { status: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const asked = new URL(url, 'http://localhost').searchParams.get('date');
      const answer = byDate(asked);
      if ('status' in answer) {
        return { ok: false, status: answer.status, json: async () => ({ message: 'no' }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => answer } as unknown as Response;
    }),
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/practice/day',
}));

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['practice_user'], practiceId: PRACTICE }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
  silentRestoreInFlight: () => false,
  restoreRefusalReason: () => null,
}));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('the day register', () => {
  it('day_register_takes_todays_date_from_the_server_not_the_browser', async () => {
    stubFetch(() => register());
    render(<DayView practiceId={PRACTICE} />);

    // The first read carries no date at all. The browser never guesses one.
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]!.url).not.toContain('date=');

    /*
     * And the control is seeded from the answer. Waiting for the VALUE, not
     * for the input — the field exists before the fetch resolves, and reading
     * `.value` straight after `findByTestId` is the second-fetch race wow.md
     * §2 item 6 is about.
     */
    const field = (await screen.findByTestId('day-date')) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('2026-09-12'));

    // Which clock the day was measured in, said on the page.
    expect(screen.getByTestId('day-timezone').textContent).toContain('Australia/Sydney');
  });

  it('day_register_reads_the_day_that_was_chosen', async () => {
    stubFetch((date) =>
      date === '2026-09-10'
        ? register({ date: '2026-09-10', rows: [row({ patientName: 'Casey Lastweek' })] })
        : register(),
    );
    render(<DayView practiceId={PRACTICE} />);

    const field = (await screen.findByTestId('day-date')) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('2026-09-12'));

    fireEvent.change(field, { target: { value: '2026-09-10' } });

    await waitFor(() => expect(screen.getByText('Casey Lastweek')).toBeTruthy());
    expect(calls.some((c) => c.url.includes('date=2026-09-10'))).toBe(true);
    // Still only reads. Nothing on this page acts.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('day_register_shows_a_row_per_patient_in_arrival_order', async () => {
    stubFetch(() => register());
    render(<DayView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('day-table')).toBeTruthy());
    const names = [...screen.getByTestId('day-table').querySelectorAll('tbody tr td:first-child')].map(
      (cell) => cell.textContent,
    );

    // Arrival order is the server's; nothing here re-sorts it.
    expect(names[0]).toContain('Jamie Sampleton');
    expect(names[1]).toContain('Alex Nursevisit');
    expect(names[3]).toContain(strings.dayRegister.noPatientRecord);

    // The practice's own number under the name, labelled so it cannot be read
    // as anything else (hard rule 1).
    expect(screen.getByTestId('day-record-arrival-1').textContent).toBe('Patient ID DEV-JAMIE-SAMPLETON');
    expect(screen.getByTestId('day-record-arrival-4').textContent).toBe('Patient ID DEV-UNKNOWN-9');

    // Whose agreement it is, only where it is somebody else (§6a).
    expect(screen.getByTestId('day-under-arrival-2').textContent).toBe('Dr Example Provider’s agreement');
    expect(screen.queryByTestId('day-under-arrival-1')).toBeNull();

    expect(screen.getByTestId('day-agreement-arrival-1').textContent).toBe('Signed and stored');
    expect(screen.getByTestId('day-signed-arrival-1').textContent).toBe(strings.dayRegister.signedYes);
    expect(screen.getByTestId('day-signed-arrival-2').textContent).toBe(strings.dayRegister.signedNo);
    // Nothing to sign is not "Not yet" — a permanent false alarm is a column
    // people learn to ignore.
    expect(screen.getByTestId('day-signed-arrival-3').textContent).toBe(strings.dayRegister.signedNotApplicable);
    expect(screen.getByTestId('day-agreement-arrival-3').textContent).toBe(strings.dayRegister.noAgreement);
    expect(screen.getByTestId('day-visit-arrival-2').textContent).toBe(strings.dayRegister.visitNotSaid);
  });

  it('day_register_carries_no_medicare_number_and_no_amount', async () => {
    stubFetch(() => register());
    const { container } = render(<DayView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId('day-table')).toBeTruthy());

    const said = container.textContent ?? '';
    expect(said).not.toMatch(/medicare/i);
    expect(said).not.toMatch(/\$|\bamount\b|\bbenefit\b/i);
    expect(said).not.toMatch(/\bcertified\b|\bapproved\b|\baccredited\b/i);
    // Hard rule 8, said out loud on the page.
    expect(screen.getByTestId('day-never-blocks')).toBeTruthy();
  });

  it('day_register_shows_an_unmapped_status_code_rather_than_a_blank', () => {
    /*
     * A LIFECYCLE STATE CAN REACH THE WIRE BEFORE THE STRING TABLE HEARS ABOUT
     * IT. A blank cell in the agreement column would read as "there is no
     * agreement", which is a claim; the code is diagnosable (CLAUDE.md §7).
     */
    expect(agreementStatusLabel('stored')).toBe('Signed and stored');
    expect(agreementStatusLabel('some_new_state')).toBe('some_new_state');

    expect(signedLabel({ agreementId: null, agreementSigned: false })).toBe(
      strings.dayRegister.signedNotApplicable,
    );
    expect(signedLabel({ agreementId: 'a', agreementSigned: false })).toBe(strings.dayRegister.signedNo);
    expect(signedLabel({ agreementId: 'a', agreementSigned: true })).toBe(strings.dayRegister.signedYes);
  });

  it('day_register_says_when_nobody_came_in', async () => {
    stubFetch(() => register({ rows: [] }));
    render(<DayView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('day-nobody')).toBeTruthy());
    expect(screen.queryByTestId('day-table')).toBeNull();
  });

  it('day_register_says_when_the_day_could_not_be_read', async () => {
    stubFetch(() => ({ status: 500 }));
    render(<DayView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('day-error')).toBeTruthy());
    // A failure here is a failure to LOOK. It still holds nobody up.
    expect(screen.getByTestId('day-never-blocks')).toBeTruthy();
  });
});

describe('the front desk leads here', () => {
  it('front_desk_links_to_the_day_register_below_the_rails', async () => {
    /*
     * ASSERTED ON THE PAGE CARL ANNOTATED, not on this one. wow.md §10 rule 4:
     * *"a test that fails when somebody quietly forks a component is the only
     * version of this rule that still works in six weeks"* — and the same goes
     * for a link somebody quietly moves.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response),
    );
    render(<FrontDeskView practiceId={PRACTICE} />);

    const link = await screen.findByTestId('frontdesk-to-day');
    expect(link.getAttribute('href')).toBe('/practice/day');
    expect(link.textContent).toContain(strings.frontdesk.rail.dayRegister);
    // Inside the rail — the left column, below the three groups.
    expect(screen.getByTestId('frontdesk-rail').contains(link)).toBe(true);
  });
});
