/**
 * The AOBPRINTER host twin, `/platform/practices/<id>/aobprinter-host`
 * (PRINTER-HEARTBEAT.md §4, D-2026-10-10-02).
 *
 * Two guarantees. The practice's own page is shown read-only, inside
 * `ViewOnly`'s disabled fieldset like every twin. And Re-baseline — the
 * platform's act alone (decision 7) — is offered to the operator OUTSIDE that
 * fieldset, only for a regressed host, with the reasons from the versioned
 * content file in file order, posting `{ reasonCode }`; a refusal that asks
 * for a fresh second factor gets the control that provides one, and an
 * unmapped refusal code shows its code.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AOBPRINTER_REBASELINE_REASON_KEYS } from '@aobplatform/domain';
import type { AobPrinterHostRow, AobPrinterHostsView } from '@aobplatform/contracts';
import { AobPrinterHostTwin } from './AobPrinterHostTwin';
import { strings } from '../../../../strings';

const PRACTICE = '821709fb-7f89-4fcf-95c0-27c5eb55cec8';
const HASH_A = 'abcdef01'.repeat(8);
const HASH_B = '12345678'.repeat(8);
const t = strings.aobprinterHost;

vi.mock('next/navigation', () => ({
  usePathname: () => `/platform/practices/${PRACTICE}/aobprinter-host`,
}));

const beginLogin = vi.fn();
vi.mock('../../../../auth', () => ({
  currentSession: () => ({ roles: ['platform_admin'], practiceId: null }),
  apiHeaders: () => ({ 'Content-Type': 'application/json' }),
  beginLogin: (...args: unknown[]) => beginLogin(...args),
}));

function host(over: Partial<AobPrinterHostRow> = {}): AobPrinterHostRow {
  return {
    id: 'host-1',
    practiceId: PRACTICE,
    chainId: 'c0ffee00'.repeat(8),
    lastSeenAt: new Date(Date.now() - 20_000).toISOString(),
    hostSentAt: new Date(Date.now() - 20_000).toISOString(),
    intervalMs: 60_000,
    printerVersion: '1.4.2',
    templateVersion: 'db4-2026-09-2',
    schemaVersion: 7,
    runtimeVersion: 'v20.17.0',
    startedAt: '2026-10-09T21:00:00.000Z',
    collecting: true,
    retentionEnabled: false,
    queueCount: 0,
    counts: {
      prints: { received: 0, parse_exception: 0, queued: 0, sent: 4, send_exception: 0 },
      returns: { received: 0, received_exception: 0, filed: 0, filing_exception: 0, confirmed: 3 },
      openExceptions: { parse: 0, send: 0, received: 0, filing: 0 },
      oldestQueuedAt: null,
      oldestFiledUnconfirmedAt: null,
      staleQueued: 0,
      gapsLast24h: 0,
    },
    localCheck: { ok: true, verifiedThroughSeq: 10 },
    head: { seq: 10, hash: HASH_A },
    headAdvancedAt: null,
    vaultAnchoredAt: null,
    rebaselinedAt: null,
    rebaselinedBy: null,
    retiredAt: null,
    liveness: 'live',
    chain: { status: 'consistent', regression: null, anchorSeq: 10, anchorVerifiedAt: null },
    clockSkewMs: 0,
    exceptions: [],
    filedUnconfirmed: [],
    ...over,
  };
}

const REGRESSED = host({
  chain: {
    status: 'regressed',
    regression: {
      kind: 'went_backwards',
      at: '2026-10-10T01:02:03.000Z',
      expected: { seq: 12, hash: HASH_A },
      received: { seq: 9, hash: HASH_B },
    },
    anchorSeq: 12,
    anchorVerifiedAt: null,
  },
});

type Post = { url: string; body: unknown };

function stubFetch(view: AobPrinterHostsView, rebaseline?: { status: number; body: unknown }) {
  const posts: Post[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/rebaseline')) {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        const answer = rebaseline ?? { status: 200, body: {} };
        return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as unknown as Response;
      }
      if (url.endsWith('/aobprinter-hosts')) {
        return { ok: true, status: 200, json: async () => view } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }),
  );
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
  beginLogin.mockReset();
});

describe('the AOBPRINTER host twin', () => {
  it('shows_the_practice_page_read_only_and_rebaseline_outside_it', async () => {
    const posts = stubFetch({ hosts: [REGRESSED], secondHostReporting: false });
    render(<AobPrinterHostTwin practiceId={PRACTICE} />);

    // The practice's own page, inside the one disabled fieldset.
    expect(screen.getByTestId('view-only')).toBeTruthy();
    const regressed = await screen.findByTestId('aobprinter-state-regressed');
    const fieldset = document.querySelector('fieldset');
    expect(fieldset?.hasAttribute('disabled')).toBe(true);
    expect(fieldset?.contains(regressed)).toBe(true);

    // The operator's control, outside it — live, not inert.
    const panel = await screen.findByTestId('aobprinter-rebaseline-host-1');
    expect(fieldset?.contains(panel)).toBe(false);

    // The reasons are the content file's, in its order, with their labels.
    const select = screen.getByTestId('aobprinter-rebaseline-reason-host-1') as HTMLSelectElement;
    const offered = [...select.options].map((o) => o.value).filter(Boolean);
    expect(offered).toEqual([...AOBPRINTER_REBASELINE_REASON_KEYS]);
    expect([...select.options].find((o) => o.value === 'reinstalled')?.textContent).toBe(t.rebaseline.reasons.reinstalled);

    // No reason, no act.
    const button = screen.getByTestId('aobprinter-rebaseline-action-host-1') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'database_restored' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toMatch(/\/aobprinter-hosts\/host-1\/rebaseline$/);
    expect(posts[0].body).toEqual({ reasonCode: 'database_restored' });
    expect(await screen.findByTestId('aobprinter-rebaseline-done')).toBeTruthy();
  });

  it('offers_no_rebaseline_for_a_host_that_has_not_regressed', async () => {
    stubFetch({ hosts: [host()], secondHostReporting: false });
    render(<AobPrinterHostTwin practiceId={PRACTICE} />);

    await screen.findByTestId('aobprinter-state-healthy');
    expect(document.querySelector('[data-testid^="aobprinter-rebaseline"]')).toBeNull();
  });

  it('offers_no_rebaseline_for_a_retired_chain', async () => {
    const retired = host({ ...REGRESSED, id: 'host-2', chainId: 'deadbeef'.repeat(8), retiredAt: '2026-10-10T01:02:03.000Z' });
    stubFetch({ hosts: [retired, host()], secondHostReporting: false });
    render(<AobPrinterHostTwin practiceId={PRACTICE} />);

    await screen.findByTestId('aobprinter-retired-host-2');
    await screen.findByTestId('aobprinter-state-healthy');
    expect(document.querySelector('[data-testid^="aobprinter-rebaseline"]')).toBeNull();
  });

  it('a_stale_second_factor_gets_the_control_that_refreshes_it', async () => {
    stubFetch(
      { hosts: [REGRESSED], secondHostReporting: false },
      { status: 403, body: { message: 'refused', reasonCode: 'reauthentication_required' } },
    );
    render(<AobPrinterHostTwin practiceId={PRACTICE} />);

    const select = (await screen.findByTestId('aobprinter-rebaseline-reason-host-1')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'investigated' } });
    fireEvent.click(screen.getByTestId('aobprinter-rebaseline-action-host-1'));

    const stepUp = await screen.findByTestId('aobprinter-rebaseline-step-up');
    expect(stepUp.textContent).toContain(t.rebaseline.stepUpReauthenticate);
    fireEvent.click(screen.getByTestId('aobprinter-rebaseline-step-up-action'));
    expect(beginLogin).toHaveBeenCalledWith(undefined, { reauthenticate: true });
  });

  it('an_unrecorded_sign_in_method_is_refused_and_not_called_a_password', async () => {
    stubFetch(
      { hosts: [REGRESSED], secondHostReporting: false },
      { status: 403, body: { message: 'refused', reasonCode: 'sign_in_method_unrecorded' } },
    );
    render(<AobPrinterHostTwin practiceId={PRACTICE} />);

    const select = (await screen.findByTestId('aobprinter-rebaseline-reason-host-1')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'investigated' } });
    fireEvent.click(screen.getByTestId('aobprinter-rebaseline-action-host-1'));

    const stepUp = await screen.findByTestId('aobprinter-rebaseline-step-up');
    expect(stepUp.textContent).toContain(t.rebaseline.stepUpMethodUnrecorded);
    expect(stepUp.textContent).not.toContain(t.rebaseline.stepUpSecondFactorMissing);
    expect(screen.queryByTestId('aobprinter-rebaseline-step-up-action')).toBeNull();
    expect(screen.queryByTestId('aobprinter-rebaseline-unmapped')).toBeNull();
  });

  it('an_unmapped_refusal_code_shows_its_code', async () => {
    stubFetch(
      { hosts: [REGRESSED], secondHostReporting: false },
      { status: 409, body: { message: 'refused', reasonCode: 'host_moved_on' } },
    );
    render(<AobPrinterHostTwin practiceId={PRACTICE} />);

    const select = (await screen.findByTestId('aobprinter-rebaseline-reason-host-1')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'reinstalled' } });
    fireEvent.click(screen.getByTestId('aobprinter-rebaseline-action-host-1'));

    const unmapped = await screen.findByTestId('aobprinter-rebaseline-unmapped');
    expect(unmapped.textContent).toBe(t.rebaseline.stepUpUnmapped('host_moved_on'));
  });
});
