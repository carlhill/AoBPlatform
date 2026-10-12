/**
 * `/practice/aobprinter-host` — the practice's own AOBPRINTER host
 * (PRINTER-HEARTBEAT.md §4–§5, D-2026-10-10-02).
 *
 * What these guard: every state says what the platform observed, worst first;
 * a remedy appears only where it is true for that record (CLAUDE.md §7c,
 * wow.md §13); an unmapped code shows its code; a practice never sees the
 * Re-baseline control (decision 7); and the page carries the back link and
 * the top-bar refresh every console page carries (wow.md §2 item 3).
 *
 * `GET /aobprinter-hosts` is mocked: the core endpoint is built alongside.
 * Hashes and ids are fixed literals, never random, so a text assertion
 * cannot be hit by chance (wow.md §2 item 6).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type {
  AobPrinterHostRow,
  AobPrinterHostsView,
  AobPrinterStageCounts,
} from '@aobplatform/contracts';
import { AobPrinterHostView } from './AobPrinterHostView';
import { deviceSeenAgo } from '../deviceActivity';
import { strings } from '../../strings';

const PRACTICE = '821709fb-7f89-4fcf-95c0-27c5eb55cec8';
const PATIENT = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AGREEMENT = '0a1b2c3d-4e5f-4a6b-8c7d-111111111111';

const CHAIN = 'c0ffee00'.repeat(8);
const PREVIOUS_CHAIN = 'deadbeef'.repeat(8);
const HASH_A = 'abcdef01'.repeat(8);
const HASH_B = '12345678'.repeat(8);
const PRINT_HASH = 'feedface'.repeat(8);

const t = strings.aobprinterHost;

let pathname = '/practice/aobprinter-host';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: [], practiceId: PRACTICE, consoleRole: 'admin' }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
  beginLogin: vi.fn(),
}));

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function counts(over: Partial<AobPrinterStageCounts> = {}): AobPrinterStageCounts {
  return {
    prints: { received: 1, parse_exception: 0, queued: 3, sent: 27, send_exception: 0 },
    returns: { received: 0, received_exception: 0, filed: 2, filing_exception: 0, confirmed: 19 },
    openExceptions: { parse: 0, send: 0, received: 0, filing: 0 },
    oldestQueuedAt: null,
    oldestFiledUnconfirmedAt: null,
    staleQueued: 0,
    gapsLast24h: 0,
    ...over,
  };
}

function host(over: Partial<AobPrinterHostRow> = {}): AobPrinterHostRow {
  return {
    id: 'host-1',
    practiceId: PRACTICE,
    chainId: CHAIN,
    lastSeenAt: ago(20_000),
    hostSentAt: ago(20_000),
    intervalMs: 60_000,
    printerVersion: '1.4.2',
    templateVersion: 'db4-2026-09-2',
    schemaVersion: 7,
    runtimeVersion: 'v20.17.0',
    startedAt: '2026-10-09T21:00:00.000Z',
    collecting: true,
    retentionEnabled: false,
    queueCount: 0,
    counts: counts(),
    localCheck: { ok: true, verifiedThroughSeq: 1200 },
    head: { seq: 1234, hash: HASH_A },
    headAdvancedAt: ago(60_000),
    vaultAnchoredAt: null,
    rebaselinedAt: null,
    rebaselinedBy: null,
    retiredAt: null,
    liveness: 'live',
    chain: { status: 'consistent', regression: null, anchorSeq: 1234, anchorVerifiedAt: ago(20_000) },
    clockSkewMs: 1_500,
    exceptions: [],
    filedUnconfirmed: [],
    ...over,
  };
}

let fetchCalls = 0;
function stubHosts(view: AobPrinterHostsView) {
  fetchCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/aobprinter-hosts')) {
        fetchCalls += 1;
        return { ok: true, status: 200, json: async () => view } as unknown as Response;
      }
      // The menu's surface-profile read and anything else: refused, which the
      // console treats as "use the default" rather than as a failure.
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  pathname = '/practice/aobprinter-host';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the AOBPRINTER host page', () => {
  it('shows_last_seen_versions_and_stage_counts_for_a_healthy_host', async () => {
    const row = host();
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const healthy = await screen.findByTestId('aobprinter-state-healthy');
    expect(healthy.textContent).toContain(t.healthy(deviceSeenAgo(row.lastSeenAt)));

    // Healthy is the ONLY state: nothing else is claimed about this host.
    expect(document.querySelectorAll('[data-testid^="aobprinter-state-"]')).toHaveLength(1);

    // Versions and runtime.
    expect(screen.getByTestId('aobprinter-version-printer').textContent).toBe('1.4.2');
    expect(screen.getByTestId('aobprinter-version-template').textContent).toBe('db4-2026-09-2');
    expect(screen.getByTestId('aobprinter-version-schema').textContent).toBe('7');
    expect(screen.getByTestId('aobprinter-version-runtime').textContent).toBe('v20.17.0');

    // The stage table, every stage in both directions.
    expect(screen.getByTestId('aobprinter-stage-prints-queued').textContent).toBe('3');
    expect(screen.getByTestId('aobprinter-stage-prints-sent').textContent).toBe('27');
    expect(screen.getByTestId('aobprinter-stage-returns-filed').textContent).toBe('2');
    expect(screen.getByTestId('aobprinter-stage-returns-confirmed').textContent).toBe('19');

    // The chain head and the anchor.
    expect(screen.getByTestId('aobprinter-chain-head').textContent).toBe(t.chainHead(t.point(1234, 'abcdef01')));
    expect(screen.getByTestId('aobprinter-chain-anchor').textContent).toContain('1234');
  });

  it('a_stale_host_says_when_it_was_last_heard_from', async () => {
    const row = host({ liveness: 'stale', lastSeenAt: ago(4 * 60_000) });
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const stale = await screen.findByTestId('aobprinter-state-stale');
    expect(stale.textContent).toContain(t.staleTitle);
    expect(stale.textContent).toContain(`(${deviceSeenAgo(row.lastSeenAt)} ago)`);
    expect(screen.queryByTestId('aobprinter-state-healthy')).toBeNull();
    expect(screen.queryByTestId('aobprinter-state-offline')).toBeNull();
  });

  it('an_offline_host_keeps_its_last_report_with_its_age', async () => {
    const row = host({ liveness: 'offline', lastSeenAt: ago(2 * 60 * 60_000) });
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const offline = await screen.findByTestId('aobprinter-state-offline');
    const age = deviceSeenAgo(row.lastSeenAt);
    expect(offline.textContent).toContain(`(${age} ago)`);

    // The last report is still on screen, headed with its age.
    const report = screen.getByTestId('aobprinter-report-host-1');
    expect(report.textContent).toContain(t.reportTitle(age));
    expect(screen.getByTestId('aobprinter-version-printer').textContent).toBe('1.4.2');
    expect(screen.getByTestId('aobprinter-stage-prints-sent').textContent).toBe('27');
  });

  it('a_regression_names_the_expected_and_received_sequence_and_hash', async () => {
    const row = host({
      chain: {
        status: 'regressed',
        regression: {
          kind: 'same_seq_different_hash',
          at: '2026-10-10T01:02:03.000Z',
          expected: { seq: 42, hash: HASH_A },
          received: { seq: 42, hash: HASH_B },
        },
        anchorSeq: 40,
        anchorVerifiedAt: null,
      },
    });
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const regressed = await screen.findByTestId('aobprinter-state-regressed');
    expect(regressed.textContent).toContain(t.regressedTitle);
    expect(regressed.textContent).toContain(t.point(42, 'abcdef01'));
    expect(regressed.textContent).toContain(t.point(42, '12345678'));
    expect(regressed.textContent).toContain(t.regressedStays);

    // Regressed is worst, so it is first.
    const states = [...document.querySelectorAll('[data-testid^="aobprinter-state-"]')];
    expect(states[0].getAttribute('data-testid')).toBe('aobprinter-state-regressed');

    // A practice never re-baselines its own host (decision 7).
    expect(screen.queryByText(t.rebaseline.action)).toBeNull();
    expect(document.querySelector('[data-testid^="aobprinter-rebaseline"]')).toBeNull();
  });

  it('a_replaced_chain_says_so_and_names_the_previous_one', async () => {
    const row = host({
      chain: {
        status: 'regressed',
        regression: {
          kind: 'chain_replaced',
          at: '2026-10-10T01:02:03.000Z',
          expected: { seq: 1, hash: PREVIOUS_CHAIN },
          received: { seq: 1, hash: CHAIN },
        },
        anchorSeq: 1234,
        anchorVerifiedAt: null,
      },
    });
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const regressed = await screen.findByTestId('aobprinter-state-regressed');
    // The previous audit log, named by its first event's hash, and the new one.
    expect(regressed.textContent).toContain(`already has an audit log starting at ${t.point(1, 'deadbeef')}`);
    expect(regressed.textContent).toContain(`never seen, starting at ${t.point(1, 'c0ffee00')}`);
  });

  it('a_replaced_chain_beside_a_rebaselined_one_says_no_replacement_was_accepted', async () => {
    // The previous chain WAS re-baselined (it accepted its own head) but was never retired.
    const previous = host({ id: 'host-2', chainId: PREVIOUS_CHAIN, rebaselinedAt: '2026-10-09T22:00:00.000Z', rebaselinedBy: 'operator-1' });
    const replacement = host({
      chain: {
        status: 'regressed',
        regression: {
          kind: 'chain_replaced',
          at: '2026-10-10T01:02:03.000Z',
          expected: { seq: 1, hash: PREVIOUS_CHAIN },
          received: { seq: 1, hash: CHAIN },
        },
        anchorSeq: 1234,
        anchorVerifiedAt: null,
      },
    });
    stubHosts({ hosts: [replacement, previous], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const regressed = await screen.findByTestId('aobprinter-state-regressed');
    // What was observed: the other log has not been retired, i.e. no replacement has been accepted.
    expect(regressed.textContent).toContain('has not been retired');
    expect(regressed.textContent).toContain('no replacement has been accepted');
    // Not a claim about re-baselining, which here would be false.
    expect(regressed.textContent).not.toContain('re-baselined.');
    expect(regressed.textContent).not.toContain('has not been re-baselined');
  });

  it('two_hosts_reporting_is_its_own_state', async () => {
    const first = host();
    const second = host({ id: 'host-2', chainId: PREVIOUS_CHAIN });
    stubHosts({ hosts: [first, second], secondHostReporting: true });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const both = await screen.findByTestId('aobprinter-state-second_host');
    expect(both.textContent).toContain(t.secondHostTitle);
    expect(both.textContent).toContain(t.secondHostBody(15));

    // Each host keeps its own card, and the page-level state comes before both.
    const cards = screen.getAllByTestId(/^aobprinter-host-host-/);
    expect(cards).toHaveLength(2);
    expect(both.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a_filed_but_unrecorded_return_links_to_its_patient', async () => {
    const row = host({
      filedUnconfirmed: [
        { agreementId: AGREEMENT, sha256: HASH_B, verdict: 'offered', patientId: PATIENT },
      ],
      exceptions: [
        {
          direction: 'out',
          stage: 'parse_exception',
          reason: 'no_text_layer',
          since: '2026-10-10T00:00:00.000Z',
          sourceSha256: PRINT_HASH,
        },
        {
          direction: 'in',
          stage: 'filing_exception',
          reason: 'write_failed',
          since: '2026-10-10T00:05:00.000Z',
          agreementId: AGREEMENT,
          patientId: PATIENT,
        },
      ],
    });
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const filed = await screen.findByTestId('aobprinter-state-filed_unconfirmed');
    expect(filed.textContent).toContain(t.filed.offered);
    const filedLink = filed.querySelector('a');
    expect(filedLink?.getAttribute('href')).toBe(`/practice/patients/${PATIENT}`);

    // A return exception links to its patient too.
    const exceptions = screen.getByTestId('aobprinter-state-open_exceptions');
    const returnLink = exceptions.querySelector(`a[href="/practice/patients/${PATIENT}"]`);
    expect(returnLink?.textContent).toBe(t.returnOpenPatient);

    // A print exception has no page to link to: its code and hash prefix, held on the host.
    const print = screen.getByTestId('aobprinter-exception-0');
    expect(print.textContent).toContain('no_text_layer');
    expect(print.textContent).toContain(t.printHeld('feedface'));
    expect(print.querySelector('a')).toBeNull();
  });

  it('a_return_written_back_as_a_different_file_says_so_and_promises_no_confirmation', async () => {
    const row = host({
      filedUnconfirmed: [
        { agreementId: AGREEMENT, sha256: HASH_B, verdict: 'written_back_different_file', patientId: PATIENT },
      ],
    });
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const filed = await screen.findByTestId('aobprinter-state-filed_unconfirmed');
    expect(filed.textContent).toContain(t.filed.written_back_different_file);
    // The host keeps a return filed when the hashes differ, so "confirmed on its next report" would be false here.
    expect(filed.textContent).not.toContain(t.filed.written_back);
    expect(filed.textContent).not.toContain('next report');
    expect(filed.querySelector('a')?.getAttribute('href')).toBe(`/practice/patients/${PATIENT}`);
  });

  it('a_retired_chain_is_a_quiet_line_not_a_not_reporting_card', async () => {
    const accepted = host();
    const retired = host({
      id: 'host-2',
      chainId: PREVIOUS_CHAIN,
      liveness: 'offline',
      lastSeenAt: ago(3 * 60 * 60_000),
      retiredAt: '2026-10-10T01:02:03.000Z',
    });
    stubHosts({ hosts: [retired, accepted], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const line = await screen.findByTestId('aobprinter-retired-host-2');
    expect(line.textContent).toBe(t.retired('deadbeef', new Date('2026-10-10T01:02:03.000Z').toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })));
    // Not a card, and not "Not reporting": its silence is expected.
    expect(screen.queryByTestId('aobprinter-host-host-2')).toBeNull();
    expect(screen.queryByTestId('aobprinter-state-offline')).toBeNull();
    expect(screen.queryByText(t.liveness.offline)).toBeNull();
    // The accepted chain keeps its card.
    expect(screen.getByTestId('aobprinter-host-host-1')).toBeTruthy();
    expect(screen.getByTestId('aobprinter-state-healthy')).toBeTruthy();
  });

  it('an_unmapped_reason_code_shows_its_code', async () => {
    const row = host({
      chain: {
        status: 'regressed',
        regression: {
          // A kind this build has never met.
          kind: 'went_sideways' as never,
          at: '2026-10-10T01:02:03.000Z',
          expected: { seq: 5, hash: HASH_A },
          received: { seq: 6, hash: HASH_B },
        },
        anchorSeq: 5,
        anchorVerifiedAt: null,
      },
      exceptions: [
        {
          direction: 'out',
          stage: 'send_exception',
          reason: 'printer_on_fire',
          since: '2026-10-10T00:00:00.000Z',
          sourceSha256: PRINT_HASH,
        },
      ],
    });
    stubHosts({ hosts: [row], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const regressed = await screen.findByTestId('aobprinter-state-regressed');
    expect(regressed.textContent).toContain('went_sideways');
    expect(screen.getByTestId('aobprinter-exception-0').textContent).toContain('printer_on_fire');
  });

  it('no_host_ever_reported_does_not_read_as_an_outage', async () => {
    stubHosts({ hosts: [], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    const never = await screen.findByTestId('aobprinter-state-never_reported');
    expect(never.textContent).toContain(t.neverTitle);
    expect(never.textContent).toContain(t.never);
    // Neutral: not an alert, and no outage words.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('aobprinter-state-offline')).toBeNull();
    expect(screen.queryByText(t.offlineTitle)).toBeNull();
  });

  it('registers_refresh_and_back_link', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubHosts({ hosts: [host()], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} />);

    await screen.findByTestId('aobprinter-state-healthy');
    expect(screen.getByTestId('shell-back').getAttribute('href')).toBe('/practice/setup');
    expect(screen.getByTestId('shell-refresh')).toBeTruthy();

    // And it re-reads itself every 30 s while open.
    const before = fetchCalls;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(fetchCalls).toBe(before + 1));
  });

  it('pauses_its_poll_while_busy', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubHosts({ hosts: [host()], secondHostReporting: false });
    render(<AobPrinterHostView practiceId={PRACTICE} paused />);

    await screen.findByTestId('aobprinter-state-healthy');
    const before = fetchCalls;
    await act(async () => {
      vi.advanceTimersByTime(65_000);
    });
    expect(fetchCalls).toBe(before);
  });
});
