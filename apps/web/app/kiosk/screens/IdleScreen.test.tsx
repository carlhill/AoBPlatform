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
import { strings } from '../strings';

const noop = () => undefined;

function renderIdle(overrides: Partial<Parameters<typeof IdleScreen>[0]> = {}) {
  const props = {
    practiceName: 'Sample Practice',
    locationLine: 'NSW',
    mode: 'idle' as const,
    rows: [],
    error: null,
    online: true,
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
    expect(view.queryByTestId('waiting-count')).toBeNull();
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
  it('keeps Start check-in and "nobody waiting" when the list loaded but has nobody on it', () => {
    const view = renderIdle({ error: null, rows: [] });

    expect(view.getByTestId('start-check-in')).toBeTruthy();
    expect(view.getByTestId('waiting-count').textContent).toBe(strings.idle.nobodyWaiting);
    expect(view.queryByTestId('idle-load-failed')).toBeNull();
  });
});
