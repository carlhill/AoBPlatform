/**
 * THE BILLING ROLE ON THE AFFILIATION SCREEN (Carl, 5–7 Sep 2026; TODO.md
 * "Billing role on the affiliation").
 *
 * WHY THIS PAGE HAS A TEST AT ALL NOW. It could not be seen without a passkey
 * (hard rule 15), so its first render of a new control would otherwise happen
 * in front of a practice. And the control decides who may be named as the
 * provider on a consent record, which is not a thing to eyeball once.
 *
 * WHAT IT PINS:
 *
 *  - THE LIST IS THE SERVER'S, IN THE SERVER'S ORDER. The screen renders the
 *    versioned content file and never carries the list itself (CLAUDE.md §7),
 *    so a role added to the file appears here with no code change — and a role
 *    this build has no words for shows its key rather than vanishing.
 *  - CHANGING IT POSTS THE ROLE, and nothing else.
 *  - CARL'S SECOND RULING IS ON THE SCREEN: a servicing provider with no
 *    provider number is ALLOWED and FLAGGED, and the flag says what will
 *    happen instead — name and practice address (s 65C(5)(a)).
 *  - The flag is NOT shown for a role that would not hold a number anyway.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AffiliationsView } from './AffiliationsView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';
const DOCTOR = 'aff-doctor';
const NURSE = 'aff-nurse';

const ROLES = {
  version: 'billing-roles-2026-09-1',
  roles: [
    { key: 'servicing_provider', mayBeProviderOnAgreement: true },
    { key: 'works_under_provider', mayBeProviderOnAgreement: false },
    { key: 'not_billable', mayBeProviderOnAgreement: false },
  ],
};

const AFFILIATIONS = [
  {
    id: DOCTOR,
    status: 'active',
    practitioner: {
      practitionerId: 'p-1',
      familyName: 'Example',
      givenNames: 'Sam',
      ahpraNumber: 'MED0001111111',
    },
    location: { id: 'loc-1', address: '1 Test Street, Testville NSW 2000', code: 'MAIN' },
    department: null,
    // Carl's second ruling: allowed, and flagged.
    providerNumber: null,
    billingRole: 'servicing_provider',
    startedAt: '2026-09-01T00:00:00.000Z',
    noticeGivenAt: null,
    endsAt: null,
    canCapture: true,
    blockReason: null,
    invitationSentAt: '2026-08-30T00:00:00.000Z',
    invitationExpiresAt: null,
    acceptanceMethod: 'email_link_and_code',
    acceptanceMeans: 'Opened an emailed link and typed the code',
  },
  {
    id: NURSE,
    status: 'active',
    practitioner: {
      practitionerId: 'p-2',
      familyName: 'Example',
      givenNames: 'Nurse',
      ahpraNumber: 'NMW0002222222',
    },
    location: { id: 'loc-1', address: '1 Test Street, Testville NSW 2000', code: 'MAIN' },
    department: null,
    providerNumber: null,
    billingRole: 'works_under_provider',
    startedAt: '2026-09-01T00:00:00.000Z',
    noticeGivenAt: null,
    endsAt: null,
    canCapture: true,
    blockReason: null,
    invitationSentAt: '2026-08-30T00:00:00.000Z',
    invitationExpiresAt: null,
    acceptanceMethod: 'email_link_and_code',
    acceptanceMeans: 'Opened an emailed link and typed the code',
  },
];

const calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch(rows: unknown[] = AFFILIATIONS, roles: unknown = ROLES) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (method !== 'GET') return { ok: true, status: 201, json: async () => ({}) } as unknown as Response;

      const payload = url.includes('/affiliations/billing-roles/catalogue')
        ? roles
        : url.includes('/affiliations/external-notice/catalogue')
          ? { means: [] }
          : url.includes('/affiliations')
            ? rows
            : url.includes('/practitioners')
              ? []
              : [];
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['practice_user'], practiceId: PRACTICE, username: 'Mai Frontdesk' }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
}));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('/practice/affiliations — whose provider number the claim goes under', () => {
  it('offers the billing roles the server sent, in the content file’s own order', async () => {
    stubFetch();
    render(<AffiliationsView practiceId={PRACTICE} />);

    const select = (await screen.findByTestId(`billing-role-${DOCTOR}`)) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      'servicing_provider',
      'works_under_provider',
      'not_billable',
    ]);
    expect([...select.options].map((o) => o.textContent)).toEqual([
      strings.billingRoles.names.servicing_provider,
      strings.billingRoles.names.works_under_provider,
      strings.billingRoles.names.not_billable,
    ]);
    expect(select.value).toBe('servicing_provider');

    const nurse = (await screen.findByTestId(`billing-role-${NURSE}`)) as HTMLSelectElement;
    expect(nurse.value).toBe('works_under_provider');
  });

  /** A list is content: a role added to the file must reach the screen unaided. */
  it('renders a role this build has no words for, showing its key rather than dropping it', async () => {
    stubFetch(AFFILIATIONS, {
      version: 'billing-roles-test-2',
      roles: [
        { key: 'servicing_provider', mayBeProviderOnAgreement: true },
        { key: 'locum_under_supervision', mayBeProviderOnAgreement: false },
      ],
    });
    render(<AffiliationsView practiceId={PRACTICE} />);

    const select = (await screen.findByTestId(`billing-role-${DOCTOR}`)) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain('locum_under_supervision');
    expect(select.textContent).toContain('locum_under_supervision');
  });

  it('changing the role posts only the role', async () => {
    stubFetch();
    render(<AffiliationsView practiceId={PRACTICE} />);

    const select = await screen.findByTestId(`billing-role-${DOCTOR}`);
    fireEvent.change(select, { target: { value: 'works_under_provider' } });

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const posted = calls.find((c) => c.method === 'POST');
    expect(posted?.url).toContain(`/affiliations/${DOCTOR}/billing-role`);
    expect(posted?.body).toEqual({ billingRole: 'works_under_provider' });
  });

  /**
   * CARL'S SECOND RULING. Allowed — s 65C(5)(a) identifies the professional by
   * name and the address of the place of practice — and flagged, in words that
   * say what will happen instead of what is missing.
   */
  it('flags a servicing provider with no provider number, and does not block them', async () => {
    stubFetch();
    render(<AffiliationsView practiceId={PRACTICE} />);

    const flag = await screen.findByTestId(`no-provider-number-${DOCTOR}`);
    expect(flag.textContent).toBe(strings.billingRoles.noProviderNumberNote);
    expect(flag.textContent).toMatch(/name and practice address/i);

    /*
     * A NOTE, NOT A REFUSAL. Nothing about the missing number stops this
     * affiliation being used — the row still offers the practice's own act,
     * and the copy says what happens instead rather than what is missing.
     */
    expect(screen.getByTestId(`affiliation-${DOCTOR}`).textContent ?? '').not.toMatch(/cannot/i);

    // And NOT shown for somebody who would not hold a number anyway.
    expect(screen.queryByTestId(`no-provider-number-${NURSE}`)).toBeNull();
  });

  /** Hard rule 4: nothing on this page carries an amount. */
  it('shows no benefit or dollar amount anywhere', async () => {
    stubFetch();
    const { container } = render(<AffiliationsView practiceId={PRACTICE} />);
    await screen.findByTestId(`billing-role-${DOCTOR}`);
    expect(container.textContent ?? '').not.toMatch(/\$\d/);
  });
});
