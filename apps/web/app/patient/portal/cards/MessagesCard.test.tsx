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
