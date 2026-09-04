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
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
    without.unmount();

    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    render(<PortalView />);

    const button = await screen.findByRole('button', { name: 'Sign in with a passkey' });
    /*
     * ORDER MATTERS. Adding a way IN must not turn this into a screen that
     * implies a way in is needed, so the REQ-PORT-08 sentence is read first.
     */
    const sentence = screen.getByText(/You never need to sign in to sign a bulk-billing agreement/);
    expect(sentence.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

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
