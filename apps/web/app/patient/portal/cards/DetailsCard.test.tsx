/**
 * MY DETAILS — the card that must never grow a Medicare number.
 *
 * `portal_details_never_show_medicare` is the named test for hard rule 1
 * (REQ-VER-02, CLAUDE.md §2). It does not assert that a filter strips the
 * field; it asserts the stronger thing — that the card renders from a fixed
 * list of six named fields, so a payload carrying a Medicare number finds
 * nothing here that reads it. A filter can be forgotten on the next field
 * somebody adds; an allow-list cannot.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DetailsCard } from './DetailsCard';
import type { PortalDetails } from '../api';

const practice: PortalDetails = {
  practiceId: 'prac-1',
  practiceName: 'Wattle Street Medical',
  familyName: 'Sample',
  givenNames: 'Alex',
  dateOfBirth: '1984-02-29',
  address: '12 Example Street, Testville NSW 2000',
  mobile: '0400 000 001',
  email: 'alex@example.invalid',
  patientRecordNumber: 'WSM-000123',
};

const ready = (data: readonly PortalDetails[]) => ({ status: 'ready', data }) as const;

describe('portal_details_never_show_medicare', () => {
  it('renders nothing from a payload field the card does not know about', () => {
    // A payload that has grown a card number, which the contract does not have
    // and must never have. The card is handed it anyway.
    const sneaky = {
      ...practice,
      medicare: '0000 00000 0',
      medicareIrn: '1',
    } as unknown as PortalDetails;

    render(<DetailsCard state={ready([sneaky])} onRequestCorrection={vi.fn()} />);

    expect(document.body.textContent).not.toContain('0000 00000 0');
    expect(document.body.textContent?.toLowerCase()).not.toContain('medicare');
  });

  it('shows the five details and the practice record number, and nothing else', () => {
    render(<DetailsCard state={ready([practice])} onRequestCorrection={vi.fn()} />);

    expect(screen.getByTestId('detail-prac-1-name').textContent).toBe('Alex Sample');
    expect(screen.getByTestId('detail-prac-1-address').textContent).toContain('12 Example Street');
    expect(screen.getByTestId('detail-prac-1-mobile').textContent).toBe('0400 000 001');
    expect(screen.getByTestId('detail-prac-1-email').textContent).toBe('alex@example.invalid');
    expect(screen.getByTestId('detail-prac-1-date_of_birth').textContent).toContain('1984');
    expect(document.body.textContent).toContain('WSM-000123');
  });
});

describe('asking a practice to correct a detail', () => {
  it('confirms first, sends no new value, and says the practice will confirm it', async () => {
    const onRequestCorrection = vi.fn().mockResolvedValue(undefined);
    render(<DetailsCard state={ready([practice])} onRequestCorrection={onRequestCorrection} />);

    // Nothing has been sent by opening the dialog.
    fireEvent.click(screen.getAllByText('Ask the practice to correct this')[2]);
    expect(onRequestCorrection).not.toHaveBeenCalled();
    expect(await screen.findByText(/We do not send them a new value/)).toBeTruthy();

    fireEvent.click(screen.getByText('Ask them to correct it'));

    await waitFor(() => expect(onRequestCorrection).toHaveBeenCalledWith('prac-1', 'address'));
    // The whole call: a practice and a field type. No value, and no third argument.
    expect(onRequestCorrection.mock.calls[0]).toHaveLength(2);
    expect(await screen.findByText(/They will confirm the correct value with you/)).toBeTruthy();
  });

  it('shows a per-practice group, because two practices can hold different details', () => {
    const other: PortalDetails = { ...practice, practiceId: 'prac-2', practiceName: 'Harbourview Family Practice', address: '3/40 Older Address Road' };
    render(<DetailsCard state={ready([practice, other])} onRequestCorrection={vi.fn()} />);

    expect(screen.getByText('Wattle Street Medical')).toBeTruthy();
    expect(screen.getByText('Harbourview Family Practice')).toBeTruthy();
    expect(screen.getByTestId('detail-prac-2-address').textContent).toContain('Older Address Road');
  });

  it('says so when it is loading, when it failed, and when there is nothing', () => {
    const loading = render(<DetailsCard state={{ status: 'loading' }} onRequestCorrection={vi.fn()} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<DetailsCard state={{ status: 'error' }} onRequestCorrection={vi.fn()} />);
    expect(failed.container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    failed.unmount();

    const empty = render(<DetailsCard state={ready([])} onRequestCorrection={vi.fn()} />);
    expect(empty.container.textContent).toContain('No practice details');
  });
});
