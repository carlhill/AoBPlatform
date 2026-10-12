/**
 * THE PAGE'S STATES — signed out, loading, and one card failing without taking
 * the other eight with it.
 *
 * `portal_one_failed_card_does_not_blank_the_page` is the structural claim the
 * whole design rests on: a patient opens this page precisely when something has
 * gone wrong or looks suspicious, so it has to be the page that still answers
 * when a service behind it does not.
 *
 * `portal_signed_out_says_signing_never_needs_an_account` is REQ-PORT-08 on the
 * one screen that could imply otherwise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortalApiError } from './api';

vi.mock('../../auth', () => ({
  currentSession: () => null,
  apiHeaders: () => ({}),
}));

const api = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  fetchDetails: vi.fn(),
  fetchAgreements: vi.fn(),
  fetchEnduring: vi.fn(),
  fetchNotices: vi.fn(),
  fetchVisits: vi.fn(),
  fetchMessages: vi.fn(),
  fetchAssignors: vi.fn(),
  fetchAccessLog: vi.fn(),
  fetchPasskeys: vi.fn(),
}));

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    ...api,
    requestDetailCorrection: vi.fn(),
    revokeAssignor: vi.fn(),
    terminateEnduring: vi.fn(),
    openDevPortalSession: vi.fn(),
    registerPasskey: vi.fn(),
    revokePasskey: vi.fn(),
    signInWithPasskey: vi.fn(),
    signOut: vi.fn(),
  };
});

import { PortalView } from './PortalView';
import * as actual from './api';

/*
 * The shell's own chrome asks the server which practice a session is acting
 * as. There is no session here and nothing on this page needs the answer, so
 * every request that is not one of the mocked portal calls answers 404 rather
 * than reaching for localhost during a unit run.
 */
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));

