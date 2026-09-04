/**
 * K-1 — the idle screen must not offer a "Start check-in" over a waiting
 * list the server could not send (Carl, 4 Sep 2026).
 *
 * A FAILED POLL AND AN EMPTY ROOM ARE DIFFERENT THINGS. Nobody waiting is an
 * ordinary morning — the button stays, because reception may push somebody
 * onto the list a moment later. A failed fetch, a non-2xx, or a device the
 * poll has just flagged unpaired (but not yet redirected off this screen) mean
 * there is no real list behind the button at all, so it is hidden and the
 * existing "could not be loaded" message is the one thing shown below the
 * heading. The poll itself keeps running at its existing cadence — this is a
 * rendering choice, not a new retry loop.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { IdleScreen } from './IdleScreen';
import type { KioskWaitingRow } from '../api';
import { strings } from '../strings';

const ROW: KioskWaitingRow = {
  captureRequestId: 'cr-1',
  agreementId: 'ag-1',
  patientId: 'pt-1',
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:00',
  agreementStatus: 'verification_pending',
  agreementType: 'episodic_pre',
  waitingSince: '2026-09-04T08:00:00.000Z',
  signable: true,
  blockedReason: null,
};

const noop = () => undefined;

function renderIdle(overrides: Partial<Parameters<typeof IdleScreen>[0]> = {}) {
  const props = {
    practiceName: 'Sample Practice',
    locationLine: 'NSW',
    mode: 'idle' as const,
    rows: [],
    error: null,
    online: true,
    testDevice: false,
    onStart: noop,
    onBack: noop,
    onPick: noop,
    onRetry: noop,
    ...overrides,
  };
  return render(<IdleScreen {...props} />);
}

describe('idle_hides_start_when_the_list_failed', () => {
  it('hides Start check-in and shows only the failure message when the poll has an error', () => {
    const view = renderIdle({ error: 'Failed to fetch' });

    expect(view.queryByTestId('start-check-in')).toBeNull();
    expect(view.getByTestId('idle-load-failed').textContent).toBe(strings.idle.loadFailed);
  });

  it('brings the button back on its own once the error clears', () => {
    const view = renderIdle({ error: 'Failed to fetch' });
    expect(view.queryByTestId('start-check-in')).toBeNull();

    view.rerender(
      <IdleScreen
        practiceName="Sample Practice"
        locationLine="NSW"
        mode="idle"
        rows={[]}
        error={null}
        online
        testDevice={false}
        onStart={noop}
        onBack={noop}
        onPick={noop}
        onRetry={noop}
      />,
    );
    expect(view.getByTestId('start-check-in')).toBeTruthy();
    expect(view.queryByTestId('idle-load-failed')).toBeNull();
  });
});

describe('idle_keeps_start_when_the_list_is_empty', () => {
  it('keeps Begin when the poll answered but carried nobody', () => {
    /*
     * ON AN ORDINARY TABLET AN EMPTY LIST IS NOW THE ONLY ANSWER — the server
     * sends `hidden: true` with no rows — so "nothing came back" can no longer
     * mean "something is wrong". Begin stays live; only a failed poll hides it.
     */
    const view = renderIdle({ error: null, rows: [] });

    expect(view.getByTestId('start-check-in')).toBeTruthy();
    expect(view.queryByTestId('idle-load-failed')).toBeNull();
  });
});

describe('idle_shows_no_count', () => {
  /*
   * CARL, 4 SEPTEMBER 2026: "Remove the 'x people ready to sign' text — this
   * is a security feature."
   *
   * The count named nobody, which is why it survived the first pass. It still
   * told everyone in the waiting room how many people were in it, and on a
   * quiet morning "1 person is ready to sign" beside one person at the desk is
   * not anonymous. This test is what stops it coming back: it asserts the
   * ABSENCE, at three list lengths, and it asserts that the string it was
   * built from is gone from the table too.
   */
  it('never renders a count of who is waiting, however many there are', () => {
    for (const rows of [[], [ROW], [ROW, { ...ROW, captureRequestId: 'cr-2' }]]) {
      const view = renderIdle({ error: null, rows });
      expect(view.queryByTestId('waiting-count')).toBeNull();
      expect(view.container.textContent).not.toMatch(/ready to sign/i);
      expect(view.container.textContent).not.toMatch(/\b\d+ (person|people)\b/i);
      view.unmount();
    }
  });

  it('has no waitingCount string left in the table to render', () => {
    expect((strings.idle as Record<string, unknown>).waitingCount).toBeUndefined();
  });
});

describe('list_only_on_a_test_device_and_bannered', () => {
  /*
   * THE LIST IS FOR TESTING ONLY (Carl, 4 Sep 2026), and a screen showing
   * patient names must always say why it is showing them. The banner is not
   * dismissible and it sits ABOVE the names, so somebody walking past can tell
   * a test rig from a misconfiguration in one glance.
   */
  it('banners the list screen, above the names', () => {
    const view = renderIdle({ mode: 'list', testDevice: true, rows: [ROW] });

    const banner = view.getByTestId('test-device-banner');
    expect(banner.textContent).toBe(strings.idle.testDeviceBanner);
    expect(banner.textContent).toMatch(/test device/i);
    // Above the first name on the screen, in document order.
    const name = view.getByTestId(`pick-${ROW.captureRequestId}`);
    expect(banner.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says so on the idle screen too, so a test device is never mistaken for a real one', () => {
    // Unmounted between the two, because both queries reach the whole
    // document: a leftover banner from the first render would make the second
    // assertion pass for the wrong reason and fail for the right one.
    const on = renderIdle({ testDevice: true });
    expect(on.getByTestId('test-device-banner')).toBeTruthy();
    on.unmount();

    const off = renderIdle({ testDevice: false });
    expect(off.queryByTestId('test-device-banner')).toBeNull();
  });
});
