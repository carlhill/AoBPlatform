/**
 * THE ROSTER, WITH THE BILLING ROLE AND THE NO-PROVIDER-NUMBER FLAG ON IT
 * (Carl, 5–7 Sep 2026; TODO.md "Billing role on the affiliation").
 *
 * WHY THE ROLE IS READ-ONLY HERE. It is set on the AFFILIATION, because a
 * provider number is issued per practitioner per location and the same person
 * can be a nurse practitioner at one site and an RN at another. This page is
 * about the PERSON, so it shows every role they hold rather than pretending
 * there is one — and it shows them, rather than sending somebody to another
 * screen to find out, because "can an agreement name this person" is a
 * question a practice asks of its roster.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PractitionersView } from './PractitionersView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';
const DOCTOR = 'p-doctor';
const NURSE = 'p-nurse';
const BOTH = 'p-both';

const base = {
  verified: true,
  email: null,
  hasEmail: false,
  invitedByThisPractice: true,
  registrationStatus: 'Registered',
  profession: 'Medical Practitioner',
  conditions: null,
  registrationSightedByName: 'Robin Reviewer',
  registrationSightedAt: '2026-09-01T00:00:00.000Z',
  registrationSource: 'manual',
  registerChecked: true,
  deregisteredAt: null,
};

const ROSTER = [
  {
    ...base,
    practitionerId: DOCTOR,
    familyName: 'Example',
    givenNames: 'Sam',
    ahpraNumber: 'MED0001111111',
    providerType: 'general_practitioner',
    affiliationCount: 1,
    activeAffiliationCount: 1,
    invitedAffiliationCount: 0,
    billingRoles: ['servicing_provider'],
    // Carl's second ruling: allowed, and flagged.
    affiliationsMissingProviderNumber: 1,
  },
  {
    ...base,
    practitionerId: NURSE,
    familyName: 'Example',
    givenNames: 'Nurse',
    ahpraNumber: 'NMW0002222222',
    providerType: 'other',
    affiliationCount: 1,
    activeAffiliationCount: 1,
    invitedAffiliationCount: 0,
    billingRoles: ['works_under_provider'],
    // Not flagged: somebody who bills nothing under their own number is not
    // missing anything by having no number.
    affiliationsMissingProviderNumber: 0,
  },
  {
    ...base,
    practitionerId: BOTH,
    familyName: 'Twoplaces',
    givenNames: 'Kim',
    ahpraNumber: 'NMW0003333333',
    providerType: 'nurse_practitioner',
    affiliationCount: 2,
    activeAffiliationCount: 2,
    invitedAffiliationCount: 0,
    // THE REASON IT IS A LIST. A nurse practitioner at one site, an RN at
    // another — one word for the person would be false about one of them.
    billingRoles: ['servicing_provider', 'works_under_provider'],
    affiliationsMissingProviderNumber: 0,
  },
];

function stubFetch(roster: unknown[] = ROSTER) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'GET') {
        return { ok: true, status: 201, json: async () => ({}) } as unknown as Response;
      }
      const payload = url.includes('/practitioners') ? roster : [];
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['practice_user'], practiceId: PRACTICE, username: 'Mai Frontdesk' }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
}));

beforeEach(() => {
  /* nothing to reset beyond the stubs */
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('/practice/practitioners — the billing role and the provider-number flag', () => {
  it('shows the billing role each practitioner holds', async () => {
    stubFetch();
    render(<PractitionersView practiceId={PRACTICE} />);

    const doctor = await screen.findByTestId(`billing-roles-${DOCTOR}`);
    expect(doctor.textContent).toContain(strings.billingRoles.names.servicing_provider);

    const nurse = await screen.findByTestId(`billing-roles-${NURSE}`);
    expect(nurse.textContent).toContain(strings.billingRoles.names.works_under_provider);
  });

  /** Per location, so a person working at two sites can hold two roles. */
  it('shows every role a practitioner holds rather than flattening them to one', async () => {
    stubFetch();
    render(<PractitionersView practiceId={PRACTICE} />);

    const both = await screen.findByTestId(`billing-roles-${BOTH}`);
    expect(both.textContent).toContain(strings.billingRoles.names.servicing_provider);
    expect(both.textContent).toContain(strings.billingRoles.names.works_under_provider);
  });

  /**
   * CARL'S SECOND RULING. A servicing provider with no provider number
   * recorded is ALLOWED — s 65C(5)(a) identifies the professional by name and
   * the address of the place of practice — and FLAGGED, in words that say what
   * will happen instead of what is missing.
   */
  it('flags a servicing provider with no provider number, and nobody else', async () => {
    stubFetch();
    render(<PractitionersView practiceId={PRACTICE} />);

    const flag = await screen.findByTestId(`no-provider-number-${DOCTOR}`);
    expect(flag.textContent).toBe(strings.billingRoles.noProviderNumberNote);
    expect(flag.textContent).toMatch(/name and practice address/i);

    expect(screen.queryByTestId(`no-provider-number-${NURSE}`)).toBeNull();
    expect(screen.queryByTestId(`no-provider-number-${BOTH}`)).toBeNull();
  });

  it('never shows a provider number itself, and never an amount', async () => {
    stubFetch();
    const { container } = render(<PractitionersView practiceId={PRACTICE} />);
    await screen.findByTestId(`billing-roles-${DOCTOR}`);
    const text = container.textContent ?? '';
    // The roster carries no provider number by construction
    // (`assertNoProviderNumber` on the server); this is the screen's own half.
    expect(text).not.toMatch(/\b\d{6}[0-9A-Z]{2}\b/);
    expect(text).not.toMatch(/\$\d/);
  });
});
