/**
 * The practitioner's Telehealth panel (TELEHEALTH-PLAN.md §3 steps 2–8, §4).
 * Fixtures are obviously fake; the contact arrives masked, as core sends it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TELEHEALTH_NOT_DONE_REASON_KEYS } from '@aobplatform/domain';
import { TelehealthPanel, isWaiting, mobileEnding } from './TelehealthPanel';
import { strings } from '../../../strings';

const p = strings.telehealth.panel;
const PATIENT = { patientId: 'p-1', givenNames: 'Testy', familyName: 'Telehealthson', dateOfBirth: '1980-01-01', patientRecordNumber: 'PRN-0001' };
const RECORD = {
  givenNames: 'Testy',
  familyName: 'Telehealthson',
  dateOfBirth: '1980-01-01',
  gender: null,
  address: '1 Example Street, Faketown',
  patientRecordNumber: 'PRN-0001',
  ihi: null,
  mobile: '0400 000 412',
  email: null,
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/practice/practitioner/telehealth',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../../../auth', () => ({
  currentSession: () => ({ roles: ['provider'], practitionerId: 'practitioner-1' }),
  apiHeaders: () => ({}),
  silentRestoreUnresolved: () => null,
}));
vi.mock('../../usePractice', () => ({
  usePractice: () => ({ practiceId: null, checked: true, scoped: false }),
}));

let enabled = true;
let sessions: unknown[] = [];
/** When set, POST /telehealth/sessions refuses with this message. */
let sendRefusal: string | null = null;
const calls: { url: string; method: string; body?: unknown }[] = [];

function session(state: string, extra: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    consultationId: 'TH-AB12-CD34',
    patientId: 'p-1',
    patientName: 'Testy Telehealthson',
    state,
    channel: 'sms',
    identifierTypes: ['name', 'date_of_birth', 'address'],
    consenterIsPatient: true,
    codeExpiresAt: null,
    codeLocked: false,
    codeAttemptsLeft: 5,
    linkSentCount: 1,
    codeCheckedAt: null,
    agreedAt: null,
    notDoneReason: null,
    notDoneNote: null,
    consultationAt: null,
    outcomeRecordedAt: null,
    createdAt: '2026-10-12T00:00:00.000Z',
    contentVersion: 'telehealth-test',
    ...extra,
  };
}

