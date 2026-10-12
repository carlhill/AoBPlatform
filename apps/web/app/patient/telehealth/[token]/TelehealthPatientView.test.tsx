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
const STATEMENT = 'I, Testy Fixture, want to start my telehealth consultation with Dr Sample Chen now.';
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
  ahpraNumber: null,
  consultationId: 'TH-AB12-CD34',
  consenterIsPatient: true,
  consenterRelationship: null,
  patientGivenNames: null,
  statement: STATEMENT,
  consentKey: 'telehealth_consult_v3',
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

    // ONE STEP: the statement is the tick box's label, from the server's content, and ticking it agrees. No button.
    const tick = await screen.findByTestId('telehealth-tick');
    expect(screen.getByText(STATEMENT)).toBeTruthy();
    expect(screen.queryByTestId('telehealth-agree')).toBeNull();
    fireEvent.click(tick);

    expect((await screen.findByTestId('telehealth-waiting')).textContent).toContain(t.started);
    // The reference to quote to the practice, at the foot of the page (D-2026-10-12-03 item 11).
    expect(screen.getByTestId('telehealth-consultation-id').textContent).toBe(t.consultationId('TH-AB12-CD34'));

    const codeCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/code'))!;
    expect(JSON.parse(String(codeCall[1]!.body))).toEqual({ code: '042917' });
    const agreeCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/page/agree'))!;
    expect(JSON.parse(String(agreeCall[1]!.body))).toEqual({ consentKey: 'telehealth_consult_v3' });
  });

  it('someone acting for the patient types their full name and a mobile before the tick, and both are sent (D-2026-10-12-03 item 12)', async () => {
    const carerStatement = 'I, {{consenterName}}, carer for Testy, want to start the telehealth consultation for Testy with Dr Sample Chen now.';
    const fetchMock = stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
      if (url.endsWith('/page/agree')) return { status: 201, body: { ...page('agreed'), consenterIsPatient: false } };
      return {
        status: 200,
        body: { ...page('code_checked'), consenterIsPatient: false, consenterRelationship: 'carer', patientGivenNames: 'Testy', statement: carerStatement },
      };
    });
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));

    const tick = await screen.findByTestId('telehealth-tick');
    // Before anything is typed the tick waits, and the statement shows where the name will go.
    expect(tick.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/\[your full name\], carer for Testy/)).toBeTruthy();
    // Said as their relationship, not "acting for the patient" (Carl, 12 Oct 2026).
    expect(screen.getByTestId('telehealth-consenter-intro').textContent).toContain('You are the carer for Testy.');
    // One name is not enough: the tick waits for two (D-2026-10-12-03 item 12).
    fireEvent.change(screen.getByTestId('telehealth-consenter-name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByTestId('telehealth-consenter-mobile'), { target: { value: '0400 000 999' } });
    expect(tick.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByTestId('telehealth-consenter-name'), { target: { value: 'Jane Citizen' } });
    fireEvent.change(screen.getByTestId('telehealth-consenter-mobile'), { target: { value: '0400 000 999' } });
    expect(screen.getByText(/I, Jane Citizen, carer for Testy/)).toBeTruthy();
    await waitFor(() => expect(tick.hasAttribute('disabled')).toBe(false));
    fireEvent.click(tick);

    await screen.findByTestId('telehealth-waiting');
    const agreeCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/page/agree'))!;
    expect(JSON.parse(String(agreeCall[1]!.body))).toEqual({
      consentKey: 'telehealth_consult_v3',
      consenterName: 'Jane Citizen',
      consenterMobile: '0400 000 999',
    });
  });

  it('a closed link says which outcome closed it', async () => {
    stub(() => ({ status: 200, body: { state: 'closed', practiceName: 'Sample Practice', outcome: 'went_ahead' } }));
    render(<TelehealthPatientView token={TOKEN} />);
    expect((await screen.findByTestId('telehealth-closed')).textContent).toContain(t.closedBodyFor('went_ahead'));
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
    await screen.findByTestId('telehealth-tick');
    const words = document.body.textContent ?? '';
    expect(words).not.toMatch(/bulk[\s-]*bill|medicare|assign|benefit|\bdb4\b|approv/i);
  });

  it('says how many tries are left on a wrong code, and stops on a locked one', async () => {
    let tries = 0;
    stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      tries += 1;
      return tries === 1
        ? { status: 400, body: { code: 'wrong_code', outcome: 'wrong_code', attemptsLeft: 2 } }
        : { status: 423, body: { code: 'locked', outcome: 'locked', attemptsLeft: 0 } };
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

  it('maps each refusal by its code, not its status (wow.md 13)', async () => {
    const cases: { reply: Reply; testId: string; words: string }[] = [
      { reply: { status: 500, body: {} }, testId: 'telehealth-unreachable', words: t.unreachableBody },
      { reply: { status: 410, body: { code: 'link_used', outcome: 'expired' } }, testId: 'telehealth-used', words: t.usedBody },
      { reply: { status: 410, body: { code: 'code_expired', outcome: 'expired' } }, testId: 'telehealth-expired', words: t.expiredBody },
      { reply: { status: 410, body: { code: 'session_closed', outcome: 'expired' } }, testId: 'telehealth-closed', words: t.closedBody },
    ];
    for (const c of cases) {
      stub((url) =>
        url.endsWith(`/telehealth/link/${TOKEN}`) ? { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } } : c.reply,
      );
      render(<TelehealthPatientView token={TOKEN} />);
      fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
      fireEvent.click(screen.getByTestId('telehealth-continue'));
      expect((await screen.findByTestId(c.testId)).textContent).toContain(c.words);
      cleanup();
    }
  });

  it('an unmapped refusal shows its code', async () => {
    stub((url) =>
      url.endsWith(`/telehealth/link/${TOKEN}`)
        ? { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } }
        : { status: 418, body: { code: 'something_new' } },
    );
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    expect((await screen.findByTestId('telehealth-unmapped')).textContent).toContain('something_new');
  });

  it('a page replaced by a newer link, and an expired page, each say so', async () => {
    for (const [code, testId, words] of [
      ['page_replaced', 'telehealth-replaced', t.replacedBody],
      ['page_expired', 'telehealth-page-expired', t.pageExpiredBody],
    ] as const) {
      stub((url) => {
        if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
        if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
        return { status: 410, body: { code } };
      });
      render(<TelehealthPatientView token={TOKEN} />);
      fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
      fireEvent.click(screen.getByTestId('telehealth-continue'));
      const notice = await screen.findByTestId(testId);
      expect(notice.textContent).toContain(words);
      expect(notice.textContent).not.toContain(t.expiredBody);
      cleanup();
    }
  });

  it('a session closed by the practitioner is not "the wording changed"', async () => {
    let state = 'code_checked';
    stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
      if (url.endsWith('/page/agree')) {
        state = 'not_done';
        return { status: 409, body: { code: 'session_not_done' } };
      }
      return { status: 200, body: page(state) };
    });
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    fireEvent.click(await screen.findByTestId('telehealth-tick'));
    expect((await screen.findByTestId('telehealth-not-done')).textContent).toContain(t.notDoneBody);
    expect(document.body.textContent ?? '').not.toContain(t.wordingChanged);
  });

  it('needs every digit before it will continue, and never says "0 more tries"', async () => {
    const fetchMock = stub((url) =>
      url.endsWith(`/telehealth/link/${TOKEN}`)
        ? { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } }
        : { status: 400, body: { code: 'wrong_code', outcome: 'wrong_code' } },
    );
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123' } });
    expect((screen.getByTestId('telehealth-continue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/code'))).toBe(false);
    fireEvent.change(screen.getByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    expect(await screen.findByText(t.wrongCodeNoCount)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/\b0 more tr/);
  });

  it('a page that closed under the button says it is not open, by its code', async () => {
    stub((url) => {
      if (url.endsWith(`/telehealth/link/${TOKEN}`)) return { status: 200, body: { state: 'open', practiceName: 'Sample Practice' } };
      if (url.endsWith('/code')) return { status: 201, body: { pageKey: PAGE_KEY } };
      if (url.endsWith('/page/agree')) return { status: 404, body: { code: 'page_not_open' } };
      return { status: 200, body: page('code_checked') };
    });
    render(<TelehealthPatientView token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('telehealth-continue'));
    fireEvent.click(await screen.findByTestId('telehealth-tick'));
    expect((await screen.findByTestId('telehealth-page-not-open')).textContent).toContain(t.pageNotOpenBody);
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
    await screen.findByTestId('telehealth-tick');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
