/**
 * `/platform/aobprinter-hosts` — every practice's AOBPRINTER host, worst
 * first (PRINTER-HEARTBEAT.md §4, D-2026-10-10-02).
 *
 * Worst means the order of the ten states on the practice's page — the same
 * `hostStates.ts` both pages read — so a row's place here and the first state
 * on its practice's page cannot disagree. Each row opens its practice's twin.
 * `GET /platform/aobprinter-hosts` is mocked: core builds it alongside.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AobPrinterHostsOverviewView, type AobPrinterHostOverviewRow } from './AobPrinterHostsOverviewView';
import { strings } from '../../strings';

vi.mock('next/navigation', () => ({
  usePathname: () => '/platform/aobprinter-hosts',
}));

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['platform_admin'], practiceId: null }),
  apiHeaders: () => ({ 'Content-Type': 'application/json' }),
}));

const s = strings.aobprinterHost.overview;

function row(practiceId: string, over: Partial<AobPrinterHostOverviewRow> = {}): AobPrinterHostOverviewRow {
  return {
    practiceId,
    practiceName: `Practice ${practiceId}`,
    liveness: 'live',
    chainStatus: 'consistent',
    regressionKind: null,
    localCheckOk: true,
    secondHostReporting: false,
    lastSeenAt: new Date(Date.now() - 30_000).toISOString(),
    printerVersion: '1.4.2',
    openExceptions: 0,
    filedUnconfirmed: 0,
    staleQueued: 0,
    clockSkewMs: 0,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the AOBPRINTER hosts overview', () => {
  it('lists_every_host_worst_first', async () => {
    // Delivered in no useful order.
    const hosts = [
      row('p-healthy'),
      row('p-never', { liveness: 'never_reported', lastSeenAt: null, printerVersion: null }),
      row('p-exceptions', { openExceptions: 2 }),
      row('p-regressed', { chainStatus: 'regressed', regressionKind: 'anchor_mismatch' }),
      row('p-offline', { liveness: 'offline' }),
      row('p-two', { secondHostReporting: true }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/platform/aobprinter-hosts')
          ? ({ ok: true, status: 200, json: async () => ({ hosts }) } as unknown as Response)
          : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
      ),
    );

    render(<AobPrinterHostsOverviewView />);

    await screen.findByTestId('aobprinter-overview-row-p-regressed');
    const order = screen
      .getAllByTestId(/^aobprinter-overview-row-/)
      .map((el) => el.getAttribute('data-testid')?.replace('aobprinter-overview-row-', ''));
    expect(order).toEqual(['p-regressed', 'p-two', 'p-offline', 'p-exceptions', 'p-healthy', 'p-never']);

    // Each row opens its practice's twin.
    for (const id of order) {
      const link = screen.getByTestId(`aobprinter-overview-link-${id}`);
      expect(link.getAttribute('href')).toBe(`/platform/practices/${id}/aobprinter-host`);
    }

    // Each row names its worst state.
    expect(screen.getByTestId('aobprinter-overview-row-p-regressed').textContent).toContain(s.states.regressed);
    expect(screen.getByTestId('aobprinter-overview-row-p-never').textContent).toContain(s.states.never_reported);
    expect(screen.getByTestId('aobprinter-overview-row-p-never').textContent).toContain(s.neverSeen);

    // Back to the organisation list, and the top-bar refresh.
    expect(screen.getByTestId('shell-back').getAttribute('href')).toBe('/practice');
    expect(screen.getByTestId('shell-refresh')).toBeTruthy();
  });

  it('says_so_when_no_practice_has_a_host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ hosts: [] }) }) as unknown as Response),
    );
    render(<AobPrinterHostsOverviewView />);
    expect((await screen.findByTestId('aobprinter-overview-none')).textContent).toBe(s.none);
  });
});
