/**
 * SIGN-IN AND SECURITY — FR-8.2's passkey card (Carl, 4 Sep 2026).
 *
 * WHAT THESE TESTS ARE ACTUALLY PROTECTING, in order of how badly it would read
 * to get it wrong:
 *
 *  - `portal_passkey_is_offered_never_required` — the card is an OFFER
 *    (REQ-PORT-08). A patient who ignores it loses nothing, and a page that
 *    implied otherwise would contradict the one sentence the signed-out screen
 *    exists to say.
 *  - `portal_passkey_last_one_warns_and_does_not_refuse` — removing the last
 *    credential is allowed. The dialog explains what happens next; it must
 *    never disable the button.
 *  - `portal_passkey_persists_nothing_in_the_browser` — the same discipline the
 *    kiosk has as a lint rule. This surface runs on a patient's own phone.
 *  - A browser that cannot do passkeys is told so, and shown no dead control.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PasskeysCard } from './PasskeysCard';
import type { PortalPasskey } from '../api';

const passkeys: readonly PortalPasskey[] = [
  {
    id: 'passkey-1',
    label: 'My phone',
    createdAt: '2026-08-19T02:44:00.000Z',
    lastUsedAt: '2026-09-03T22:01:00.000Z',
  },
  { id: 'passkey-2', label: null, createdAt: '2026-09-01T09:00:00.000Z', lastUsedAt: null },
];

const ready = (data: readonly PortalPasskey[]) => ({ status: 'ready', data }) as const;
const noop = async () => {};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('portal_passkey_is_offered_never_required', () => {
  it('says it is optional and that signing never needs it', () => {
    render(<PasskeysCard state={ready([])} supported onAdd={noop} onRemove={noop} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('This is optional');
    expect(text).toContain('never need it to sign a bulk-billing agreement');
    // An empty list is a normal state with a plain sentence, not a warning.
    expect(text).toContain('You have not added a passkey yet.');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('explains what a passkey is without jargon beyond the word itself', () => {
    render(<PasskeysCard state={ready([])} supported onAdd={noop} onRemove={noop} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('face, fingerprint or PIN');
    expect(text).toContain('stays on your own phone');
    for (const jargon of ['WebAuthn', 'authenticator', 'credential', 'biometric', 'public key']) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });
});

describe('adding one', () => {
  it('sends the label the patient typed, and clears it afterwards', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<PasskeysCard state={ready([])} supported onAdd={onAdd} onRemove={noop} />);

    const field = screen.getByLabelText(/What should we call this device/i);
    fireEvent.change(field, { target: { value: 'Nan’s iPad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Nan’s iPad'));
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));
  });

  it('shows the failure on the card and changes nothing else', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('nope'));
    render(<PasskeysCard state={ready(passkeys)} supported onAdd={onAdd} onRemove={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));

    const alert = await screen.findByRole('alert');
    // OUR SENTENCE, NEVER THE SERVER'S — and it says nothing has changed, which
    // is the thing somebody whose phone just cancelled a prompt needs to hear.
    expect(alert.textContent).toContain('nothing has changed');
    expect(alert.textContent).not.toContain('nope');
    // The list is untouched.
    expect(screen.getByText('My phone')).toBeTruthy();
  });

  it('names a device the patient did not name, rather than inventing one', () => {
    render(<PasskeysCard state={ready(passkeys)} supported onAdd={noop} onRemove={noop} />);
    expect(screen.getByText('Unnamed device')).toBeTruthy();
    expect(screen.getByText(/Not used yet/)).toBeTruthy();
  });
});

describe('portal_passkey_last_one_warns_and_does_not_refuse', () => {
  it('warns when it is the only one, and still removes it', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(<PasskeysCard state={ready([passkeys[0]])} supported onAdd={noop} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('This is your only passkey');
    // The route back is named — the practice, not a support line (Carl, 4 Sep
    // 2026: shortcuts to the answer).
    expect(dialog.textContent).toContain('new invitation from your practice');
    expect(dialog.textContent).toContain('care are not affected');

    const confirm = screen.getByRole('button', { name: 'Remove it' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('passkey-1'));
  });

  it('does not warn when others remain', async () => {
    render(<PasskeysCard state={ready(passkeys)} supported onAdd={noop} onRemove={noop} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('My phone will no longer open this page.');
    expect(dialog.textContent).not.toContain('only passkey');
  });
});

describe('a browser that cannot do it', () => {
  it('says so and offers no control at all', () => {
    render(<PasskeysCard state={ready(passkeys)} supported={false} onAdd={noop} onRemove={noop} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('This browser cannot use passkeys');
    expect(screen.queryByRole('button', { name: 'Add a passkey' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    // The explanation of what a passkey is still renders — somebody on an old
    // browser is allowed to know what they are being offered elsewhere.
    expect(text).toContain('face, fingerprint or PIN');
  });
});

describe('states', () => {
  it('says so when it is loading and when it failed', () => {
    const loading = render(<PasskeysCard state={{ status: 'loading' }} supported onAdd={noop} onRemove={noop} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<PasskeysCard state={{ status: 'error' }} supported onAdd={noop} onRemove={noop} />);
    expect(failed.container.querySelector('[role="alert"]')).toBeTruthy();
    // The prose survives a failed list, as everywhere else on this page.
    expect(failed.container.textContent).toContain('This is optional');
  });
});

describe('portal_passkey_persists_nothing_in_the_browser', () => {
  it('writes nothing to localStorage or sessionStorage', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');

    render(<PasskeysCard state={ready(passkeys)} supported onAdd={onAdd} onRemove={noop} />);
    fireEvent.change(screen.getByLabelText(/What should we call this device/i), { target: { value: 'A phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

    expect(setLocal).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    // Not even a draft label survives a reload; the field is component state.
    expect(document.cookie).toBe('');
  });
});