function allCardsAnswer() {
  api.fetchSession.mockResolvedValue({ accountId: 'a', links: [] });
  api.fetchDetails.mockResolvedValue([]);
  api.fetchAgreements.mockResolvedValue([]);
  api.fetchEnduring.mockResolvedValue([]);
  api.fetchNotices.mockResolvedValue([]);
  api.fetchVisits.mockResolvedValue([]);
  api.fetchMessages.mockResolvedValue([]);
  api.fetchAssignors.mockResolvedValue({ actsForMe: [], iActFor: [] });
  api.fetchAccessLog.mockResolvedValue([]);
  api.fetchPasskeys.mockResolvedValue([]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('portal_signed_out_says_signing_never_needs_an_account', () => {
  it('treats a 401 as a state, not a failure, and says an account is never required to sign', async () => {
    api.fetchSession.mockRejectedValue(new PortalApiError('no', 401));
    render(<PortalView />);

    expect(
      await screen.findByText(/You never need to sign in to sign a bulk-billing agreement/),
    ).toBeTruthy();
    // No card is rendered, and nothing was fetched behind the refusal.
    expect(screen.queryByText('My agreements')).toBeNull();
    expect(api.fetchAgreements).not.toHaveBeenCalled();
  });

  it('offers a passkey sign-in only where the browser can do it, and below that sentence', async () => {
    api.fetchSession.mockRejectedValue(new PortalApiError('no', 401));

    // jsdom has no WebAuthn, so the control must not render at all — a button
    // that explains itself after being pressed is worse than none on a page
    // somebody opened because they were worried.
    const without = render(<PortalView />);
    await screen.findByText(/You never need to sign in to sign a bulk-billing agreement/);
    expect(screen.queryByRole('button', { name: 'Sign in with your passkey' })).toBeNull();
    without.unmount();

    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    render(<PortalView />);

    const button = await screen.findByRole('button', { name: 'Sign in with your passkey' });
    /*
     * IN THE TOP BAR, IN THE CONSOLE'S OWN STYLE (Carl, 4 Sep 2026) -- chrome,
     * not content. The REQ-PORT-08 sentence is still the first thing in the
     * page body, and it is still on the page.
     */
    expect(button.closest('header')).toBeTruthy();
    expect(screen.getByText(/You never need to sign in to sign a bulk-billing agreement/)).toBeTruthy();

    fireEvent.click(button);
    await waitFor(() => expect(actual.signInWithPasskey).toHaveBeenCalled());
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
  });

  it('says something different when the server cannot be reached, and never blames the patient', async () => {
    api.fetchSession.mockRejectedValue(new PortalApiError('boom', 500));
    render(<PortalView />);

    expect(await screen.findByText(/We cannot reach your record just now/)).toBeTruthy();
    expect(screen.getByText(/Nothing about your care or your appointments is affected/)).toBeTruthy();
  });

  it('offers no development control in a build without the flag', async () => {
    api.fetchSession.mockRejectedValue(new PortalApiError('no', 401));
    render(<PortalView />);

    await screen.findByText(/You never need to sign in/);
    expect(screen.queryByText('Open as a test patient')).toBeNull();
  });
});

describe('portal_one_failed_card_does_not_blank_the_page', () => {
  it('renders all ten cards when one of them fails', async () => {
    allCardsAnswer();
    api.fetchAgreements.mockRejectedValue(new PortalApiError('boom', 500));

    render(<PortalView />);

    // The failed card says so, inside itself.
    await waitFor(() =>
      expect(screen.getAllByText(/This part could not be loaded just now/).length).toBeGreaterThan(0),
    );

    // And every other card is still on the page.
    for (const heading of [
      'My details',
      'My agreements',
      'Ongoing bulk-billing agreements',
      'Medicare claim notices',
      'Where I have been',
      'Messages sent to me',
      'People who act for me, and people I act for',
      'What happens to my data',
      'Coming later',
      'Sign-in and security',
    ]) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
  });

  it('runs its headings in order — one h1, then a h2 for each card', async () => {
    allCardsAnswer();
    render(<PortalView />);

    await waitFor(() => expect(screen.getByText('My details')).toBeTruthy());

    expect(document.querySelectorAll('h1')).toHaveLength(1);
    // Ten cards, ten second-level headings, and no h3 without an h2 above it.
    // The tenth arrived with FR-8.2's passkeys on 4 September 2026.
    expect(document.querySelectorAll('main h2').length).toBe(10);
  });

  it('persists nothing in the browser', async () => {
    allCardsAnswer();
    render(<PortalView />);
    await waitFor(() => expect(screen.getByText('My details')).toBeTruthy());

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('portal_header_names_the_person_and_offers_sign_out', () => {
  it('puts the name from the first practice record in the header, and Sign out revokes then re-checks', async () => {
    allCardsAnswer();
    api.fetchDetails.mockResolvedValue([
      {
        practiceId: 'p1',
        practiceName: 'Wattle Street Medical',
        familyName: 'Sampleton',
        givenNames: 'Jamie',
        dateOfBirth: '1962-08-04',
        address: '2 Example Street, Sampletown NSW 2000',
        mobile: '+61400000999',
        email: 'jamie-sampleton@example.invalid',
        patientRecordNumber: 'DEV-JAMIE-SAMPLETON',
      },
    ]);

    render(<PortalView />);

    // THE NAME IN THE HEADER (Carl, 4 Sep 2026), once the details have loaded.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Jamie Sampleton'),
    );

    // THE RECORD ID BESIDE SIGN OUT, in full, so the page can be checked
    // against a message that quoted it (Carl: "so we know it is not a scam").
    expect(screen.getByTestId('portal-record-id').textContent).toMatch(/Your record ID AoBPlatform-PatientId-a$/);

    // SIGN OUT: the server-side revoke is called, then the session is re-asked
    // — and a 401 on that re-ask is the signed-out screen, not an error.
    api.fetchSession.mockRejectedValue(new PortalApiError('no', 401));
    fireEvent.click(screen.getByTestId('portal-sign-out'));
    await waitFor(() => expect(actual.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('portal-sign-out')).toBeNull());
    expect(screen.getByText(/You never need to sign in/)).toBeTruthy();
  });
});

/**
 * THE WELCOME LINE — the other half of
 * `activation_success_lands_on_the_portal_with_the_welcome_line`, which the
 * activation page's own suite asserts the navigation half of.
 *
 * It exists to point at the passkey card: the next thing worth doing, and the
 * only thing that stops the next visit needing another invitation from the
 * practice. STATE, NOT STORAGE — the parameter is read once and removed from
 * the address bar, so a reload does not re-announce it and nothing is written
 * to the browser.
 */
describe('portal_welcome_line_is_shown_once_after_an_activation', () => {
  it('shows the line for ?welcome=1, clears the parameter, and shows nothing without it', async () => {
    allCardsAnswer();
    window.history.replaceState(null, '', '/patient/portal?welcome=1');

    const first = render(<PortalView />);
    const line = await screen.findByTestId('portal-welcome');
    expect(line.textContent).toContain('Add a passkey below');
    // THE PARAMETER IS GONE, so a reload is not a second announcement.
    expect(window.location.search).toBe('');

    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByTestId('portal-welcome')).toBeNull();
    first.unmount();

    // And an ordinary visit never sees it.
    render(<PortalView />);
    await screen.findByText('My agreements');
    expect(screen.queryByTestId('portal-welcome')).toBeNull();
  });
});

/**
 * THE PRACTICE FILTER (Carl, 5 Sep 2026).
 *
 * Nine cards, each listing rows from every linked practice, is three
 * interleaved records for somebody linked to three practices — and the question
 * they arrive with is almost always about one of them. The filter answers it
 * without making them read past the other two.
 *
 * IT IS STATE, NOT STORAGE. The choice dies with the tab, on a page that
 * persists nothing (`portal_persists_nothing`, above).
 */
const TWO_LINKS = [
  { practiceId: 'p1', practiceName: 'Wattle Street Medical', patientId: 'pat-1' },
  { practiceId: 'p2', practiceName: 'Harbourview Family Practice', patientId: 'pat-2' },
];

function twoPracticesAnswer() {
  api.fetchSession.mockResolvedValue({ accountId: 'a', links: TWO_LINKS });
  api.fetchDetails.mockResolvedValue([
    {
      practiceId: 'p1',
      practiceName: 'Wattle Street Medical',
      familyName: 'Sample',
      givenNames: 'Alex',
      dateOfBirth: '1984-02-29',
      address: '12 Example Street, Testville NSW 2000',
      mobile: '0400 000 001',
      email: 'alex@example.invalid',
      patientRecordNumber: 'WSM-000123',
    },
    {
      practiceId: 'p2',
      practiceName: 'Harbourview Family Practice',
      familyName: 'Sample',
      givenNames: 'Alex',
      dateOfBirth: '1984-02-29',
      address: '3/40 Older Address Road, Testville NSW 2000',
      mobile: '0400 000 001',
      email: 'alex@example.invalid',
      patientRecordNumber: 'HFP-99001',
    },
  ]);
  api.fetchAgreements.mockResolvedValue([
    {
      id: 'agr-1',
      practiceName: 'Wattle Street Medical',
      providerName: 'Dr Robin Example',
      type: 'episodic',
      status: 'stored',
      serviceDate: '2026-08-01',
      serviceDescription: 'Standard service',
      channel: 'in_practice',
      signedAt: '2026-08-01T00:00:00.000Z',
      artefactAvailable: true,
    },
    {
      id: 'agr-2',
      practiceName: 'Harbourview Family Practice',
      providerName: 'Dr Sam Placeholder',
      type: 'episodic',
      status: 'stored',
      serviceDate: '2026-08-19',
      serviceDescription: 'Standard service',
      channel: 'remote_link',
      signedAt: '2026-08-19T00:00:00.000Z',
      artefactAvailable: true,
    },
  ]);
  api.fetchEnduring.mockResolvedValue([
    {
      agreementId: 'agr-1',
      practiceName: 'Wattle Street Medical',
      providerName: 'Dr Robin Example',
      activeSince: '2026-07-15',
    },
    {
      agreementId: 'agr-9',
      practiceName: 'Harbourview Family Practice',
      providerName: 'Dr Sam Placeholder',
      activeSince: '2026-07-16',
    },
  ]);
  api.fetchNotices.mockResolvedValue([
    { id: 'n1', date: '2026-08-20', providerName: 'Dr Robin Example', practiceName: 'Wattle Street Medical', benefitAmountCents: 4285 },
    { id: 'n2', date: '2026-08-21', providerName: 'Dr Sam Placeholder', practiceName: 'Harbourview Family Practice', benefitAmountCents: 4285 },
  ]);
  api.fetchVisits.mockResolvedValue([
    { date: '2026-08-01', practiceName: 'Wattle Street Medical', locationLine: 'Wattle Street, Testville' },
    { date: '2026-08-19', practiceName: 'Harbourview Family Practice', locationLine: 'Harbourview rooms, Testville' },
  ]);
  api.fetchMessages.mockResolvedValue([
    { id: 'm1', channel: 'sms', sentAt: '2026-08-01T00:00:00.000Z', state: 'delivered', purposeKey: 'agreement_copy', practiceName: 'Wattle Street Medical', pending: false },
    { id: 'm2', channel: 'email', sentAt: '2026-08-19T00:00:00.000Z', state: 'delivered', purposeKey: 'agreement_copy', practiceName: 'Harbourview Family Practice', pending: false },
  ]);
  api.fetchAssignors.mockResolvedValue({
    actsForMe: [{ assignorId: 'asg-1', name: 'Kim Sample', relationshipKey: 'spouse', since: '2026-07-15', active: true }],
    iActFor: [
      { patientId: 'pat-9', practiceName: 'Wattle Street Medical', givenNames: 'Frankie', since: '2026-03-02' },
      { patientId: 'pat-8', practiceName: 'Harbourview Family Practice', givenNames: 'Ashley', since: '2026-03-03' },
    ],
  });
  api.fetchAccessLog.mockResolvedValue([
    { at: '2026-08-01T00:00:00.000Z', actorType: 'system', practiceName: 'Wattle Street Medical', actionKey: 'message_sent' },
    { at: '2026-08-19T00:00:00.000Z', actorType: 'patient', practiceName: 'Harbourview Family Practice', actionKey: 'agreement_signed' },
  ]);
  api.fetchPasskeys.mockResolvedValue([
    { id: 'pk-1', label: 'My phone', createdAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null },
  ]);
}

describe('portal_filter_narrows_every_card_to_one_practice', () => {
  it('shows all practices by default, then narrows every card to the chosen one', async () => {
    twoPracticesAnswer();
    // jsdom has no WebAuthn, and the passkey card draws no list without it —
    // so the claim "passkeys are not narrowed" needs a browser that can.
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    render(<PortalView />);

    // DEFAULT IS ALL OF THEM: the page answers "what does anybody hold about
    // me" before it answers "what does this one hold".
    const filter = await screen.findByTestId('portal-practice-filter');
    expect(filter.querySelector('[aria-pressed="true"]')?.textContent).toBe('All practices');
    await waitFor(() => expect(screen.getAllByText('Harbourview Family Practice').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Wattle Street Medical' }));

    // EVERY CARD'S ROWS. The other practice's name has left the page entirely,
    // apart from the filter button that puts it back.
    await waitFor(() => {
      const showing = screen
        .getAllByText('Harbourview Family Practice')
        .filter((node) => node.closest('[data-testid="portal-practice-filter"]') === null);
      expect(showing).toHaveLength(0);
    });

    // And the chosen practice's own rows are all still there, card by card.
    expect(screen.getByTestId('detail-p1-address').textContent).toContain('12 Example Street');
    expect(screen.queryByTestId('detail-p2-address')).toBeNull();
    expect(screen.getAllByText('Dr Robin Example', { exact: false }).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('Frankie');
    expect(document.body.textContent).not.toContain('Ashley');

    // PASSKEYS ARE ACCOUNT-LEVEL and are never narrowed: hiding somebody's only
    // credential because they were looking at one practice would hide the one
    // thing that gets them back in.
    expect(screen.getAllByText('My phone').length).toBeGreaterThan(0);
    // Nor is "people who act for me" — the authority is held against the
    // patient and the payload carries no practice at all.
    expect(screen.getAllByText('Kim Sample', { exact: false }).length).toBeGreaterThan(0);

    // ONE PRACTICE'S DETAILS, so there is nothing left to reconcile.
    expect(screen.queryByTestId('portal-details-reconciliation')).toBeNull();

    // BACK TO ALL, and both are on the page again.
    fireEvent.click(screen.getByRole('button', { name: 'All practices' }));
    await waitFor(() => expect(screen.getByTestId('detail-p2-address')).toBeTruthy());
    expect(screen.getByTestId('portal-details-reconciliation')).toBeTruthy();

    // NOTHING WAS WRITTEN TO THE BROWSER by choosing a practice.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
  });

  it('is a named group of 44px targets that carry their own pressed state', async () => {
    twoPracticesAnswer();
    render(<PortalView />);

    const filter = await screen.findByTestId('portal-practice-filter');
    // Named by the visible word, so a screen reader hears it once and then each
    // option with its state — rather than three unexplained buttons.
    const group = filter.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-labelledby')).toBe('portal-practice-filter-label');
    expect(document.getElementById('portal-practice-filter-label')?.textContent).toBe('Showing');

    // Three options: all practices, and one per link.
    const options = filter.querySelectorAll('button');
    expect(options).toHaveLength(3);
    for (const option of options) expect(option.getAttribute('aria-pressed')).toBeTruthy();

    // It adds no heading — the page is still ten cards, ten h2s.
    expect(document.querySelectorAll('main h2').length).toBe(10);
  });
});

describe('portal_filter_hidden_for_a_single_practice', () => {
  it('draws no filter at all where there is nothing to choose between', async () => {
    allCardsAnswer();
    api.fetchSession.mockResolvedValue({ accountId: 'a', links: [TWO_LINKS[0]] });

    render(<PortalView />);
    await screen.findByText('My agreements');

    expect(screen.queryByTestId('portal-practice-filter')).toBeNull();
    expect(screen.queryByText('All practices')).toBeNull();
  });
});
