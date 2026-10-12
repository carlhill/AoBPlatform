/**
 * "SEND ME A COPY" ON THE THANK-YOU SCREEN — W6, REQ-PORT-02, the s 65C
 * copy-on-request obligation automated.
 *
 * WHAT THESE TESTS PROTECT, and each of them is a way the offer could look
 * finished and not be:
 *
 *  - There is NO BOX. The screen offers a contact the record already holds,
 *    masked, and has no input anywhere on it (D-2026-09-11-03). This is the
 *    assertion that stops a well-meaning future edit adding one.
 *  - What leaves the device is an option KEY. Not an address, not a masked
 *    address, not a channel the client picked — the key from the content file
 *    (hard rule 9).
 *  - The list is rendered in the order the server sent it, which is the
 *    content file's order (hard rule 14, Carl 3 Sep 2026).
 *  - Declining, a failed send, and an offer that could not be built all leave
 *    the ceremony complete and Done pressable (hard rule 8, REQ-REC-04).
 *  - Nothing is written to the device — not the mask, not the option, nothing
 *    but the pairing credential (CLAUDE.md §7).
 *  - An unmapped reason code SHOWS ITS CODE rather than a generic sentence
 *    ("Shortcuts to the answer", Carl 4 Sep 2026).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CompleteScreen } from './screens/CompleteScreen';
import { strings } from './strings';
import { PAIRING_CREDENTIAL_KEY } from './pairing';

const fetchCopyOffer = vi.fn();
const requestCopy = vi.fn();

vi.mock('./api', () => ({
  fetchCopyOffer: (...args: unknown[]) => fetchCopyOffer(...args),
  requestCopy: (...args: unknown[]) => requestCopy(...args),
}));

const AGREEMENT_ID = 'a6d0f6f2-1f6e-4c2a-9f1e-2b7d1a0c9e31';

/**
 * The offer as the server builds it: MASKED, in content-file order, and with
 * the option keys the string table is keyed by. Nothing here is an address —
 * there is no field on this type that one could arrive in.
 */
const OFFER = {
  channels: [
    { key: 'email', channel: 'email' as const, masked: 'j•••@e•••.com' },
    { key: 'sms', channel: 'sms' as const, masked: '•••••• 111' },
  ],
  declineKey: 'not_now',
  version: 'copy-delivery-2026-09-11',
};

function renderComplete(props: Partial<Parameters<typeof CompleteScreen>[0]> = {}) {
  return render(
    <CompleteScreen
      practiceName="Sample Family Practice"
      locationLine={null}
      givenName="Jamie"
      agreementId={AGREEMENT_ID}
      onDone={() => undefined}
      {...props}
    />,
  );
}

