/**
 * The Kiosk card on `/practice/channels` — the regression this guards
 * against is Carl's own report: the card said "NOT BUILT YET — nothing to
 * pair yet" long after tablet pairing shipped and a tablet was actually
 * paired, because the card carried its own copy instead of reading the
 * `/devices` list the setup hub's Tablets card reads. This asserts the two
 * can no longer disagree, and that the stale copy is gone for good.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChannelsView } from './ChannelsView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

const PRACTICE_CONFIG = {
  id: PRACTICE,
  senderIdRegistered: true,
  linkExpiryHours: 24,
  identifierTypes: ['name', 'date_of_birth', 'address'],
  /** Seconds on the wire; the page shows minutes. Two, so the conversion is visible. */
  kioskIdleTimeoutSeconds: 120,
};

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: [], practiceId: PRACTICE, consoleRole: 'admin' }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
}));

function stubFetch(devices: Array<{ state: string }>, devicesOk = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/devices')) {
        return devicesOk
          ? ({ ok: true, status: 200, json: async () => ({ devices, minimumKioskBuild: null }) } as unknown as Response)
          : ({ ok: false, status: 403, json: async () => ({ message: 'refused' }) } as unknown as Response);
      }
      return { ok: true, status: 200, json: async () => PRACTICE_CONFIG } as unknown as Response;
    }),
  );
}

describe('the Kiosk card — read from the devices list, never its own claim', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a live paired/revoked count and DONE once at least one tablet is paired', async () => {
    stubFetch([{ state: 'paired' }, { state: 'paired' }, { state: 'revoked' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByText('2 tablets paired · 1 revoked')).toBeTruthy());
    expect(screen.getByText(strings.channels.kioskDone)).toBeTruthy();

    // The stale claim never appears again.
    expect(document.body.textContent ?? '').not.toMatch(/not built yet/i);
    expect(document.body.textContent ?? '').not.toMatch(/nothing to pair yet/i);
  });

  it('says "no tablet paired yet" and NEEDS WORK when the practice has none', async () => {
    stubFetch([]);
    render(<ChannelsView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByText(strings.channels.kioskNone)).toBeTruthy());
    expect(screen.getByText(strings.channels.kioskNeedsWork)).toBeTruthy();
  });

  it('never guesses a count it cannot see — a refused fetch says so instead of "0 paired"', async () => {
    stubFetch([], false);
    render(<ChannelsView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByText(strings.channels.kioskUnavailable)).toBeTruthy());
    expect(screen.queryByText('0 tablets paired · 0 revoked')).toBeNull();
    expect(screen.getByText(strings.channels.kioskNeedsWork)).toBeTruthy();
  });

  it('links to the tablets, gated the same way the hub gates it', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const link = (await screen.findByTestId('channels-manage-tablets')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/devices');
    expect(link.textContent).toContain(strings.channels.kioskManage);
  });
});

/**
 * THE INACTIVITY RESET, SET IN MINUTES AND STORED IN SECONDS (Carl, 4 Sep
 * 2026). The conversion is the whole of what can go wrong here: a page that
 * saved minutes as seconds would silently give every tablet in the practice a
 * two-second timeout, which is hard rule 8 broken by a units bug — nobody
 * could finish the ceremony at that tablet.
 */
describe('the kiosk inactivity reset field', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the practice setting in MINUTES and saves it back in SECONDS', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const input = (await screen.findByTestId('channels-idle-minutes')) as HTMLInputElement;
    // 120 seconds arrived; two minutes is shown.
    await waitFor(() => expect(input.value).toBe('2'));

    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('channels-save'));

    await waitFor(() => {
      const patch = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.kioskIdleTimeoutSeconds).toBe(420);
    });
  });

  it('falls back to five minutes rather than to an empty box when the server says nothing', async () => {
    /*
     * AN EMPTY BOX WOULD READ AS "NO TIMEOUT", which is the one thing this
     * setting may never mean — so an older core that does not carry the field
     * shows the default, not a blank.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/devices')) {
          return { ok: true, status: 200, json: async () => ({ devices: [] }) } as unknown as Response;
        }
        const { kioskIdleTimeoutSeconds: _omitted, ...withoutIt } = PRACTICE_CONFIG;
        return { ok: true, status: 200, json: async () => withoutIt } as unknown as Response;
      }),
    );
    render(<ChannelsView practiceId={PRACTICE} />);

    const input = (await screen.findByTestId('channels-idle-minutes')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('5'));
  });

  it('will not save a number outside the range the server would refuse', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const input = (await screen.findByTestId('channels-idle-minutes')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('2'));

    for (const refused of ['0', '31', '', '2.5']) {
      fireEvent.change(input, { target: { value: refused } });
      expect((screen.getByTestId('channels-save') as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(input, { target: { value: '30' } });
    expect((screen.getByTestId('channels-save') as HTMLButtonElement).disabled).toBe(false);
  });
});
