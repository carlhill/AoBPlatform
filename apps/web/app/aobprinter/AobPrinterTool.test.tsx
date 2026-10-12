/**
 * THE AOBPRINTER TEST TOOL'S "LOAD TEST AGREEMENTS" BUTTON.
 *
 * What it must do, each a property the button's own copy claims: make sure
 * each patient is on file the way `scripts/dev/db4-round-trip.sh` does (search
 * first, `POST /arrivals` with a fixed idempotency key only when missing),
 * print ONE DB4 per patient through the same `POST /inbound/print-jobs` door
 * as Print to AoB with a distinct form reference each, say how many were sent
 * and placed from what core recorded, and name a refusal by what core said —
 * with the script's fix only where that fix is true (wow.md §13).
 *
 * In the web Vitest include list since 12 October 2026, so CI runs it.
 *
 * Fake identities throughout (CLAUDE.md §7c).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AobPrinterTool } from './AobPrinterTool';
import { DEV_PRACTICE, PRESETS } from './presets';

const CHARTS = ['09911', 'DEV-RILEY-EXAMPLE', 'DEV-ALEX-FICTIONAL', 'DEV-KIM-SPECIMEN', 'DEV-NOOR-ILLUSTRATIVE'];

function reply(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

interface StubOptions {
  /** Charts already on file before the press. */
  onFile?: string[];
  /** What POST /arrivals answers instead of mirroring the patient. */
  arrivalRefusal?: { status: number; body: unknown };
  /** A chart whose DB4 places nothing, with this reason. */
  unplaced?: { chart: string; reason: string };
  /** A chart whose job cannot be read back. */
  unreadableChart?: string;
  /** POST /arrivals never answers: the connection drops. */
  arrivalUnreachable?: boolean;
  /** The search AFTER an arrival fails with this status (the arrival itself succeeds). */
  recheckFailsWith?: number;
}

