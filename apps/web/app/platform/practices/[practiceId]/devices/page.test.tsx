/**
 * The Tablets twin, `/platform/practices/<id>/devices` — read-only by
 * construction (see `ViewOnly` and `page.tsx`'s own comment).
 *
 * `page.tsx` itself is one line of composition — `ViewOnly` wrapping
 * `DevicesView` — behind Next's async `params`, which is the same mechanism
 * every other twin route uses and is not this file's to prove. What this
 * guards is the one thing that must never regress: every control
 * `DevicesView` offers — Add tablet, Revoke, Rotate, the test-device toggle —
 * is inert. Everything else (what a device row shows, how it loads) is
 * `DevicesView`'s own behaviour and already has its test.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { DeviceRow } from '@aobplatform/domain';
import { DevicesView } from '../../../../practice/devices/DevicesView';
import { ViewOnly } from '../ViewOnly';

const PRACTICE_ID = 'practice-1';

const PAIRED: DeviceRow = {
  id: 'device-paired',
  label: 'Reception tablet 1',
  state: 'paired',
  createdBy: 'Robin Admin',
  createdAt: '2026-09-01T00:00:00.000Z',
  pairedAt: '2026-09-01T01:00:00.000Z',
  lastSeenAt: '2026-09-03T08:00:00.000Z',
  lastKioskBuild: '2026.09.03-1',
  revokedAt: null,
  revokedBy: null,
  pairingExpiresAt: null,
  showsWaitingList: false,
};

vi.mock('../../../../auth', () => ({
  currentSession: () => ({ roles: ['platform_admin'], practiceId: null }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE_ID }),
}));

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ devices: [PAIRED], minimumKioskBuild: null }) }) as unknown as Response,
    ),
  );
}

describe('the devices twin — read-only, never a live control', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the practice’s own list, wrapped in a disabled fieldset with no working control', async () => {
    stubFetch();
    render(
      <ViewOnly practiceId={PRACTICE_ID}>
        <DevicesView practiceId={PRACTICE_ID} />
      </ViewOnly>,
    );

    // The mode banner every twin carries.
    expect(screen.getByTestId('view-only')).toBeTruthy();

    // The SAME component the practice reads — its own data, once it loads.
    await waitFor(() => expect(screen.getByText('Reception tablet 1')).toBeTruthy());

    // Every control DevicesView offers lives inside one disabled fieldset —
    // by construction, not by a `disabled` prop threaded through each one.
    const fieldset = document.querySelector('fieldset');
    expect(fieldset).toBeTruthy();
    expect(fieldset?.hasAttribute('disabled')).toBe(true);

    /*
     * EVERY CONTROL SITS INSIDE THE ONE DISABLED FIELDSET. That is the actual
     * mechanism (ViewOnly.tsx's own comment: "by definition of the HTML"),
     * checked structurally rather than by reading each button's `.disabled`
     * IDL property — jsdom does not implement the fieldset-disabled cascade
     * onto descendant controls the way a real browser does, so asserting
     * `.disabled` here would test jsdom rather than the page.
     */
    const addButton = screen.getByTestId('device-add') as HTMLButtonElement;
    const rotateButton = screen.getByTestId(`rotate-${PAIRED.id}`) as HTMLButtonElement;
    const revokeButton = screen.getByTestId(`revoke-${PAIRED.id}`) as HTMLButtonElement;
    for (const control of [addButton, rotateButton, revokeButton]) {
      expect(fieldset?.contains(control)).toBe(true);
    }
  });
});
