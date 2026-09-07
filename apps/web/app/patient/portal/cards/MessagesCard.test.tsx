/**
 * MESSAGES SENT TO ME — and the anti-phishing strip that is the reason
 * REQ-PORT-06 exists.
 *
 * `portal_messages_answer_is_this_genuine` asserts the two things that make the
 * check work: the things still waiting appear FIRST, in their own named region,
 * and the sentence that tells the reader what the listing proves is beside
 * them. A message body is never shown, because a page carrying copies of
 * messages would itself become worth phishing.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessagesCard } from './MessagesCard';
import type { PortalMessage } from '../api';

const waiting: PortalMessage = {
  id: 'm-1',
  channel: 'sms',
  sentAt: '2026-09-03T22:05:00.000Z',
  state: 'delivered',
  purposeKey: 'signature_request',
  practiceName: 'Wattle Street Medical',
  pending: true,
};

const done: PortalMessage = {
  id: 'm-2',
  channel: 'email',
  sentAt: '2026-08-19T02:45:00.000Z',
  state: 'delivered',
  purposeKey: 'agreement_copy',
  practiceName: 'Harbourview Family Practice',
  pending: false,
};

const ready = (data: readonly PortalMessage[]) => ({ status: 'ready', data }) as const;

describe('portal_messages_answer_is_this_genuine', () => {
  it('puts what is waiting first, in its own region, with the sentence that makes it a check', () => {
    const view = render(<MessagesCard state={ready([done, waiting])} />);

    const region = view.container.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    expect(region?.textContent).toContain('Waiting for you');
    expect(region?.textContent).toContain('Asking you to sign an agreement');
    expect(region?.textContent).toContain('Is this message genuine?');
    expect(region?.textContent).toContain('If it is listed here, it came from your practice through AoBPlatform.');

    // And the settled one is NOT in it — the strip is only what is outstanding.
    expect(region?.textContent).not.toContain('Harbourview');

    // The region is named by its own heading, so it can be jumped to.
    expect(region?.getAttribute('aria-labelledby')).toBe('portal-messages-waiting');
  });

  it('portal_messages_card_shows_the_record_id', () => {
    /*
     * THE CHECK A PATIENT CAN ACTUALLY DO, on their phone, to a message we
     * never see: the id here is the id in the header of this page and the id
     * their password manager shows beside the passkey. A message about their
     * record that does not quote it is not ours.
     */
    const id = 'AoBPlatform-PatientId-11111111-2222-3333-4444-555555555555';
    const view = render(<MessagesCard state={ready([done, waiting])} recordId={id} />);
    const line = view.getByTestId('portal-messages-record-id').textContent ?? '';
    expect(line).toContain(`Every genuine message from us quotes your record ID ${id}`);
    expect(line).toContain('If a message about your record does not, do not act on it — ask your practice.');
  });

  it('draws no record-id line while the id is unknown', () => {
    // Better no sentence than one telling somebody to check for something we
    // did not show them.
    const view = render(<MessagesCard state={ready([done])} />);
    expect(view.queryByTestId('portal-messages-record-id')).toBeNull();
  });

  it('shows no strip when nothing is waiting', () => {
    const view = render(<MessagesCard state={ready([done])} />);
    expect(view.container.querySelector('[role="region"]')).toBeNull();
    expect(view.container.textContent).toContain('Your copy of an agreement');
  });

  it('shows channel, time and state — and never a message body', () => {
    const view = render(<MessagesCard state={ready([done])} />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Email');
    expect(text).toContain('Delivered');
    expect(text).toContain('2026');
    expect(text).toContain('We do not keep a copy of what it said');
  });

  it('shows an unmapped purpose or channel as its own code', () => {
    render(<MessagesCard state={ready([{ ...done, purposeKey: 'brand_new_purpose', channel: 'pigeon' }])} />);
    expect(screen.getByText('brand_new_purpose').tagName).toBe('CODE');
    expect(screen.getByText('pigeon').tagName).toBe('CODE');
  });

  it('says so when it is loading, when it failed, and when there are none', () => {
    const loading = render(<MessagesCard state={{ status: 'loading' }} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<MessagesCard state={{ status: 'error' }} />);
    expect(failed.container.querySelector('[role="alert"]')).toBeTruthy();
    failed.unmount();

    const empty = render(<MessagesCard state={ready([])} />);
    expect(empty.container.textContent).toContain('No messages yet');
  });
});
