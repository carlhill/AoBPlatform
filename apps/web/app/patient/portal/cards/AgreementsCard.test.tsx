/**
 * MY AGREEMENTS — and the money that must never reach it.
 *
 * `portal_agreements_show_no_amount` is the named test for hard rule 4
 * (REQ-REG-04). Like the details card, it asserts the structural version: the
 * card is handed a payload carrying an amount and renders nothing from it,
 * because there is no field here that reads one. The 89AA notices card is the
 * one place in the product where a benefit amount belongs.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgreementsCard } from './AgreementsCard';
import type { PortalAgreement } from '../api';

const signed: PortalAgreement = {
  id: 'agr-1',
  practiceName: 'Wattle Street Medical',
  providerName: 'Dr Robin Example',
  type: 'episodic',
  status: 'stored',
  serviceDate: '2026-08-19',
  serviceDescription: 'Standard consultation',
  channel: 'remote_link',
  signedAt: '2026-08-19T02:41:00.000Z',
  artefactAvailable: true,
};

const ready = (data: readonly PortalAgreement[]) => ({ status: 'ready', data }) as const;

describe('portal_agreements_show_no_amount', () => {
  it('renders no amount even when the payload carries one', () => {
    const withMoney = {
      ...signed,
      benefitAmountCents: 4285,
      scheduleFee: '$42.85',
    } as unknown as PortalAgreement;

    render(<AgreementsCard state={ready([withMoney])} />);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('$');
    expect(text).not.toContain('42.85');
    expect(text).not.toContain('4285');
    // And no word that would invite one.
    expect(text.toLowerCase()).not.toMatch(/benefit|fee|amount|rebate/);
  });

  it('offers no way to end an agreement — termination belongs to the enduring card only', () => {
    render(<AgreementsCard state={ready([{ ...signed, type: 'enduring' }])} />);
    expect(screen.queryByText(/End this agreement/)).toBeNull();
  });
});

describe('the agreements list', () => {
  it('shows who, where, when, what and how, in the patient’s own words', () => {
    render(<AgreementsCard state={ready([signed])} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('Dr Robin Example');
    expect(text).toContain('Wattle Street Medical');
    expect(text).toContain('For one visit');
    expect(text).toContain('Standard consultation');
    expect(text).toContain('Signed from a link we sent you');
    expect(text).toContain('Signed and stored');
    expect(text).toContain('19 August 2026');
  });

  it('links to the copy as signed only when there is one', () => {
    const view = render(<AgreementsCard state={ready([signed])} />);
    const link = view.container.querySelector('a');
    expect(link?.getAttribute('href')).toContain('/portal/agreements/agr-1/artefact');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    view.unmount();

    const unsigned = render(
      <AgreementsCard state={ready([{ ...signed, id: 'agr-2', artefactAvailable: false, signedAt: null }])} />,
    );
    expect(unsigned.container.querySelector('a')).toBeNull();
    expect(unsigned.container.textContent).toContain('Not signed yet');
  });

  it('shows an unmapped status as its own code rather than as nothing', () => {
    render(<AgreementsCard state={ready([{ ...signed, status: 'some_new_state' }])} />);
    expect(screen.getByText('some_new_state').tagName).toBe('CODE');
  });

  it('says so when it is loading, when it failed, and when there is nothing', () => {
    const loading = render(<AgreementsCard state={{ status: 'loading' }} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<AgreementsCard state={{ status: 'error' }} />);
    expect(failed.container.querySelector('[role="alert"]')).toBeTruthy();
    failed.unmount();

    const empty = render(<AgreementsCard state={ready([])} />);
    expect(empty.container.textContent).toContain('No agreements yet');
  });
});
