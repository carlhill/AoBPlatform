/**
 * THE ACTIVATION PAGE — FR-1.14, REQ-PORT-08, REQ-SEC-07, hard rule 1.
 *
 * FOUR NAMED TESTS, and each one is a rule rather than a behaviour somebody
 * liked:
 *
 *  - `activation_page_renders_only_identifier_types_from_the_server` — the page
 *    holds no field set of its own, so it cannot draw a box the practice did
 *    not configure, and it cannot draw a Medicare card box at all.
 *  - `activation_never_shows_which_identifier_failed` — one sentence for every
 *    mismatch, naming nothing (REQ-SEC-07).
 *  - `activation_locked_state_says_ask_your_practice` — the third failure ends
 *    the link, and the copy says where a new one comes from and that care is
 *    unaffected (hard rule 8).
 *  - `activation_success_lands_on_the_portal_with_the_welcome_line` — the
 *    server sets the cookie; the page only navigates, and it navigates to the
 *    one place where a passkey can be added.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/patient/portal/activate/tok',
}));

vi.mock('../../../../auth', () => ({
  currentSession: () => null,
  apiHeaders: () => ({}),
}));

const api = vi.hoisted(() => ({
  fetchActivationChallenge: vi.fn(),
  activatePortal: vi.fn(),
}));

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, ...api, PORTAL_FIXTURES: false };
});

import { ActivateView } from './ActivateView';
import { PortalApiError } from '../../api';
import { strings } from '../../../../strings';

/* The shell asks the server which practice a session is acting as; there is no
   session here and nothing on this page needs the answer. */
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response),
);

const CHALLENGE = {
  identifierTypes: ['name', 'date_of_birth', 'address'],
  practiceName: 'Wattle Street Medical',
  expiresAt: '2026-09-30T04:00:00.000Z',
  attemptsRemaining: 3,
};

afterEach(() => {
  vi.clearAllMocks();
});

/** Fill every box with something. What it is does not matter to these tests. */
function fillTheForm() {
  fireEvent.change(screen.getByLabelText(strings.portal.activate.nameGiven), {
    target: { value: 'Alex' },
  });
  fireEvent.change(screen.getByLabelText(strings.portal.activate.nameFamily), {
    target: { value: 'Sample' },
  });
  /*
   * THREE PICKERS, like the kiosk (Carl, 5 Sep 2026); the composed value is
   * 1962-11-02. The day VALUE is zero-padded — `dayOptions()` labels the option
   * '2' and values it '02' — and a `fireEvent.change` to a value no option
   * carries leaves the select on '', which is how this read as a half-filled
   * date and disabled Continue.
   */
  fireEvent.change(screen.getByTestId('activate-dob-day'), { target: { value: '02' } });
  fireEvent.change(screen.getByTestId('activate-dob-month'), { target: { value: '11' } });
  fireEvent.change(screen.getByTestId('activate-dob-year'), { target: { value: '1962' } });
  fireEvent.change(screen.getByLabelText(strings.kiosk.verify.identifierNames.address), {
    target: { value: '2 Example Street' },
  });
}