function stubCore(opts: StubOptions = {}) {
  const calls: Call[] = [];
  const onFile = new Set(opts.onFile ?? []);
  const chartOfJob = new Map<string, string>();
  const arrived = new Set<string>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body });
    if (url.endsWith('/inbound/print-jobs/recent')) return reply(200, []);
    const search = /\/patients\/search\?q=([^&]+)$/.exec(url);
    if (search) {
      const chart = decodeURIComponent(search[1]!);
      if (opts.recheckFailsWith && arrived.has(chart)) return reply(opts.recheckFailsWith, { message: 'search broke' });
      return reply(200, onFile.has(chart) ? [{ id: `p-${chart}`, patientRecordNumber: chart }] : []);
    }
    if (url.endsWith('/arrivals') && method === 'POST') {
      if (opts.arrivalUnreachable) throw new TypeError('Failed to fetch');
      if (opts.arrivalRefusal) return reply(opts.arrivalRefusal.status, opts.arrivalRefusal.body);
      arrived.add((body as { pmsPatientRecordNumber: string }).pmsPatientRecordNumber);
      onFile.add((body as { pmsPatientRecordNumber: string }).pmsPatientRecordNumber);
      return reply(201, { arrivalId: 'a-1' });
    }
    if (url.endsWith('/inbound/print-jobs') && method === 'POST') {
      const id = `job-${chartOfJob.size + 1}`;
      chartOfJob.set(id, (body as { patient: { patientRecordNumber: string } }).patient.patientRecordNumber);
      return reply(202, { id, duplicate: false, lane: 'critical' });
    }
    const job = /\/inbound\/print-jobs\/(job-\d+)$/.exec(url);
    if (job) {
      const chart = chartOfJob.get(job[1]!);
      if (chart === opts.unreadableChart) return reply(500, { message: 'boom' });
      const unplaced = chart === opts.unplaced?.chart;
      return reply(200, {
        state: 'done',
        outcome: {
          db4: unplaced
            ? { placed: false, reason: opts.unplaced!.reason, patientMatched: true }
            : { placed: true, reason: null, patientMatched: true, agreementId: `agr-${job[1]}` },
        },
      });
    }
    return reply(404, { message: 'not stubbed' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

const printsOf = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/inbound/print-jobs') && c.method === 'POST');
const arrivalsOf = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/arrivals') && c.method === 'POST');

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('Load test agreements', () => {
  it('mirrors only the missing patients through /arrivals, then posts one DB4 per patient with distinct form references', async () => {
    const { calls } = stubCore({ onFile: ['09911'], unplaced: { chart: 'DEV-ALEX-FICTIONAL', reason: 'already_covered' } });
    render(<AobPrinterTool />);

    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));

    await waitFor(() => expect(screen.getByText(/Sent 5 of 5 to core; 4 placed an agreement\./)).toBeTruthy());

    // Search first, for every chart, with the tool's practice.
    const searches = calls.filter((c) => c.url.includes('/patients/search?q='));
    expect(searches.length).toBeGreaterThanOrEqual(CHARTS.length);
    for (const c of searches) expect(c.headers['x-practice-id']).toBe(DEV_PRACTICE);

    // Arrivals only for the four not on file, each with a fixed key and the presets' provider number.
    const arrivals = arrivalsOf(calls).map(
      (c) => c.body as { pmsPatientRecordNumber: string; idempotencyKey: string; providerNumber: string },
    );
    expect(arrivals.map((a) => a.pmsPatientRecordNumber)).toEqual(CHARTS.slice(1));
    for (const a of arrivals) {
      expect(a.idempotencyKey).toBe(`dev-aobprinter-tool-${a.pmsPatientRecordNumber}`);
      expect(a.providerNumber).toBe('9999999X');
      expect(Object.keys(a)).not.toEqual(expect.arrayContaining(['mobile', 'email']));
    }

    const envelopes = printsOf(calls).map(
      (c) =>
        c.body as {
          sourceSha256: string;
          form: { formReference: string };
          patient: { patientRecordNumber: string };
          providers: Array<{ role: string; providerNumber: string }>;
        },
    );
    expect(envelopes.map((e) => e.patient.patientRecordNumber)).toEqual(CHARTS);
    expect(new Set(envelopes.map((e) => e.form.formReference)).size).toBe(CHARTS.length);
    expect(new Set(envelopes.map((e) => e.sourceSha256)).size).toBe(CHARTS.length);
    for (const e of envelopes) {
      expect(e.providers.find((p) => p.role === 'servicing')?.providerNumber).toBe('9999999X');
    }
    for (const c of printsOf(calls)) expect(c.headers['x-practice-id']).toBe(DEV_PRACTICE);

    // The unplaced form is named with the reason core recorded, not a guess.
    expect(screen.getByText(/nothing was placed — already_covered\./)).toBeTruthy();
    expect(screen.getByText(/Mirrored through POST \/arrivals first: Riley Example, Alex Fictional/)).toBeTruthy();
    // No provider fix under a reason that is not about the provider.
    expect(screen.queryByText(/db4-round-trip\.sh creates it/)).toBeNull();
    // The picker is refreshed after the press, not only on mount.
    expect(calls.filter((c) => c.url.endsWith('/inbound/print-jobs/recent')).length).toBeGreaterThanOrEqual(2);
  });

  it('a second press finds every patient, sends no arrival, and loads fresh form references', async () => {
    const { calls } = stubCore();
    render(<AobPrinterTool />);

    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));
    await waitFor(() => expect(screen.getByText(/Sent 5 of 5 to core; 5 placed/)).toBeTruthy());
    expect(arrivalsOf(calls)).toHaveLength(5);
    // Date.now() is the stamp; make sure the second press sees a different one.
    await new Promise((r) => setTimeout(r, 5));
    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));
    await waitFor(() => expect(printsOf(calls)).toHaveLength(10));
    await waitFor(() => expect(screen.getByText(/All five patients were already on file\./)).toBeTruthy());

    expect(arrivalsOf(calls)).toHaveLength(5);
    const refs = printsOf(calls).map((c) => (c.body as { form: { formReference: string } }).form.formReference);
    expect(new Set(refs).size).toBe(10);
  });

  it('when POST /arrivals cannot resolve 9999999X, it says so with the script’s fix and sends nothing', async () => {
    const { calls } = stubCore({
      arrivalRefusal: { status: 404, body: { message: 'No practitioner at this practice holds that provider number.' } },
    });
    render(<AobPrinterTool />);

    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          /Testalina Fakesurname \(09911\) is not on file and POST \/arrivals did not create them \(HTTP 404: No practitioner at this practice holds that provider number\.\)\. Nothing was sent\. No affiliation at this practice resolves servicing provider number 9999999X\. The seed step of bash scripts\/dev\/db4-round-trip\.sh creates it/,
        ),
      ).toBeTruthy(),
    );
    expect(printsOf(calls)).toHaveLength(0);
  });

  it('any other arrival refusal is said back as core said it, with no provider fix', async () => {
    const { calls } = stubCore({
      arrivalRefusal: { status: 422, body: { reason: 'provider_not_servicing', message: 'Not a servicing role.' } },
    });
    render(<AobPrinterTool />);

    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));

    await waitFor(() =>
      expect(screen.getByText(/HTTP 422: provider_not_servicing: Not a servicing role\.\)\. Nothing was sent\.$/)).toBeTruthy(),
    );
    // The help text names the script too; the FIX sentence is what must be absent.
    expect(screen.queryByText(/db4-round-trip\.sh creates it/)).toBeNull();
    expect(printsOf(calls)).toHaveLength(0);
  });

  it('a DB4 refused as provider_not_found shows the script’s fix under the summary', async () => {
    stubCore({ onFile: CHARTS, unplaced: { chart: '09911', reason: 'provider_not_found' } });
    render(<AobPrinterTool />);

    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          /^provider_not_found: no affiliation at this practice resolves servicing provider number 9999999X\. The seed step of bash scripts\/dev\/db4-round-trip\.sh/,
        ),
      ).toBeTruthy(),
    );
  });

  it('a job the tool could not read back says so, rather than blaming core for not finishing', async () => {
    stubCore({ onFile: CHARTS, unreadableChart: 'DEV-RILEY-EXAMPLE' });
    render(<AobPrinterTool />);
    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));
    await waitFor(
      () => expect(screen.getByText(/the tool could not read this job back from core \(HTTP 500\)/)).toBeTruthy(),
      { timeout: 15_000 },
    );
    expect(screen.queryByText(/core had not finished/)).toBeNull();
  }, 20_000);
});

