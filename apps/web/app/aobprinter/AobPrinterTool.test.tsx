/**
 * THE AOBPRINTER TEST TOOL'S "LOAD TEST AGREEMENTS" BUTTON.
 *
 * What it must do, each a property the button's own copy claims: ask core's
 * dev endpoint for the test patients, print ONE DB4 per patient through the
 * same `POST /inbound/print-jobs` door as Print to AoB with a distinct form
 * reference each, say how many were sent and placed from what core recorded,
 * and name a refusal by the reason core gave rather than a generic failure.
 *
 * NOT IN THE WEB VITEST INCLUDE LIST, like `presets.test.ts` beside it:
 * `vitest.config.ts` does not name app/aobprinter, and adding it is Carl's
 * call (CLAUDE.md §7a rule 6). Run with a config that widens `include`.
 *
 * Fake identities throughout (CLAUDE.md §7c).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AobPrinterTool } from './AobPrinterTool';
import { DEV_PRACTICE } from './presets';

const PATIENTS = [1, 2, 3, 4, 5].map((n) => ({
  patientRecordNumber: `DB4TEST-0${n}`,
  givenNames: `Given${n}`,
  familyName: `Fakefamily${n}`,
  dateOfBirth: '1970-01-01',
}));

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

function stubCore(opts: { refuse?: { status: number; body: unknown }; unplacedChart?: string } = {}) {
  const calls: Call[] = [];
  const chartOfJob = new Map<string, string>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body });
    if (url.endsWith('/inbound/print-jobs/recent')) return reply(200, []);
    if (url.endsWith('/dev/aobprinter-test-patients')) {
      if (opts.refuse) return reply(opts.refuse.status, opts.refuse.body);
      return reply(201, { created: 5, patients: PATIENTS, servicingProviderNumbers: ['9999999X'] });
    }
    if (url.endsWith('/inbound/print-jobs') && method === 'POST') {
      const id = `job-${chartOfJob.size + 1}`;
      chartOfJob.set(id, (body as { patient: { patientRecordNumber: string } }).patient.patientRecordNumber);
      return reply(202, { id, duplicate: false, lane: 'critical' });
    }
    const job = /\/inbound\/print-jobs\/(job-\d+)$/.exec(url);
    if (job) {
      const unplaced = chartOfJob.get(job[1]!) === opts.unplacedChart;
      return reply(200, {
        state: 'done',
        outcome: {
          db4: unplaced
            ? { placed: false, reason: 'unknown_chart_number', patientMatched: false }
            : { placed: true, reason: null, patientMatched: true, agreementId: `agr-${job[1]}` },
        },
      });
    }
    return reply(404, { message: 'not stubbed' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('Load test agreements', () => {
  it('posts one DB4 per test patient through /inbound/print-jobs, with distinct form references, and summarises the outcome', async () => {
    const { calls } = stubCore({ unplacedChart: 'DB4TEST-03' });
    render(<AobPrinterTool />);

    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));

    await waitFor(() => expect(screen.getByText(/Sent 5 of 5 to core; 4 placed an agreement\./)).toBeTruthy());

    const setup = calls.filter((c) => c.url.endsWith('/dev/aobprinter-test-patients'));
    expect(setup).toHaveLength(1);
    expect(setup[0]!.method).toBe('POST');
    expect(setup[0]!.headers['x-practice-id']).toBe(DEV_PRACTICE);

    const prints = calls.filter((c) => c.url.endsWith('/inbound/print-jobs') && c.method === 'POST');
    expect(prints).toHaveLength(PATIENTS.length);
    const envelopes = prints.map(
      (c) =>
        c.body as {
          sourceSha256: string;
          form: { formReference: string };
          patient: { patientRecordNumber: string };
          providers: Array<{ role: string; providerNumber: string }>;
        },
    );
    expect(envelopes.map((e) => e.patient.patientRecordNumber)).toEqual(PATIENTS.map((p) => p.patientRecordNumber));
    expect(new Set(envelopes.map((e) => e.form.formReference)).size).toBe(PATIENTS.length);
    expect(new Set(envelopes.map((e) => e.sourceSha256)).size).toBe(PATIENTS.length);
    for (const e of envelopes) {
      expect(e.providers.find((p) => p.role === 'servicing')?.providerNumber).toBe('9999999X');
    }
    for (const c of prints) expect(c.headers['x-practice-id']).toBe(DEV_PRACTICE);

    // The unplaced form is named with the reason core recorded, not a guess.
    expect(screen.getByText(/nothing was placed — unknown_chart_number\./)).toBeTruthy();
    // The picker is refreshed after the press, not only on mount.
    expect(calls.filter((c) => c.url.endsWith('/inbound/print-jobs/recent')).length).toBeGreaterThanOrEqual(2);
  });

  it('a second press loads fresh form references rather than reprinting the first batch', async () => {
    const { calls } = stubCore();
    render(<AobPrinterTool />);
    const button = screen.getByRole('button', { name: 'Load test agreements' });

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Sent 5 of 5 to core; 5 placed/)).toBeTruthy());
    // Date.now() is the stamp; make sure the second press sees a different one.
    await new Promise((r) => setTimeout(r, 5));
    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/inbound/print-jobs') && c.method === 'POST')).toHaveLength(10),
    );

    const refs = calls
      .filter((c) => c.url.endsWith('/inbound/print-jobs') && c.method === 'POST')
      .map((c) => (c.body as { form: { formReference: string } }).form.formReference);
    expect(new Set(refs).size).toBe(10);
  });

  it('names core’s refusal by its reason code and sends nothing', async () => {
    const { calls } = stubCore({
      refuse: {
        status: 409,
        body: {
          reason: 'no_active_affiliation_with_provider_number',
          message: 'This practice has no active affiliation with a provider number.',
        },
      },
    });
    render(<AobPrinterTool />);

    fireEvent.click(screen.getByRole('button', { name: 'Load test agreements' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          /HTTP 409, no_active_affiliation_with_provider_number\): This practice has no active affiliation with a provider number\. Nothing was sent\./,
        ),
      ).toBeTruthy(),
    );
    expect(calls.filter((c) => c.url.endsWith('/inbound/print-jobs') && c.method === 'POST')).toHaveLength(0);
  });
});
