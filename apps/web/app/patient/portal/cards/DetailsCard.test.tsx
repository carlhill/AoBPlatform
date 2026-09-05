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

/**
 * RECONCILIATION — when two practices hold different things (Carl, 5 Sep 2026).
 *
 * The card's whole reason for existing is that two practices can disagree. The
 * notice is what turns that from a spot-the-difference puzzle into a sentence,
 * and the tag is what tells the patient WHICH practice to ask — which is the
 * only action available to them.
 *
 * THE COSMETIC TEST IS THE IMPORTANT ONE. A comparison that fires on "St" and
 * "Street" would send patients to reception about differences that do not
 * exist, and would teach them to ignore the notice on the day it is right.
 */
describe('portal_details_flag_differing_addresses_across_practices', () => {
  const harbourview: PortalDetails = {
    ...practice,
    practiceId: 'prac-2',
    practiceName: 'Harbourview Family Practice',
    address: '3/40 Older Address Road, Testville NSW 2000',
  };

  it('names the detail and both practices, without printing either value again', () => {
    render(<DetailsCard state={ready([practice, harbourview])} onRequestCorrection={vi.fn()} />);

    const notice = screen.getByTestId('portal-details-reconciliation');
    expect(notice.textContent).toContain('Your practices hold different details for you.');
    expect(notice.textContent).toContain(
      'Address: Wattle Street Medical has one address, Harbourview Family Practice has another.',
    );

    // THE VALUES ARE NOT REPEATED. Both are already on screen in the blocks
    // below; saying them twice is what makes a notice like this unreadable.
    expect(notice.textContent).not.toContain('12 Example Street');
    expect(notice.textContent).not.toContain('Older Address Road');

    // ONE LINE, because only the address differs.
    expect(notice.querySelectorAll('li')).toHaveLength(1);
  });

  it('tags the address in each block with the practice it differs from', () => {
    render(<DetailsCard state={ready([practice, harbourview])} onRequestCorrection={vi.fn()} />);

    expect(screen.getByTestId('detail-prac-1-address-differs').textContent).toBe(
      'Differs from Harbourview Family Practice',
    );
    expect(screen.getByTestId('detail-prac-2-address-differs').textContent).toBe(
      'Differs from Wattle Street Medical',
    );

    // AND NOTHING ELSE IS TAGGED — the other four details agree.
    expect(screen.queryByTestId('detail-prac-1-name-differs')).toBeNull();
    expect(screen.queryByTestId('detail-prac-1-mobile-differs')).toBeNull();
    expect(screen.queryByTestId('detail-prac-1-email-differs')).toBeNull();
    expect(screen.queryByTestId('detail-prac-1-date_of_birth-differs')).toBeNull();

    // The way to fix it is still the link that was always there, beside the tag.
    expect(screen.getAllByText('Ask the practice to correct this').length).toBeGreaterThan(0);
  });

  it('reads five named fields and no others, so it can never compare a Medicare number', () => {
    // The same defence as `portal_details_never_show_medicare`, applied to the
    // comparison: it walks FIELDS, so a payload that grew a card number has
    // nothing here that would read it — let alone announce that two practices
    // hold different ones.
    const sneaky = { ...practice, medicare: '1111 11111 1' } as unknown as PortalDetails;
    const otherSneaky = {
      ...harbourview,
      address: practice.address,
      medicare: '2222 22222 2',
    } as unknown as PortalDetails;

    render(<DetailsCard state={ready([sneaky, otherSneaky])} onRequestCorrection={vi.fn()} />);

    expect(screen.queryByTestId('portal-details-reconciliation')).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('medicare');
  });

  it('says the weaker sentence for three practices, because two of them may agree', () => {
    const third: PortalDetails = {
      ...practice,
      practiceId: 'prac-3',
      practiceName: 'Cove Road Medical',
      address: '7 Third Street, Testville NSW 2000',
    };
    render(<DetailsCard state={ready([practice, harbourview, third])} onRequestCorrection={vi.fn()} />);

    expect(screen.getByTestId('portal-details-reconciliation').textContent).toContain(
      'Address: Wattle Street Medical, Harbourview Family Practice and Cove Road Medical do not all hold the same address.',
    );
    expect(screen.getByTestId('detail-prac-1-address-differs').textContent).toBe(
      'Differs from 2 of your other practices',
    );
  });

  it('treats a blank as a gap rather than a disagreement', () => {
    // One practice holds an email and the other holds none. "One has one email,
    // the other has another" would be false, and there is nothing to reconcile.
    const noEmail: PortalDetails = { ...harbourview, address: practice.address, email: '' };
    render(<DetailsCard state={ready([practice, noEmail])} onRequestCorrection={vi.fn()} />);

    expect(screen.queryByTestId('portal-details-reconciliation')).toBeNull();
    expect(screen.getByTestId('detail-prac-2-email').textContent).toBe('Not held');
  });
});

describe('portal_details_do_not_flag_cosmetic_address_differences', () => {
  it('reads "2 Example St" and "2 Example Street" as one address', () => {
    const abbreviated: PortalDetails = {
      ...practice,
      practiceId: 'prac-2',
      practiceName: 'Harbourview Family Practice',
      address: '12 example st., testville  nsw 2000',
    };
    render(<DetailsCard state={ready([practice, abbreviated])} onRequestCorrection={vi.fn()} />);

    expect(screen.queryByTestId('portal-details-reconciliation')).toBeNull();
    expect(screen.queryByTestId('detail-prac-1-address-differs')).toBeNull();
  });

  it('ignores case, spacing and phone-number punctuation on the other details', () => {
    const cosmetic: PortalDetails = {
      ...practice,
      practiceId: 'prac-2',
      practiceName: 'Harbourview Family Practice',
      givenNames: '  ALEX  ',
      mobile: '0400-000-001',
      email: 'ALEX@example.invalid',
    };
    render(<DetailsCard state={ready([practice, cosmetic])} onRequestCorrection={vi.fn()} />);

    expect(screen.queryByTestId('portal-details-reconciliation')).toBeNull();
  });

  it('still flags a real difference in the same field', () => {
    const moved: PortalDetails = {
      ...practice,
      practiceId: 'prac-2',
      practiceName: 'Harbourview Family Practice',
      address: '14 Example Street, Testville NSW 2000',
    };
    render(<DetailsCard state={ready([practice, moved])} onRequestCorrection={vi.fn()} />);

    expect(screen.getByTestId('portal-details-reconciliation')).toBeTruthy();
  });
});

describe('portal_single_practice_shows_no_reconciliation', () => {
  it('says nothing about differences when there is only one practice to compare', () => {
    render(<DetailsCard state={ready([practice])} onRequestCorrection={vi.fn()} />);

    expect(screen.queryByTestId('portal-details-reconciliation')).toBeNull();
    expect(document.body.textContent).not.toContain('Your practices hold different details');
    expect(document.body.textContent).not.toContain('Differs from');
  });
});
