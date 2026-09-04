/**
 * PEOPLE WHO ACT FOR ME, AND PEOPLE I ACT FOR (REQ-PORT-07, FR-1.19/-1.23).
 *
 * `portal_revoke_asks_for_no_reason` is the one that matters. A patient may
 * withdraw somebody's authority at any time and does not have to justify it; a
 * "why?" field would be the platform asking a person to account for a decision
 * that is entirely theirs, and where a relationship has gone wrong it would be
 * unsafe as well as rude.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PeopleCard } from './PeopleCard';
import type { PortalAssignors } from '../api';

const both: PortalAssignors = {
  actsForMe: [
    { assignorId: 'asg-1', name: 'Kim Sample', relationshipKey: 'spouse', since: '2026-07-15', active: true },
  ],
  iActFor: [
    { patientId: 'pat-9', practiceName: 'Wattle Street Medical', givenNames: 'Frankie', since: '2026-03-02' },
  ],
};

const ready = (data: PortalAssignors) => ({ status: 'ready', data }) as const;

describe('portal_revoke_asks_for_no_reason', () => {
  it('confirms, says no reason is needed, and offers no field to give one', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    render(<PeopleCard state={ready(both)} onRevoke={onRevoke} />);

    fireEvent.click(screen.getByText('Remove'));
    expect(onRevoke).not.toHaveBeenCalled();

    expect(await screen.findByText('You do not need to give a reason.')).toBeTruthy();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    expect(document.querySelectorAll('input')).toHaveLength(0);

    fireEvent.click(screen.getByText('Remove them'));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith('asg-1'));
    // The whole call: one id. No reason, no note.
    expect(onRevoke.mock.calls[0]).toHaveLength(1);
    expect(await screen.findByText('Removed.')).toBeTruthy();
  });
});

describe('both directions', () => {
  it('shows who acts for me with their relationship, and who I act for', () => {
    render(<PeopleCard state={ready(both)} onRevoke={vi.fn()} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('People who can act for me');
    expect(text).toContain('Kim Sample');
    expect(text).toContain('Spouse');
    expect(text).toContain('since 15 July 2026');

    expect(text).toContain('People I act for');
    expect(text).toContain('Frankie');
    expect(text).toContain('Wattle Street Medical');
  });

  it('offers no control on the people I act for — that authority is unpicked with the practice', () => {
    const oneWay: PortalAssignors = { actsForMe: [], iActFor: both.iActFor };
    const view = render(<PeopleCard state={ready(oneWay)} onRevoke={vi.fn()} />);
    expect(view.container.querySelectorAll('button')).toHaveLength(0);
  });

  it('shows an unmapped relationship key as its own code', () => {
    const odd: PortalAssignors = {
      actsForMe: [{ assignorId: 'asg-2', name: 'Jo Sample', relationshipKey: 'neighbour', since: '2026-01-01', active: true }],
      iActFor: [],
    };
    render(<PeopleCard state={ready(odd)} onRevoke={vi.fn()} />);
    expect(screen.getByText('neighbour').tagName).toBe('CODE');
  });

  it('says so when it is loading, when it failed, and when both lists are empty', () => {
    const loading = render(<PeopleCard state={{ status: 'loading' }} onRevoke={vi.fn()} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<PeopleCard state={{ status: 'error' }} onRevoke={vi.fn()} />);
    expect(failed.container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    failed.unmount();

    const empty = render(<PeopleCard state={ready({ actsForMe: [], iActFor: [] })} onRevoke={vi.fn()} />);
    expect(empty.container.textContent).toContain('Nobody acts for you');
    expect(empty.container.textContent).toContain('You do not act for anybody');
  });
});
