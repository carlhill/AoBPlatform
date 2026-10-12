/**
 * The one telehealth page (TELEHEALTH-PLAN.md §3 steps 6–9): landing, code,
 * one statement as one button, then waiting. Fixtures are obviously fake.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TelehealthPatientView } from './TelehealthPatientView';
import { strings } from '../../../strings';

const TOKEN = 'cHJhY3RpY2U.secret-example';
const PAGE_KEY = 'cHJhY3RpY2U.page-key-example';
const STATEMENT = 'Yes, start my telehealth consultation with Dr Sample Chen';
const t = strings.telehealth.patient;

type Reply = { status: number; body: unknown };

function stub(routes: (url: string, init?: RequestInit) => Reply) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = routes(url, init);
    return { ok: status < 300, status, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const page = (state: string) => ({
  state,
  practiceName: 'Sample Practice',
  providerName: 'Dr Sample Chen',
  statement: STATEMENT,
  consentKey: 'telehealth_consult_v1',
  contentVersion: 'telehealth-test',
  agreedAt: state === 'agreed' ? '2026-10-12T00:00:00.000Z' : null,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TelehealthPatientView', () => {
  it('walks landing → code → one button → waiting, sending only the code and the statement key', async () => {
    let state = 'code_checked';
    const fetchMock = stub((url, init) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
      if (url.endsWith('/page/agree')) {
        state = 'agreed';
        return { status: 201, body: page('agreed') };
      }
      if (url.endsWith('/telehealth/page')) {
        expect((init?.headers as Record<string, string>)['x-telehealth-page-key']).toBe(PAGE_KEY);
        return { status: 200, body: page(state) };
      }
      return { status: 404, body: {} };
    });

    render(<TelehealthPatientView token={TOKEN} />);
    // Before the code: the practice and nothing about the practitioner or the patient.
    expect((await screen.findByTestId('telehealth-practice')).textContent).toContain('Sample Practice');
    expect(screen.queryByText(/Dr Sample Chen/)).toBeNull();

    // WCAG: the code box has a programmatic label and asks for the numeric keypad.
    const input = screen.getByLabelText(t.codeLabel) as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    fireEvent.change(input, { target: { value: '04 29 17' } });
    expect(input.value).toBe('042917');
    fireEvent.click(screen.getByTestId('telehealth-continue'));

    // One statement, one button, from the server's content.
    const button = await screen.findByTestId('telehealth-agree');
    expect((button).textContent).toContain(STATEMENT);
    fireEvent.click(button);

    expect((await screen.findByTestId('telehealth-waiting')).textContent).toContain(t.waitingTitle('Dr Sample Chen'));

    const codeCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/code'))!;
    expect(JSON.parse(String(codeCall[1]!.body))).toEqual({ code: '042917' });
    const agreeCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/page/agree'))!;
    expect(JSON.parse(String(agreeCall[1]!.body))).toEqual({ consentKey: 'telehealth_consult_v1' });
  });

  it('telehealth_consent_wording_never_mentions_bulk_billing (on the page itself)', async () => {
    stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
      return { status: 200, body: page('code_checked') };
    });
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    await screen.findByTestId('telehealth-agree');
    const words = document.body.textContent ?? '';
    expect(words).not.toMatch(/bulk[\s-]*bill|medicare|assign|benefit|\bdb4\b|approv/i);
  });

  it('says how many tries are left on a wrong code, and stops on a locked one', async () => {
    let tries = 0;
    stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      tries += 1;
      return tries === 1
        ? { status: 400, body: { outcome: 'wrong_code', attemptsLeft: 2 } }
        : { status: 423, body: { outcome: 'locked', attemptsLeft: 0 } };
    });
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    expect(await screen.findByText(t.wrongCode(2))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t.codeLabel), { target: { value: '111111' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    const locked = await screen.findByTestId('telehealth-locked');
    expect(locked.getAttribute('role')).toBe('alert');
    expect((locked).textContent).toContain(t.lockedBody);
  });

  it('a used link says so and names the way on', async () => {
    stub(() => ({ status: 200, body: { state: 'used', practiceName: 'Sample Practice' } }));
    render(<TelehealthPatientView token={TOKEN} />);
    expect((await screen.findByTestId('telehealth-used')).textContent).toContain(t.usedBody);
  });

  it('a not-done session tells the patient the consultation goes ahead', async () => {
    stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
      return { status: 200, body: page('not_done') };
    });
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    await waitFor(() => expect((screen.getByTestId('telehealth-not-done')).textContent).toContain(t.notDoneBody));
  });

  it('writes nothing to browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
      return { status: 200, body: page('code_checked') };
    });
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    await screen.findByTestId('telehealth-agree');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
