/**
 * THE ABN PREVIEW ON THE APPLICATION FORM.
 *
 * What these protect, in the order they matter:
 *
 *   THE FOUR OUTCOMES STAY FOUR. Found-and-active, found-and-cancelled,
 *   the-register-says-no, and we-could-not-ask are different facts with
 *   different next steps. Collapsing any pair of them into one message is the
 *   defect Carl named on 4 September 2026, and the last two are the pair most
 *   likely to be merged by accident.
 *
 *   A REGISTER OUTAGE NEVER STOPS AN APPLICATION. "Could not be checked" leaves
 *   the submit alive; the server checks again on arrival and the attestation
 *   path takes over from there. A cancelled or unknown ABN does stop it, because
 *   the ENTITY is wrong and no amount of retyping fixes that.
 *
 *   AN UNMAPPED REASON CODE IS SHOWN, NOT SWALLOWED. A code on screen can be
 *   quoted and diagnosed.
 *
 * Driven against the real form with `fetch` stubbed, because what is being
 * tested is which of the four stories the applicant is told.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { ApplyForm } from './ApplyForm';
import { strings } from '../strings';

/** ABN 51 824 753 556 — check digits agree. The ATO's, and nobody's personally. */
const ABN = '51824753556';

const FOUND = {
  outcome: 'found',
  abn: ABN,
  abnStatus: 'ACTIVE',
  active: true,
  legalName: 'SAMPLE MEDICAL HOLDINGS PTY LTD',
  businessNames: ['Sampletown Family Practice'],
  entityType: 'PTY_LTD',
  gstRegistered: true,
  abnStatusEffectiveFrom: '1999-11-01',
  acn: null,
  mainBusinessState: 'NSW',
  mainBusinessPostcode: '2640',
};

function answerWith(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: async () => body }) as unknown as typeof fetch,
  );
}

/** Type the ABN, then let the debounce fire and the promise chain settle. */
async function typeAbn(value = ABN) {
  fireEvent.change(screen.getByTestId('apply-abn'), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('the ABN preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the entity the register matched, and fills the empty name field', async () => {
    answerWith(FOUND);
    render(<ApplyForm />);
    await typeAbn();

    const panel = screen.getByTestId('apply-abr-found');
    expect(panel.textContent).toContain('SAMPLE MEDICAL HOLDINGS PTY LTD');
    expect(panel.textContent).toContain('ACTIVE');
    expect(panel.textContent).toContain('Sampletown Family Practice');
    expect((screen.getByTestId('apply-name') as HTMLInputElement).value).toBe(
      'SAMPLE MEDICAL HOLDINGS PTY LTD',
    );
  });

  it('never claims the practice is certified, approved or accredited', async () => {
    answerWith(FOUND);
    render(<ApplyForm />);
    await typeAbn();

    const shown = screen.getByTestId('apply-abr-found').textContent ?? '';
    for (const forbidden of ['certified', 'approved', 'accredited', 'government-approved']) {
      expect(shown.toLowerCase()).not.toContain(forbidden);
    }
    expect(shown).toContain('Checked against the Australian Business Register');
  });

  it('kills the submit when the register says the ABN is cancelled', async () => {
    answerWith({ ...FOUND, abnStatus: 'CANCELLED', active: false });
    render(<ApplyForm />);
    await typeAbn();

    expect(screen.getByTestId('apply-abr-found').textContent).toContain('CANCELLED');
    expect((screen.getByTestId('apply-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('kills the submit when the register has no record, and offers no attestation', async () => {
    answerWith({ outcome: 'not_found', reason: 'no_record', abn: ABN, checksumValid: true });
    render(<ApplyForm />);
    await typeAbn();

    const panel = screen.getByTestId('apply-abr-not-found');
    expect(panel.textContent).toContain(strings.apply.abrReasons.no_record);
    expect((screen.getByTestId('apply-submit') as HTMLButtonElement).disabled).toBe(true);
    // The attestation panel exists for silence, not for a no.
    expect(screen.queryByTestId('apply-att-legal-name')).toBeNull();
  });

  /**
   * The one that matters most: our own dependency being unwell must not become
   * the applicant's problem. Hard rule 8's analogue outside the care path.
   */
  it('leaves the application sendable when the register cannot be reached', async () => {
    answerWith({ outcome: 'unreachable', reason: 'timeout', abn: ABN, checksumValid: true });
    render(<ApplyForm />);
    await typeAbn();

    const panel = screen.getByTestId('apply-abr-unreachable');
    expect(panel.textContent).toContain(strings.apply.abrReasons.timeout);
    expect(panel.textContent).toContain(strings.apply.registerUnavailableSend);
    // Nothing about the ABN is blocking; only the unfilled fields are.
    expect(screen.queryByTestId('apply-abr-not-found')).toBeNull();
  });

  it('shows an unmapped reason code rather than a generic message', async () => {
    answerWith({ outcome: 'unreachable', reason: 'moon_phase_wrong', abn: ABN, checksumValid: true });
    render(<ApplyForm />);
    await typeAbn();

    expect(screen.getByTestId('apply-abr-unreachable').textContent).toContain('moon_phase_wrong');
  });

  it('says nothing at all until the check digits agree', async () => {
    answerWith(FOUND);
    render(<ApplyForm />);
    await typeAbn('5182475355');

    expect(screen.queryByTestId('apply-abr-found')).toBeNull();
    expect(screen.queryByTestId('apply-abr-checking')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks the register once for one ABN typed in one go', async () => {
    answerWith(FOUND);
    render(<ApplyForm />);
    const field = screen.getByTestId('apply-abn');
    for (const partial of ['518247535', '5182475355', ABN]) {
      fireEvent.change(field, { target: { value: partial } });
    }
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(
      `abn-lookup?abn=${ABN}`,
    );
  });
});
