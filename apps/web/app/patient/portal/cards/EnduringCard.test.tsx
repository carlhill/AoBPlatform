/**
 * ENDING AN ONGOING AGREEMENT — the one control on this page with a statute
 * behind it (REQ-PORT-05, REQ-END-06, FR-5.3).
 *
 * The assertions here are about WORDS as much as behaviour, because the words
 * are the requirement: two business days, and a written notice. Both come from
 * the regulation and neither may drift into something a designer preferred.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EnduringCard } from './EnduringCard';
import type { PortalEnduring } from '../api';

const agreement: PortalEnduring = {
  agreementId: 'agr-1',
  practiceName: 'Wattle Street Medical',
  providerName: 'Dr Robin Example',
  activeSince: '2026-07-15',
};

const ready = (data: readonly PortalEnduring[]) => ({ status: 'ready', data }) as const;

describe('ongoing agreements are shown per provider, with a plain-language explanation', () => {
  it('names the provider, not the practice, as the party', () => {
    render(<EnduringCard state={ready([agreement])} onTerminate={vi.fn()} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('Dr Robin Example');
    expect(text).toContain('These are with one provider each, not with the practice');
    expect(text).toContain('In place since 15 July 2026');
    expect(text).toContain('Dr Robin Example bulk bills you for the services it covers');
  });

  it('carries no amount — hard rule 4 applies here too', () => {
    render(<EnduringCard state={ready([agreement])} onTerminate={vi.fn()} />);
    expect(document.body.textContent ?? '').not.toContain('$');
  });
});

describe('portal_enduring_termination_states_two_business_days', () => {
  it('confirms first, and the dialog says both things the regulation requires', async () => {
    const onTerminate = vi.fn().mockResolvedValue({ noticeId: 'n-1', effectiveAt: '2026-09-07T00:00:00.000Z' });
    render(<EnduringCard state={ready([agreement])} onTerminate={onTerminate} />);

    fireEvent.click(screen.getByText('End this agreement'));
    expect(onTerminate).not.toHaveBeenCalled();

    expect(await screen.findByText('It ends two business days from now.')).toBeTruthy();
    expect(screen.getByText('We will send you a written notice, and tell the practice.')).toBeTruthy();
    // Hard rule 8 — nothing on this page may imply care is at stake.
    expect(screen.getByText(/does not affect your appointments or your care/)).toBeTruthy();
  });

  it('shows when it stops, taken from the server rather than assumed', async () => {
    const onTerminate = vi.fn().mockResolvedValue({ noticeId: 'n-1', effectiveAt: '2026-09-07T00:00:00.000Z' });
    render(<EnduringCard state={ready([agreement])} onTerminate={onTerminate} />);

    fireEvent.click(screen.getByText('End this agreement'));
    fireEvent.click(screen.getAllByText('End this agreement').slice(-1)[0]);

    await waitFor(() => expect(onTerminate).toHaveBeenCalledWith('agr-1'));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Ends');
    expect(status.textContent).toContain('2026');
  });

  it('a failed termination says nothing has changed, and leaves the dialog open', async () => {
    const onTerminate = vi.fn().mockRejectedValue(new Error('nope'));
    render(<EnduringCard state={ready([agreement])} onTerminate={onTerminate} />);

    fireEvent.click(screen.getByText('End this agreement'));
    fireEvent.click(screen.getAllByText('End this agreement').slice(-1)[0]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nothing has changed');
  });

  it('says so when it is loading, when it failed, and when there are none', () => {
    const loading = render(<EnduringCard state={{ status: 'loading' }} onTerminate={vi.fn()} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<EnduringCard state={{ status: 'error' }} onTerminate={vi.fn()} />);
    expect(failed.container.querySelector('[role="alert"]')).toBeTruthy();
    failed.unmount();

    const empty = render(<EnduringCard state={ready([])} onTerminate={vi.fn()} />);
    expect(empty.container.textContent).toContain('no ongoing agreements');
    expect(empty.queryByText('End this agreement')).toBeNull();
  });
});