beforeEach(() => {
  enabled = true;
  sessions = [];
  sendRefusal = null;
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const reply = (status: number, body: unknown) =>
        ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
      if (url.endsWith('/telehealth/enabled')) return reply(200, { enabled });
      if (url.includes('/telehealth/patients?q=')) return reply(200, [PATIENT]);
      if (url.endsWith('/contact')) return reply(200, { patientId: 'p-1', maskedMobile: '•••••• 412', maskedEmail: null, record: RECORD });
      if (url.endsWith('/telehealth/sessions') && method === 'POST') {
        if (sendRefusal) return reply(400, { message: sendRefusal });
        sessions = [session('opened')];
        return reply(201, { session: sessions[0], code: '042917', codeExpiresAt: '2026-10-12T00:10:00.000Z', queued: ['sms'] });
      }
      if (url.endsWith('/telehealth/sessions')) return reply(200, sessions);
      if (url.endsWith('/not-done')) {
        sessions = [session('not_done', { notDoneReason: 'emergency', outcomeRecordedAt: '2026-10-12T00:05:00.000Z' })];
        return reply(201, sessions[0]);
      }
      return reply(404, { message: 'not stubbed' });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function choosePatient() {
  render(<TelehealthPanel />);
  fireEvent.change(await screen.findByTestId('telehealth-search'), { target: { value: 'Telehealthson' } });
  fireEvent.submit(screen.getByTestId('telehealth-search').closest('form')!);
  fireEvent.click(await screen.findByTestId('telehealth-choose-p-1'));
  await screen.findByTestId('telehealth-mobile');
}

describe('TelehealthPanel', () => {
  it('says plainly when telehealth is not switched on', async () => {
    enabled = false;
    render(<TelehealthPanel />);
    expect((await screen.findByTestId('telehealth-not-enabled')).textContent).toContain(p.notEnabledBody);
  });

  it('medicare_number_not_on_the_telehealth_checklist (on the panel)', async () => {
    await choosePatient();
    const boxes = Array.from(document.querySelectorAll('[data-testid^="telehealth-type-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(boxes).toEqual([
      'telehealth-type-name',
      'telehealth-type-date_of_birth',
      'telehealth-type-gender',
      'telehealth-type-address',
      'telehealth-type-patient_record_number',
      'telehealth-type-ihi',
    ]);
    expect(document.body.textContent ?? '').not.toMatch(/medicare/i);
  });

  it('reads back the masked contact, sends types only, and shows the code once', async () => {
    await choosePatient();
    expect(screen.getByTestId('telehealth-mobile').textContent).toContain('0400 000 412');
    const send = screen.getByTestId('telehealth-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    for (const type of ['name', 'date_of_birth', 'address']) fireEvent.click(screen.getByTestId(`telehealth-type-${type}`));
    fireEvent.click(screen.getByTestId('telehealth-who-patient'));
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);

    expect((await screen.findByTestId('telehealth-code')).textContent).toBe('0 4 2 9 1 7');
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/telehealth/sessions'))!;
    // telehealth_identifier_types_never_values: the body carries kinds of identifier and no contact.
    expect(post.body).toEqual({
      patientId: 'p-1',
      identifierTypes: ['name', 'date_of_birth', 'address'],
      channel: 'sms',
      consenterIsPatient: true,
    });
    expect(await screen.findByTestId('telehealth-status-s-1')).toBeTruthy();
    expect(screen.getByTestId('telehealth-status-s-1').textContent).toBe(p.status.opened);
  });

  it('marks the chosen patient, folds the list away, and "Choose someone else" brings it back', async () => {
    await choosePatient();
    expect(screen.getByTestId('telehealth-chosen').textContent).toContain(p.chosen);
    expect(screen.queryByTestId('telehealth-choose-p-1')).toBeNull();

    fireEvent.click(screen.getByTestId('telehealth-choose-again'));
    expect(await screen.findByTestId('telehealth-choose-p-1')).toBeTruthy();
    expect(screen.queryByTestId('telehealth-chosen')).toBeNull();
    // Nothing of the last patient survives, least of all the contact.
    expect(screen.queryByTestId('telehealth-mobile')).toBeNull();
  });

  it('shows the record in full beside each tick, says when a detail is not on the record, and the hit carries the record number', async () => {
    render(<TelehealthPanel />);
    fireEvent.change(await screen.findByTestId('telehealth-search'), { target: { value: 'Telehealthson' } });
    fireEvent.submit(screen.getByTestId('telehealth-search').closest('form')!);
    expect((await screen.findByTestId('telehealth-choose-p-1')).textContent).toContain('PRN-0001');
    fireEvent.click(screen.getByTestId('telehealth-choose-p-1'));
    await screen.findByTestId('telehealth-mobile');
    expect(screen.getByTestId('telehealth-record-name').textContent).toBe('Testy Telehealthson');
    expect(screen.getByTestId('telehealth-record-date_of_birth').textContent).toBe('1980-01-01');
    expect(screen.getByTestId('telehealth-record-address').textContent).toBe('1 Example Street, Faketown');
    expect(screen.getByTestId('telehealth-record-gender').textContent).toBe(p.recordNone);
    expect(screen.queryByTestId('telehealth-email')).toBeNull();
    // Shown, never sent: the POST still carries kinds only (see the send test).
  });

  it('"Start new telehealth consultation" gives a clean form, search box included', async () => {
    await choosePatient();
    fireEvent.click(screen.getByTestId('telehealth-type-name'));
    fireEvent.click(screen.getByTestId('telehealth-start-new'));
    expect((screen.getByTestId('telehealth-search') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('telehealth-chosen')).toBeNull();
    expect(screen.queryByTestId('telehealth-hits')).toBeNull();
    expect(screen.queryByTestId('telehealth-mobile')).toBeNull();
    expect(screen.queryByTestId('telehealth-type-name')).toBeNull();
  });

  it('an agreed session offers no new link and code', async () => {
    sessions = [session('agreed')];
    render(<TelehealthPanel />);
    expect(await screen.findByTestId('telehealth-status-s-1')).toBeTruthy();
    expect(screen.queryByTestId('telehealth-send-again-s-1')).toBeNull();
    expect(screen.getByTestId('telehealth-did-not-proceed-s-1')).toBeTruthy();
    // The two outcomes after agreeing: complete, or did not go ahead.
    expect(screen.getByTestId('telehealth-went-ahead-s-1').textContent).toBe(p.wentAhead);
    // The reference the patient quotes is beside the session (D-2026-10-12-03 item 11).
    expect(screen.getByTestId('telehealth-id-s-1').textContent).toBe(p.consultationId('TH-AB12-CD34'));
  });

  it('a refused send is said next to the Send button, not off-screen at the top', async () => {
    sendRefusal = 'The server observed something.';
    await choosePatient();
    for (const type of ['name', 'date_of_birth', 'address']) fireEvent.click(screen.getByTestId(`telehealth-type-${type}`));
    fireEvent.click(screen.getByTestId('telehealth-who-patient'));
    const send = screen.getByTestId('telehealth-send') as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);

    const notice = await screen.findByTestId('telehealth-error');
    expect(notice.textContent).toContain(sendRefusal);
    expect(screen.getAllByTestId('telehealth-error')).toHaveLength(1);
    expect(notice.closest('section')?.getAttribute('aria-labelledby')).toBe('th-contact');
  });

  it('someone acting for the patient needs a relationship and the 18+ tick before Send', async () => {
    await choosePatient();
    for (const type of ['name', 'date_of_birth', 'address']) fireEvent.click(screen.getByTestId(`telehealth-type-${type}`));
    fireEvent.click(screen.getByTestId('telehealth-who-someone-else'));
    const send = screen.getByTestId('telehealth-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(await screen.findByTestId('telehealth-relationship'), { target: { value: 'mother' } });
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('telehealth-over-18'));
    await waitFor(() => expect(send.disabled).toBe(false));
  });

  it('marks not done with a reason from the content list, in file order', async () => {
    sessions = [session('opened')];
    render(<TelehealthPanel />);
    fireEvent.click(await screen.findByTestId('telehealth-not-done-s-1'));
    const select = (await screen.findByTestId('telehealth-reason')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', ...TELEHEALTH_NOT_DONE_REASON_KEYS]);

    // `other` asks for a note and warns against identifiers.
    fireEvent.change(select, { target: { value: 'other' } });
    expect(await screen.findByTestId('telehealth-note')).toBeTruthy();
    expect(document.body.textContent ?? '').toContain(p.noteWarning);

    fireEvent.change(select, { target: { value: 'emergency' } });
    expect(screen.queryByTestId('telehealth-note')).toBeNull();
    fireEvent.click(screen.getByTestId('telehealth-save-not-done'));
    await waitFor(() => expect(screen.getByTestId('telehealth-status-s-1').textContent).toBe(p.status.not_done));
    const post = calls.find((c) => c.url.endsWith('/sessions/s-1/not-done'))!;
    expect(post.body).toEqual({ reason: 'emergency' });
  });

  it('a locked code says so and offers a fresh link and code', async () => {
    sessions = [session('opened', { codeLocked: true, codeAttemptsLeft: 0 })];
    render(<TelehealthPanel />);
    expect(await screen.findByText(p.locked)).toBeTruthy();
    expect(screen.getByTestId('telehealth-send-again-s-1').textContent).toBe(p.sendAgain);
  });

  it('shows the patient beside the code, so it is read to the right person', async () => {
    await choosePatient();
    for (const type of ['name', 'date_of_birth', 'address']) fireEvent.click(screen.getByTestId(`telehealth-type-${type}`));
    fireEvent.click(screen.getByTestId('telehealth-who-patient'));
    const send = screen.getByTestId('telehealth-send') as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    const panel = await screen.findByTestId('telehealth-code-panel');
    expect(panel.textContent).toContain('Testy Telehealthson');
  });

  it('a failed contact read shows the refusal and leaves no stale contact behind', async () => {
    await choosePatient();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/contact')) return { ok: false, status: 404, json: async () => ({ message: 'That patient is not on this practice’s records.' }) } as unknown as Response;
        if (url.includes('/telehealth/patients?q=')) return { ok: true, status: 200, json: async () => [PATIENT] } as unknown as Response;
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      }),
    );
    fireEvent.click(screen.getByTestId('telehealth-choose-again'));
    fireEvent.click(screen.getByTestId('telehealth-choose-p-1'));
    expect((await screen.findByTestId('telehealth-error')).textContent).toContain('not on this practice');
    expect(screen.queryByTestId('telehealth-mobile')).toBeNull();
  });

  it('counts a session as waiting only while its code or page is still live', () => {
    const now = Date.parse('2026-10-12T00:05:00.000Z');
    const later = '2026-10-12T00:10:00.000Z';
    const earlier = '2026-10-12T00:01:00.000Z';
    expect(isWaiting({ state: 'opened', codeExpiresAt: later, pageExpiresAt: null, codeLocked: false }, now)).toBe(true);
    expect(isWaiting({ state: 'opened', codeExpiresAt: earlier, pageExpiresAt: null, codeLocked: false }, now)).toBe(false);
    expect(isWaiting({ state: 'opened', codeExpiresAt: later, pageExpiresAt: null, codeLocked: true }, now)).toBe(false);
    expect(isWaiting({ state: 'code_checked', codeExpiresAt: earlier, pageExpiresAt: later, codeLocked: false }, now)).toBe(true);
    expect(isWaiting({ state: 'code_checked', codeExpiresAt: earlier, pageExpiresAt: earlier, codeLocked: false }, now)).toBe(false);
    expect(isWaiting({ state: 'agreed', codeExpiresAt: later, pageExpiresAt: later, codeLocked: false }, now)).toBe(false);
  });

  it('an earlier patient’s contact arriving late is dropped, never shown under the later patient', async () => {
    const OTHER = { patientId: 'p-2', givenNames: 'Second', familyName: 'Fixtureson', dateOfBirth: '1990-02-02' };
    let releaseFirst: (() => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.endsWith('/telehealth/enabled')) return reply({ enabled: true });
        if (url.endsWith('/telehealth/sessions')) return reply([]);
        if (url.includes('/telehealth/patients?q=')) return reply([PATIENT, OTHER]);
        if (url.endsWith('/p-1/contact')) {
          // The first patient's answer is slow, and lands after the second's.
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return reply({ patientId: 'p-1', maskedMobile: '•••••• 111', maskedEmail: null, record: { ...RECORD, mobile: '0400 000 111' } });
        }
        if (url.endsWith('/p-2/contact')) return reply({ patientId: 'p-2', maskedMobile: '•••••• 222', maskedEmail: null, record: { ...RECORD, givenNames: 'Second', familyName: 'Fixtureson', mobile: '0400 000 222' } });
        return reply({});
      }),
    );
    render(<TelehealthPanel />);
    fireEvent.change(await screen.findByTestId('telehealth-search'), { target: { value: 'Fixture' } });
    fireEvent.submit(screen.getByTestId('telehealth-search').closest('form')!);
    fireEvent.click(await screen.findByTestId('telehealth-choose-p-1'));
    fireEvent.click(screen.getByTestId('telehealth-choose-again'));
    fireEvent.click(screen.getByTestId('telehealth-choose-p-2'));
    expect((await screen.findByTestId('telehealth-mobile')).textContent).toContain('222');
    await waitFor(() => expect(releaseFirst).not.toBeNull());
    releaseFirst!();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('telehealth-mobile').textContent).toContain('222');
    expect(screen.getByTestId('telehealth-mobile').textContent).not.toContain('111');
  });

  it('an earlier patient’s refusal arriving late is dropped, never shown under the later patient', async () => {
    const OTHER = { patientId: 'p-2', givenNames: 'Second', familyName: 'Fixtureson', dateOfBirth: '1990-02-02' };
    let releaseFirst: (() => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.endsWith('/telehealth/enabled')) return reply({ enabled: true });
        if (url.endsWith('/telehealth/sessions')) return reply([]);
        if (url.includes('/telehealth/patients?q=')) return reply([PATIENT, OTHER]);
        if (url.endsWith('/p-1/contact')) {
          // The first patient's refusal arrives at once, but its body is slow and lands after the second's contact.
          return {
            ok: false,
            status: 404,
            json: () =>
              new Promise((resolve) => {
                releaseFirst = () => resolve({ message: 'That patient is not on this practice’s records.' });
              }),
          } as unknown as Response;
        }
        if (url.endsWith('/p-2/contact')) return reply({ patientId: 'p-2', maskedMobile: '•••••• 222', maskedEmail: null, record: { ...RECORD, givenNames: 'Second', familyName: 'Fixtureson', mobile: '0400 000 222' } });
        return reply({});
      }),
    );
    render(<TelehealthPanel />);
    fireEvent.change(await screen.findByTestId('telehealth-search'), { target: { value: 'Fixture' } });
    fireEvent.submit(screen.getByTestId('telehealth-search').closest('form')!);
    fireEvent.click(await screen.findByTestId('telehealth-choose-p-1'));
    await waitFor(() => expect(releaseFirst).not.toBeNull());
    fireEvent.click(screen.getByTestId('telehealth-choose-again'));
    fireEvent.click(screen.getByTestId('telehealth-choose-p-2'));
    expect((await screen.findByTestId('telehealth-mobile')).textContent).toContain('222');
    releaseFirst!();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('telehealth-error')).toBeNull();
    expect(screen.getByTestId('telehealth-mobile').textContent).toContain('222');
  });

  it('takes the last three digits of a masked mobile for the read-back', () => {
    expect(mobileEnding('•••••• 412')).toBe('412');
  });
});