describe('Load test agreements: says only what it observed (review, wow.md 13)', () => {
  it('a dropped connection on the arrival says core could not be reached, and sends nothing', async () => {
    const { calls } = stubCore({ arrivalUnreachable: true });
    render(<AobPrinterTool />);
    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));
    await waitFor(() => expect(screen.getByText(/Could not reach core/)).toBeTruthy());
    expect(screen.getByText(/Nothing was sent\./)).toBeTruthy();
    expect(printsOf(calls)).toHaveLength(0);
  });

  it('a failed re-check says the re-check failed, never that the arrival did not create the patient', async () => {
    const { calls } = stubCore({ recheckFailsWith: 500 });
    render(<AobPrinterTool />);
    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));
    await waitFor(() => expect(screen.getByText(/could not check whether/)).toBeTruthy());
    expect(screen.queryByText(/did not create them/)).toBeNull();
    expect(screen.queryByText(/No affiliation/)).toBeNull();
    expect(printsOf(calls)).toHaveLength(0);
  });
});

describe('Load test agreements: the check cases are ready to print, never sent (Carl, 12 Oct 2026)', () => {
  it('lists every other preset after a press, and choosing one fills the form without sending it', async () => {
    const { calls } = stubCore({ onFile: CHARTS });
    render(<AobPrinterTool />);
    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));
    await waitFor(() => expect(screen.getByText(/Sent 5 of 5 to core; 5 placed/)).toBeTruthy());

    const list = screen.getByTestId('check-cases');
    const sent = ['clean', 'ragged-amounts', 'long-form', 'no-amount', 'no-irn'];
    const checks = PRESETS.filter((p) => !sent.includes(p.key));
    expect(checks.length).toBeGreaterThan(0);
    for (const p of checks) expect(within(list).getByText(p.label)).toBeTruthy();
    // Only the five agreements went to core.
    expect(printsOf(calls)).toHaveLength(5);

    const pick = checks.find((p) => p.key === 'no-provider-name') ?? checks[0]!;
    fireEvent.click(within(list).getByText(pick.label));
    await waitFor(() =>
      expect((screen.getByLabelText('Form reference') as HTMLInputElement).value).toMatch(/^CHECK-/),
    );
    expect((screen.getByLabelText('PMS patient ID') as HTMLInputElement).value).toBe('09911');
    // Still nothing more sent: the tester presses Print to AoB.
    expect(printsOf(calls)).toHaveLength(5);
  });
});