describe('the copy offer on K-6', () => {
  beforeEach(() => {
    fetchCopyOffer.mockReset();
    requestCopy.mockReset();
    fetchCopyOffer.mockResolvedValue(OFFER);
    requestCopy.mockResolvedValue({ channel: 'email', queued: true });
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the_tablet_never_offers_a_box_to_type_an_address_into', async () => {
    // D-2026-09-11-03. The offer names a contact already on the record and the
    // screen has no input of any kind — not a text box, not a select, nothing.
    const { container } = renderComplete();
    await screen.findByTestId('copy-offer');

    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(container.querySelectorAll('[contenteditable]')).toHaveLength(0);
  });

  it('shows the contact masked, and never an address in full', async () => {
    renderComplete();
    const offer = await screen.findByTestId('copy-offer');

    expect(offer.textContent).toContain('j•••@e•••.com');
    expect(offer.textContent).toContain('•••••• 111');
    // Nothing on this screen is a whole address. The check is on the shape a
    // real one would have, because the mask is the only form the tablet holds.
    expect(offer.textContent).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(offer.textContent).not.toMatch(/\d{6,}/);
  });

  it('renders the channels in the order the content file gave them', async () => {
    renderComplete();
    const offer = await screen.findByTestId('copy-offer');
    const labels = [...offer.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'));
    // File order is screen order, and the decline option comes last.
    expect(labels).toEqual(['copy-option-email', 'copy-option-sms', 'copy-option-decline']);
  });

  it('what_leaves_the_device_is_an_option_key_and_never_an_address', async () => {
    renderComplete();
    await screen.findByTestId('copy-offer');

    fireEvent.click(screen.getByTestId('copy-option-sms'));
    await waitFor(() => expect(requestCopy).toHaveBeenCalled());

    // Two arguments: the agreement, and the key. Hard rule 9 on the wire.
    expect(requestCopy).toHaveBeenCalledWith(AGREEMENT_ID, 'sms');
    const sent = JSON.stringify(requestCopy.mock.calls);
    expect(sent).not.toContain('•');
    expect(sent).not.toContain('@');
  });

  it('says where the copy went, in the channel the server confirmed', async () => {
    requestCopy.mockResolvedValue({ channel: 'sms', queued: true });
    renderComplete();
    await screen.findByTestId('copy-offer');

    fireEvent.click(screen.getByTestId('copy-option-sms'));
    const sent = await screen.findByTestId('copy-sent');
    expect(sent.textContent).toBe(strings.complete.copy.sentSms);
    // Announced, not only drawn (WCAG 2.2 AA).
    expect(sent.getAttribute('aria-live')).toBe('polite');
  });

  it('a_declined_copy_leaves_the_ceremony_complete', async () => {
    renderComplete();
    await screen.findByTestId('copy-offer');

    fireEvent.click(screen.getByTestId('copy-option-decline'));

    const declined = await screen.findByTestId('copy-declined');
    expect(declined.textContent).toBe(strings.complete.copy.declined);
    // Nothing was sent, and the ceremony is exactly as finished as it was.
    expect(requestCopy).not.toHaveBeenCalled();
    expect(screen.getByTestId('complete-heading')).toBeTruthy();
    expect(screen.getByTestId('complete-done')).toBeTruthy();
  });

  it('a_failed_copy_send_never_blocks_the_ceremony', async () => {
    requestCopy.mockRejectedValue(new Error('provider down'));
    const onDone = vi.fn();
    renderComplete({ onDone });
    await screen.findByTestId('copy-offer');

    fireEvent.click(screen.getByTestId('copy-option-email'));

    const failed = await screen.findByTestId('copy-failed');
    // Hard rule 8: it says so once, points at reception, and the agreement is
    // signed either way. Done is still a live control.
    expect(failed.textContent).toBe(strings.complete.copy.failed);
    fireEvent.click(screen.getByTestId('complete-done'));
    expect(onDone).toHaveBeenCalled();
  });

  it('a_missing_contact_sends_the_patient_to_reception_not_to_a_text_box', async () => {
    fetchCopyOffer.mockResolvedValue({
      channels: [],
      declineKey: 'not_now',
      unavailable: 'no_contact_on_file',
      version: OFFER.version,
    });
    const { container } = renderComplete();

    const line = await screen.findByTestId('copy-unavailable');
    expect(line.textContent).toBe(strings.complete.copy.reasons.no_contact_on_file);
    expect(line.textContent).toMatch(/Reception/);
    // And still no box (D-2026-09-11-03) — this is the branch where one would
    // be most tempting.
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('shows an unmapped reason code rather than a generic sentence', async () => {
    fetchCopyOffer.mockResolvedValue({
      channels: [],
      declineKey: 'not_now',
      unavailable: 'some_future_reason',
      version: OFFER.version,
    });
    renderComplete();

    const line = await screen.findByTestId('copy-unavailable');
    // A generic fallback is a defect (Carl, 4 Sep 2026). The code shows.
    expect(line.textContent).toContain('some_future_reason');
  });

  it('an offer that could not be fetched does not claim there is no contact', async () => {
    fetchCopyOffer.mockRejectedValue(new Error('network'));
    renderComplete();

    const line = await screen.findByTestId('copy-unavailable');
    expect(line.textContent).toBe(strings.complete.copy.offerUnavailable);
    expect(screen.getByTestId('complete-heading')).toBeTruthy();
  });

  it('makes no offer at all when no agreement reached this screen', async () => {
    renderComplete({ agreementId: null });
    await screen.findByTestId('complete-heading');
    expect(fetchCopyOffer).not.toHaveBeenCalled();
    expect(screen.queryByTestId('copy-offer')).toBeNull();
  });

  it('kiosk_persists_nothing_but_pairing_when_a_copy_is_offered', async () => {
    renderComplete();
    await screen.findByTestId('copy-offer');
    fireEvent.click(screen.getByTestId('copy-option-email'));
    await screen.findByTestId('copy-sent');

    // CLAUDE.md §7. The masked contact, the option and the outcome live in
    // component state for the seconds the screen is up and are written
    // nowhere; the only key the kiosk may ever write is the pairing one.
    for (const store of [window.localStorage, window.sessionStorage]) {
      const keys = Object.keys(store);
      expect(keys.filter((key) => key !== PAIRING_CREDENTIAL_KEY)).toEqual([]);
    }
  });
});
