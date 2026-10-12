/**
 * WHERE I HAVE BEEN — dates and places, and the sentence that stops it reading
 * like a medical history.
 *
 * `portal_visits_claim_nothing_clinical` guards CLAUDE.md §8: this product
 * holds no clinical data of any kind, and a bare list of practices and dates is
 * exactly the shape of something that does.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisitsCard } from './VisitsCard';
import type { PortalVisit } from '../api';

const visit: PortalVisit = {
  date: '2026-08-19',
  practiceName: 'Harbourview Family Practice',
  locationLine: 'Harbourview rooms, Testville',
};

const ready = (data: readonly PortalVisit[]) => ({ status: 'ready', data }) as const;

describe('portal_visits_claim_nothing_clinical', () => {
  it('says what the list is, and what it is not', () => {
    render(<VisitsCard state={ready([visit])} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('Visits where a bulk-billing agreement was made');
    expect(text).toContain('This is not a medical record');
    // Nothing clinical is even named.
    expect(text.toLowerCase()).not.toMatch(/diagnos|treatment|condition|prescri|symptom/);
  });

  it('shows the date, the practice and where it was', () => {
    render(<VisitsCard state={ready([visit])} />);
    expect(screen.getByText('Harbourview Family Practice')).toBeTruthy();
    expect(screen.getByText('Harbourview rooms, Testville')).toBeTruthy();
    expect(screen.getByText('19 August 2026')).toBeTruthy();
  });

  it('says so when it is loading, when it failed, and when there are none', () => {
    const loading = render(<VisitsCard state={{ status: 'loading' }} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<VisitsCard state={{ status: 'error' }} />);
    expect(failed.container.querySelector('[role="alert"]')).toBeTruthy();
    failed.unmount();

    const empty = render(<VisitsCard state={ready([])} />);
    expect(empty.container.textContent).toContain('No visits recorded');
  });
});
