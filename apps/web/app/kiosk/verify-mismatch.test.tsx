/**
 * K-2 — THE MISMATCH MESSAGE CLEARS THE MOMENT A FIELD CHANGES (Carl, 4 Sep
 * 2026, confirmed against a live screenshot: the mismatch already stays on
 * K-2 with the entered values kept, as briefed — this is the next
 * refinement on top of that).
 *
 * Leaving "Some details don't match" up while the patient is correcting a
 * value reads as though the correction had already failed too. The attempt
 * counter in the footer ("Attempt 2 of 3") is a true statement about how many
 * tries have been spent, so it stays; only the mismatch message clears, and
 * it returns only if the next Continue also fails.
 *
 * Driven against the real `Ceremony` component, because the behaviour is a
 * wiring decision in `Ceremony.tsx` (the `onChange` passed to `VerifyScreen`),
 * not something `VerifyScreen` decides on its own.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import type { KioskWaitingRow } from './api';

const ROW: KioskWaitingRow = {
  captureRequestId: 'cr-signable',
  agreementId: 'ag-signable',
  patientId: 'pt-signable',
  patientName: 'Riley Testable',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:30',
  agreementStatus: 'verification_pending',
  agreementType: 'episodic_pre',
  waitingSince: '2026-09-04T08:05:00.000Z',
  signable: true,
  blockedReason: null,
};

// `vi.hoisted` — `vi.mock` factories run before ordinary top-level `const`s.
const { attemptChallenge } = vi.hoisted(() => ({
  attemptChallenge: vi.fn(async () => ({ outcome: 'failed' as const })),
}));

vi.mock('./pairing', () => ({
  PAIRING_CREDENTIAL_KEY: 'aob.kiosk.pairing',
  PERSISTABLE_KEYS: ['aob.kiosk.pairing'],
  readPairingCredential: () => 'fake-device-credential',
  writePairingCredential: () => true,
  clearPairingCredential: vi.fn(),
}));

vi.mock('./api', () => ({
  KioskApiError: class KioskApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  isUnpaired: () => false,
  fetchKioskMe: vi.fn(async () => ({
    deviceId: 'device-1',
    deviceLabel: 'Test tablet',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: ['name', 'date_of_birth', 'address'],
    reload: false,
  })),
  fetchWaitingList: vi.fn(async () => ({
    kind: 'changed' as const,
    etag: '"rev-1"',
    body: {
      practiceId: 'practice-1',
      revision: 'rev-1',
      pollMs: 60_000,
      identifierTypes: ['name', 'date_of_birth', 'address'],
      waiting: [ROW],
      reload: false,
    },
  })),
  fetchPracticeStaffNames: vi.fn(async () => []),
  fetchAgreement: vi.fn(),
  startChallenge: vi.fn(async () => ({ challengeId: 'chal-1', identifierTypes: ['name', 'date_of_birth', 'address'] })),
  attemptChallenge,
  transitionAgreement: vi.fn(),
  changeAssignor: vi.fn(),
  lockParticulars: vi.fn(),
  signAgreement: vi.fn(),
  completeCapture: vi.fn(),
}));

describe('mismatch_message_clears_when_a_field_changes', () => {
  it('fail → message shown → edit one field → message gone → attempt counter unchanged', async () => {
    render(<Ceremony />);

    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));

    await waitFor(() => expect(screen.getByTestId(`pick-${ROW.captureRequestId}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`pick-${ROW.captureRequestId}`));

    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());

    fireEvent.change(screen.getByTestId('identifier-name-given'), { target: { value: 'Riley' } });
    fireEvent.change(screen.getByTestId('identifier-name-family'), { target: { value: 'Testable' } });
    fireEvent.change(screen.getByTestId('identifier-address'), {
      target: { value: '2 Example St Sampletown 2000' },
    });
    fireEvent.change(screen.getByTestId('identifier-dob-day'), { target: { value: '04' } });
    fireEvent.change(screen.getByTestId('identifier-dob-month'), { target: { value: '08' } });
    fireEvent.change(screen.getByTestId('identifier-dob-year'), { target: { value: '1962' } });

    await waitFor(() => expect(screen.getByText(strings.verify.attemptOf(1, 3))).toBeTruthy());

    fireEvent.click(screen.getByTestId('verify-continue'));

    /*
     * FAIL: the mismatch message appears, in place, on the same screen. The
     * attempt ladder itself advances the moment the failure is known — see
     * `retryAfterMismatch` in `rules/verification.ts` — so the footer now
     * reads "Attempt 2 of 3" and that is the counter this test tracks from
     * here on: a TRUE statement about tries spent, which the mismatch
     * message clearing must not touch.
     */
    await waitFor(() => expect(screen.getByTestId('mismatch-heading')).toBeTruthy());
    expect(screen.getByTestId('mismatch-body').textContent).toBe(strings.verify.mismatchBody);
    // The values are still there — the earlier ruling this builds on.
    expect((screen.getByTestId('identifier-name-given') as HTMLInputElement).value).toBe('Riley');
    const attemptCounter = strings.verify.attemptOf(2, 3);
    expect(screen.getByText(attemptCounter)).toBeTruthy();

    // EDIT ONE FIELD: the message clears immediately, before any new Continue.
    fireEvent.change(screen.getByTestId('identifier-address'), {
      target: { value: '2 Example St Sampletown 2000, Unit 4' },
    });

    expect(screen.queryByTestId('mismatch-heading')).toBeNull();
    expect(screen.queryByTestId('mismatch-body')).toBeNull();
    // Still "Attempt 2 of 3" — unchanged by the edit that cleared the message.
    expect(screen.getByText(attemptCounter)).toBeTruthy();
    // And nothing typed was lost by the edit that cleared it.
    expect((screen.getByTestId('identifier-name-given') as HTMLInputElement).value).toBe('Riley');
  });
});
