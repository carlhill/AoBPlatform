/**
 * MEDICARE CLAIM NOTICES — the one card with money on it, and the one card
 * that must ask for nothing.
 *
 * `portal_notices_are_one_way` is hard rule 7 (REQ-END-05, REQ-CHASE-02,
 * FR-6.3): a reg 89AA notice never gates payment, never carries approval
 * semantics in copy or UI, and is never chased. A control here would be a
 * regulatory defect, not a UX preference — so the test asserts there is not one
 * and that no word on the card implies one.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoticesCard } from './NoticesCard';
import type { PortalNotice } from '../api';

const notice: PortalNotice = {
  id: 'n-1',
  date: '2026-08-20',
  providerName: 'Dr Robin Example',
  practiceName: 'Wattle Street Medical',
  benefitAmountCents: 4285,
};

const ready = (data: readonly PortalNotice[]) => ({ status: 'ready', data }) as const;

describe('portal_notices_are_one_way', () => {
  it('offers no control at all — nothing to approve, decline, or respond to', () => {
    const view = render(<NoticesCard state={ready([notice])} />);

    expect(view.container.querySelectorAll('button')).toHaveLength(0);
    expect(view.container.querySelectorAll('input')).toHaveLength(0);

    const text = (document.body.textContent ?? '').toLowerCase();
    for (const word of ['approve', 'approval', 'decline', 'accept', 'reject', 'pending', 'awaiting', 'respond', 'confirm']) {
      expect(text).not.toContain(word);
    }
  });

  it('says plainly that there is nothing to do', () => {
    render(<NoticesCard state={ready([notice])} />);
    expect(screen.getByText(/nothing for you to do/)).toBeTruthy();
  });
});

describe('the amount', () => {
  it('is shown in AUD, and this is the only card that shows one', () => {
    render(<NoticesCard state={ready([notice])} />);
    expect(screen.getByTestId('notice-amount-n-1').textContent).toBe('$42.85');
  });

  it('is shown per notice, with the provider, practice and date', () => {
    render(<NoticesCard state={ready([notice])} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Dr Robin Example');
    expect(text).toContain('Wattle Street Medical');
    expect(text).toContain('20 August 2026');
  });

  it('says so when it is loading, when it failed, and when there are none', () => {
    const loading = render(<NoticesCard state={{ status: 'loading' }} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<NoticesCard state={{ status: 'error' }} />);
    expect(failed.container.querySelector('[role="alert"]')).toBeTruthy();
    failed.unmount();

    const empty = render(<NoticesCard state={ready([])} />);
    expect(empty.container.textContent).toContain('No claim notices yet');
  });
});
