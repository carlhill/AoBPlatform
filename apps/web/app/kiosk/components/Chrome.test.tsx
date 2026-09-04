/**
 * "WHICH TABLET AM I?" (Carl, 4 Sep 2026) — the footer every kiosk screen
 * wears now names the paired tablet: the label a person gave it on
 * `/practice/devices`, and the first eight characters of its id, so a support
 * call can identify the physical device without reading a UUID down the
 * phone.
 *
 * `../api` AND `../pairing` ARE MOCKED WHOLESALE, the same way `Ceremony`'s
 * own tests mock them (`walk-up-claim.test.tsx`) — both resolve to the SAME
 * modules `Screen` imports (`apps/web/app/kiosk/api.ts` and
 * `apps/web/app/kiosk/pairing.ts`), whichever relative path reaches them.
 * What is asserted is which calls `Screen` makes and what it renders from
 * them, never a real network request.
 *
 * ZERO FOOTPRINT, STILL. `Screen` asks the server on every mount rather than
 * remembering an answer — CLAUDE.md §7 bans every storage surface under
 * `app/kiosk/**`, and asking again on reload is the same choice
 * `Ceremony.tsx` already makes for the practice name.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen as testScreen, waitFor } from '@testing-library/react';
import { Screen } from './Chrome';
import { strings } from '../strings';

const { fetchKioskMe } = vi.hoisted(() => ({ fetchKioskMe: vi.fn() }));
let credential: string | null = 'fake-device-credential';

vi.mock('../api', () => ({ fetchKioskMe }));
vi.mock('../pairing', () => ({ readPairingCredential: () => credential }));

describe('kiosk_footer_names_the_tablet', () => {
  beforeEach(() => {
    fetchKioskMe.mockReset();
    credential = 'fake-device-credential';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the paired tablet’s label and the first eight characters of its id, muted, at the foot of the screen', async () => {
    fetchKioskMe.mockResolvedValue({
      deviceId: 'e1e2c073-1111-2222-3333-444444444444',
      deviceLabel: 'Carl browser tablet',
      practiceId: 'practice-1',
      practiceName: 'Sample Practice',
      reload: false,
    });

    render(
      <Screen practiceName="Sample Practice">
        <p>content</p>
      </Screen>,
    );

    await waitFor(() => expect(testScreen.getByTestId('kiosk-device-identity')).toBeTruthy());
    const line = testScreen.getByTestId('kiosk-device-identity');
    expect(line.textContent).toBe(strings.chrome.deviceIdentity('Carl browser tablet', 'e1e2c073'));
    // The whole UUID never reaches the screen — eight characters is enough to
    // tell tablets apart on a phone call, and no more than that.
    expect(line.textContent).not.toContain('e1e2c073-1111-2222-3333-444444444444');
  });

  it('an unpaired screen has no credential to ask with, and asks nothing', async () => {
    credential = null;

    render(
      <Screen practiceName={strings.appName}>
        <p>content</p>
      </Screen>,
    );

    // Give any stray microtask a turn, then confirm nothing arrived and
    // nothing was asked for.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(testScreen.queryByTestId('kiosk-device-identity')).toBeNull();
    expect(fetchKioskMe).not.toHaveBeenCalled();
  });

  it('a refused or failed call is cosmetic only — the screen renders exactly as it would without the footer', async () => {
    fetchKioskMe.mockRejectedValue(new Error('offline'));

    render(
      <Screen practiceName="Sample Practice">
        <p>content</p>
      </Screen>,
    );

    await waitFor(() => expect(fetchKioskMe).toHaveBeenCalled());
    expect(testScreen.queryByTestId('kiosk-device-identity')).toBeNull();
  });
});
