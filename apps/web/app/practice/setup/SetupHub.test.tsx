/**
 * The setup hub's Tablets card — and the bug Carl saw it fix.
 *
 * Two extra links ("Open the tablets", "Open the send to the tablet") were
 * buried inside the Messages card, and Capture channels went on saying
 * "Kiosk: unpaired" with a tablet actually paired. Both cards now read the
 * SAME `/devices` fetch (see `DevicesSummary` in `SetupHub.tsx`), so they
 * cannot disagree, and the Messages card carries only correspondence again.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SetupHub } from './SetupHub';
import { strings } from '../../strings';

const PRACTICE = '821709fb-7f89-4fcf-95c0-27c5eb55cec8';

function baseHub(kioskNote: string, kioskNeedsWork: boolean) {
  return {
    practice: {
      id: PRACTICE,
      name: 'Riverview Family Practice',
      legalName: 'Riverview Family Practice Pty Ltd',
      abn: '11 111 111 111',
      abnStatus: 'active',
      validationState: 'validated',
      validatedByName: 'Robin Reviewer',
      validatedAt: '2026-08-01T00:00:00.000Z',
      pms: 'medtech_evolution',
      credentialCount: 1,
    },
    readiness: { ready: true, readyCount: 1, blockers: [], headline: 'Capture is available' },
    cards: [
      {
        key: 'entity',
        title: 'The entity',
        state: 'done',
        rollup: 'Company · active',
        rows: [],
        more: 0,
        href: '/practice/application',
      },
      {
        key: 'channels',
        title: 'Capture channels',
        state: 'attention',
        rollup: 'sender ID registered',
        rows: [
          { label: 'SMS sender ID', note: 'registered', needsWork: false },
          { label: 'Kiosk', note: kioskNote, needsWork: kioskNeedsWork },
        ],
        more: 0,
        href: '/practice/channels',
      },
    ],
  };
}

let session: {
  roles: string[];
  practiceId: string | null;
  practitionerId?: string;
  consoleRole?: string;
} | null = null;

vi.mock('../../auth', () => ({
  currentSession: () => session,
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
}));

function stubFetch(hub: unknown, devices: 'ok' | 'refused' | 'network-error', rows: Array<{ state: string }> = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/organisations/setup')) {
        return { ok: true, status: 200, json: async () => hub } as unknown as Response;
      }
      if (url.endsWith('/devices')) {
        if (devices === 'network-error') throw new TypeError('failed to fetch');
        return devices === 'ok'
          ? ({ ok: true, status: 200, json: async () => ({ devices: rows, minimumKioskBuild: null }) } as unknown as Response)
          : ({ ok: false, status: 403, json: async () => ({ message: 'refused' }) } as unknown as Response);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe('the Tablets card, and the Kiosk row it must never disagree with', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('as the practice: a live paired count, DONE, and no stale "unpaired"', async () => {
    session = { roles: [], practiceId: PRACTICE, consoleRole: 'admin' };
    stubFetch(baseHub('unpaired', true), 'ok', [
      { state: 'paired' },
      { state: 'paired' },
      { state: 'revoked' },
    ]);

    render(<SetupHub practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('card-tablets')).toBeTruthy());
    expect(screen.getByTestId('tablets-rollup').textContent).toBe('2 paired · 1 revoked');
    const tabletsCard = screen.getByTestId('card-tablets');
    expect(tabletsCard.textContent).toContain(strings.setup.states.done);

    // Capture channels' Kiosk row now agrees with the Tablets card, and the
    // server's stale "unpaired" is gone.
    const channelsCard = screen.getByTestId('card-channels');
    expect(channelsCard.textContent).toContain('2 tablets paired');
    expect(channelsCard.textContent).not.toContain('unpaired');

    // Exactly one path to each page — the Messages card no longer offers
    // either.
    expect(screen.getAllByTestId('hub-to-devices')).toHaveLength(1);
    expect(screen.getAllByTestId('hub-to-tablet')).toHaveLength(1);
    expect((screen.getByTestId('hub-to-devices') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/practice/devices',
    );
  });

  it('as the practice, with nothing paired: "No tablet paired yet", NOT STARTED', async () => {
    session = { roles: [], practiceId: PRACTICE, consoleRole: 'admin' };
    stubFetch(baseHub('unpaired', true), 'ok', []);

    render(<SetupHub practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('tablets-rollup').textContent).toBe(strings.setup.tabletsRollupNone));
    expect(screen.getByTestId('card-tablets').textContent).toContain(strings.setup.states.not_started);
  });

  it('as the platform, viewing read-only: the SAME live count as Capture channels, and DONE', async () => {
    /*
     * `GET /devices` answers a platform session too (seen live on
     * `/platform/practices/<id>` — Carl, 4 Sep 2026), so this is the ordinary
     * case, not the fallback: the Tablets card must show the real count and
     * agree with Capture channels, not retreat to "act as the practice"
     * merely because the viewer is the platform.
     */
    session = { roles: ['platform_admin'], practiceId: null };
    stubFetch(baseHub('unpaired', true), 'ok', [
      { state: 'paired' },
      { state: 'paired' },
      { state: 'paired' },
      { state: 'paired' },
    ]);

    render(<SetupHub practiceId={PRACTICE} viewOnly />);

    await waitFor(() => expect(screen.getByTestId('tablets-rollup').textContent).toBe('4 paired · 0 revoked'));
    expect(screen.getByTestId('card-tablets').textContent).toContain(strings.setup.states.done);
    expect(screen.getByTestId('card-channels').textContent).toContain('4 tablets paired');

    // Both links point at the read-only twins, not the practice routes that
    // would refuse an operator with no practice claim.
    expect((screen.getByTestId('hub-to-devices') as HTMLAnchorElement).getAttribute('href')).toBe(
      `/platform/practices/${PRACTICE}/devices`,
    );
    expect((screen.getByTestId('hub-to-tablet') as HTMLAnchorElement).getAttribute('href')).toBe(
      `/platform/practices/${PRACTICE}/tablet`,
    );
  });

  it('never shows a wrong number when the devices fetch genuinely fails', async () => {
    /*
     * Not "because the viewer is the platform" — the fetch above shows that
     * succeeds — but a real failure (an outage, or a caller `GET /devices`
     * does refuse) must still fall back honestly rather than print "0
     * paired", which would read as "no tablets" and might simply be untrue.
     * The server's own already-correct Kiosk row is kept rather than
     * overwritten by the failed live one.
     */
    session = { roles: ['platform_admin'], practiceId: null };
    stubFetch(baseHub('2 tablets paired', false), 'network-error');

    render(<SetupHub practiceId={PRACTICE} viewOnly />);

    await waitFor(() =>
      expect(screen.getByTestId('tablets-rollup').textContent).toBe(strings.setup.tabletsUnavailableAsPlatform),
    );
    expect(screen.getByTestId('card-tablets').textContent).toContain(strings.setup.states.not_started);
    expect(screen.getByTestId('card-channels').textContent).toContain('2 tablets paired');
  });

  it('the Messages card carries correspondence only — no tablet links live there any more', async () => {
    session = { roles: [], practiceId: PRACTICE, consoleRole: 'admin' };
    stubFetch(baseHub('unpaired', true), 'ok', [{ state: 'paired' }]);

    render(<SetupHub practiceId={PRACTICE} />);

    const messagesCard = await screen.findByLabelText(strings.queue.hubTitle);
    expect(messagesCard.querySelector('[data-testid="hub-to-devices"]')).toBeNull();
    expect(messagesCard.querySelector('[data-testid="hub-to-tablet"]')).toBeNull();
  });
});