describe('the activation page', () => {
  it('activation_page_renders_only_identifier_types_from_the_server', async () => {
    api.fetchActivationChallenge.mockResolvedValue({
      ...CHALLENGE,
      // Two types, not three: the page renders what it is sent, in that order.
      identifierTypes: ['name', 'date_of_birth', 'patient_record_number'],
    });
    render(<ActivateView token="tok" />);

    await screen.findByText(strings.portal.activate.offer('Wattle Street Medical'));

    expect(screen.getByLabelText(strings.kiosk.verify.identifierNames.patient_record_number)).toBeTruthy();
    // NOT SENT, SO NOT DRAWN. The page has no field set of its own.
    expect(screen.queryByLabelText(strings.kiosk.verify.identifierNames.address)).toBeNull();

    /*
     * HARD RULE 1 ON THE SCREEN. There is no Medicare label in the string
     * table, so this asserts over the rendered text: nothing on this page
     * invites a card number, and no branch exists that could draw one.
     */
    expect(document.body.textContent).not.toMatch(/medicare/i);
    expect(document.body.textContent).not.toMatch(/card number/i);
  });

  it('activation_never_shows_which_identifier_failed', async () => {
    api.fetchActivationChallenge.mockResolvedValue(CHALLENGE);
    api.activatePortal.mockRejectedValue(new PortalApiError('no', 401, undefined, 2));
    render(<ActivateView token="tok" />);
    await screen.findByText(strings.portal.activate.ask);

    fillTheForm();
    fireEvent.click(screen.getByText(strings.portal.activate.continueAction));

    await screen.findByText(strings.portal.activate.mismatchHeading);

    /*
     * ONE SENTENCE, NAMING NOTHING — asserted over the ALERT REGION, which is
     * the only place the refusal speaks. The field labels are of course still
     * on the page; what must never appear is one of them inside the message,
     * or a count of how many matched (REQ-SEC-07).
     */
    const alert = document.querySelector('#activate-mismatch');
    const said = alert?.textContent ?? '';
    expect(said).toContain(strings.portal.activate.mismatchHeading);
    for (const label of Object.values(strings.kiosk.verify.identifierNames)) {
      expect(said).not.toContain(label);
    }
    expect(said).not.toMatch(/\b(one|two|1|2) of (three|3)\b/i);
    // Every input points at that one message, so a screen reader is told
    // exactly as much as everybody else (WCAG 2.2 AA).
    expect(
      (screen.getByLabelText(strings.kiosk.verify.identifierNames.address) as HTMLInputElement).getAttribute(
        'aria-describedby',
      ),
    ).toBe('activate-mismatch');
    // The tries left ARE said — a count discloses nothing and being locked out
    // unwarned is the worse failure.
    expect(screen.getByTestId('activate-attempts').textContent).toBe(
      strings.portal.activate.attemptsRemaining(2),
    );
    // AND EVERYTHING TYPED STAYS. Retyping three identifiers to fix one letter
    // is the kiosk mistake this page does not repeat.
    expect((screen.getByLabelText(strings.portal.activate.nameGiven) as HTMLInputElement).value).toBe('Alex');
  });

  it('activation_locked_state_says_ask_your_practice', async () => {
    api.fetchActivationChallenge.mockResolvedValue(CHALLENGE);
    api.activatePortal.mockRejectedValue(new PortalApiError('locked', 423, 'token_locked'));
    render(<ActivateView token="tok" />);
    await screen.findByText(strings.portal.activate.ask);

    fillTheForm();
    fireEvent.click(screen.getByText(strings.portal.activate.continueAction));

    await screen.findByText(strings.portal.activate.lockedHeading);
    expect(screen.getByText(strings.portal.activate.lockedBody)).toBeTruthy();
    // HARD RULE 8, on the screen most likely to make somebody fear otherwise.
    expect(screen.getByText(strings.portal.activate.lockedReassurance)).toBeTruthy();
    // And the form is gone — there is nothing left to try.
    expect(screen.queryByText(strings.portal.activate.continueAction)).toBeNull();
  });

  it('activation_success_lands_on_the_portal_with_the_welcome_line', async () => {
    api.fetchActivationChallenge.mockResolvedValue(CHALLENGE);
    api.activatePortal.mockResolvedValue(undefined);
    render(<ActivateView token="tok" />);
    await screen.findByText(strings.portal.activate.ask);

    fillTheForm();
    fireEvent.click(screen.getByText(strings.portal.activate.continueAction));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/patient/portal?welcome=1'));

    // NO AGREEMENT ID IS SENT, because this page was never told one.
    const [, stated] = api.activatePortal.mock.calls[0];
    expect(Object.keys(stated).sort()).toEqual(['address', 'date_of_birth', 'name']);
    // The two name boxes went as ONE identifier.
    expect(stated.name).toBe('Alex Sample');
  });

  it('maps a dead link to its own copy and a next step, and shows an unmapped code', async () => {
    api.fetchActivationChallenge.mockRejectedValue(new PortalApiError('gone', 404, 'token_expired'));
    const { unmount } = render(<ActivateView token="tok" />);
    await screen.findByText(strings.portal.activate.reasons.token_expired.body);
    unmount();

    api.fetchActivationChallenge.mockRejectedValue(new PortalApiError('?', 404, 'token_eaten_by_a_dog'));
    render(<ActivateView token="tok" />);
    // AN UNMAPPED CODE SHOWS ITSELF rather than becoming a shrug.
    await screen.findByText(strings.portal.activate.unmappedReason('token_eaten_by_a_dog'));
  });

  it('tells an unreachable server apart from a dead link', async () => {
    api.fetchActivationChallenge.mockRejectedValue(new Error('network'));
    render(<ActivateView token="tok" />);
    // "Try again shortly", not "ask your practice" — different fault, different step.
    await screen.findByText(strings.portal.signedOut.unreachable);
  });
});
