/**
 * THE TWO SCREENS THAT STAND BETWEEN A STRANGER AND A WAITING ROOM.
 *
 * `/kiosk` is a public URL. Until 3 September 2026 its practice scope came
 * from a build-time environment variable, so anybody who reached the address
 * saw a practice's waiting list — patient names on a screen with no gate in
 * front of it. K-0 (pairing) is that gate, and the unpaired screen is what a
 * revoked tablet falls to.
 *
 * WHAT THESE PIN, and each is a way the screens could look right and not be:
 *
 *  - The pair button is genuinely unpressable until the code is the right
 *    shape (CLAUDE.md §6 — blocked states are unreachable, not merely inert),
 *    and it says why.
 *  - A refusal never explains itself. Wrong, expired, spent and revoked are
 *    one sentence: telling somebody their code was right but stale is telling
 *    them their guess was right.
 *  - An unpaired tablet names NO practice. It does not know which practice it
 *    is and must not guess — showing a remembered name would be the leak the
 *    pairing gate exists to close.
 *  - The unpaired screen offers no retry (TODO.md: "no retry loop hammering
 *    the server") and says the appointment is unaffected (REQ-REC-04).
 *  - Neither screen offers an un-pair control. A tablet that can un-pair
 *    itself is a tablet a passer-by can un-pair.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PairingScreen } from './screens/PairingScreen';
import { UnpairedScreen } from './screens/UnpairedScreen';
import { strings } from './strings';

const noop = () => undefined;

function renderPairing(overrides: Partial<Parameters<typeof PairingScreen>[0]> = {}) {
  const props = {
    code: '',
    busy: false,
    failure: null,
    paired: null,
    onChangeCode: noop,
    onPair: noop,
    onContinue: noop,
    ...overrides,
  } as Parameters<typeof PairingScreen>[0];
  return render(<PairingScreen {...props} />);
}

describe('K-0 — pairing this tablet', () => {
  it('pairing_is_blocked_until_the_code_is_the_right_shape', () => {
    const onPair = vi.fn();
    const { unmount } = renderPairing({ code: 'ABC', onPair });

    // A REAL `disabled` button with no handler, not a live control that
    // quietly does nothing — the blocked branch of `GuardedButton`.
    const blocked = screen.getByTestId('pairing-submit') as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.textContent).toBe(strings.pairing.pairBlocked);
    fireEvent.click(blocked);
    expect(onPair).not.toHaveBeenCalled();
    unmount();

    // Eight characters, however they were typed. The screen never teaches
    // anybody about hyphens or capitals — the server normalises.
    renderPairing({ code: 'abcd-efgh', onPair });
    const ready = screen.getByTestId('pairing-submit') as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    expect(onPair).toHaveBeenCalledTimes(1);
  });

  it('a_refused_code_never_says_why_it_was_refused', () => {
    renderPairing({ code: 'ABCDEFGH', failure: 'refused' });
    const error = screen.getByTestId('pairing-error');
    expect(error.textContent).toBe(strings.pairing.refused);
    // Announced, not merely coloured (WCAG 2.2 AA).
    expect(error.getAttribute('role')).toBe('alert');

    // None of the four ways a code can fail is distinguishable from the copy.
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/expired|already used|revoked|not found|incorrect/i);

    // And a network failure is a DIFFERENT problem with a different fix, so it
    // gets different words — check the connection, not ask for a new code.
    expect(strings.pairing.unreachable).not.toBe(strings.pairing.refused);
  });

  it('names no practice until the server has said which one', () => {
    renderPairing({ code: '' });
    // The header wears the platform's own name. An unpaired tablet does not
    // know which practice it is, and a guess on this screen would be the leak
    // the whole feature exists to close.
    expect(screen.getAllByText(strings.appName).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(strings.pairing.heading);
  });

  it('the code field is a real labelled control with the code visible', () => {
    renderPairing({ code: 'ABCDEFGH' });
    const input = screen.getByTestId('pairing-code');
    // A visible <label>, bound — a placeholder is not a label.
    expect(screen.getByLabelText(strings.pairing.codeLabel)).toBe(input);
    // NOT a password field. There is nothing to hide from the person typing
    // it, and masking an eight-character code read off a screen across the
    // room is how it gets typed wrong three times.
    expect((input as HTMLInputElement).type).not.toBe('password');
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    // And the browser is not allowed to remember it.
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('says so when the browser would not remember the credential', () => {
    renderPairing({ paired: { practiceName: 'Sample Practice', remembered: false } });
    expect(screen.getByTestId('pairing-paired').textContent).toContain('Sample Practice');
    // The tablet works. It will need pairing again after a restart, and the
    // person who can fix that is the one standing here now.
    expect(screen.getByTestId('pairing-not-remembered').textContent).toBe(
      strings.pairing.notRemembered,
    );
  });

  it('says nothing about a browser problem when there is not one', () => {
    renderPairing({ paired: { practiceName: 'Sample Practice', remembered: true } });
    expect(screen.queryByTestId('pairing-not-remembered')).toBeNull();
    // It does say what the practice can do about a tablet that goes missing,
    // which is the whole threat model in one line.
    expect(document.body.textContent).toContain('revoked from the practice console');
  });
});

describe('the unpaired screen — where a revoked tablet lands', () => {
  it('unpaired_screen_blocks_no_care_and_offers_no_retry', () => {
    render(<UnpairedScreen onPair={noop} />);

    expect(screen.getByTestId('unpaired-heading').textContent).toBe(strings.unpaired.heading);
    // REQ-REC-04, hard rule 8: the evidence stops, the appointment does not.
    expect(screen.getByTestId('unpaired-body').textContent).toContain('appointment is not affected');
    expect(document.body.textContent).toContain('see reception');

    /*
     * NO RETRY, AND THAT IS THE DESIGN. The credential is dead and will be
     * dead on every future attempt, so a Try again would ask the server the
     * same refused question forever. The only control is the one that can
     * actually change the answer.
     */
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('data-testid')).toBe('unpaired-pair');
    expect(document.body.textContent).not.toMatch(/try again|retry|reconnect/i);
  });

  it('names no practice and offers no way to un-pair', () => {
    render(<UnpairedScreen onPair={noop} />);
    // Nothing of the practice or the previous patient survives this screen.
    expect(document.body.textContent).not.toMatch(/sample practice|waiting|patient/i);
    // Revoke and rotate are console acts. A tablet that can un-pair itself is
    // a tablet a passer-by can un-pair.
    expect(document.body.textContent).not.toMatch(/un-?pair this|forget|remove the pairing/i);
  });
});
