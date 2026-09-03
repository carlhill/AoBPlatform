/**
 * The staff surface for D6a — the row state, the gating, and the one rule that
 * matters most: THE SCREEN CARRIES NO DESCRIPTIONS OF ITS OWN.
 *
 * The options are versioned content served by core (hard rule 14). A copy in
 * the component would go stale silently the moment the mapping moves, and the
 * first anybody would know is a rules refusal at a waiting-room tablet. So the
 * first test here renders with a server list of deliberately invented words
 * and asserts they are what appears: if somebody ever hardcodes the real five,
 * this fails.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Audience } from '@aobplatform/domain';
import {
  ServiceDescriptionsNeeded,
  mayActOnDescriptions,
  outcomeMessage,
  whenLabel,
} from './ServiceDescriptionsNeeded';
import { strings } from '../../strings';

const PRACTICE_ID = '821709fb-7f89-4fcf-95c0-27c5eb55cec8';

/**
 * NOT THE REAL FIVE, deliberately — see the file comment. These are what the
 * server said, so these are what must be on screen.
 */
const SERVER_LIST = {
  version: 'test-list-9',
  descriptions: ['First stubbed description', 'Second stubbed description'],
};

const ROW = {
  agreementId: '3f43e0f2-f0bf-4c97-aba6-bf916fbdf2ab',
  patientName: 'M. Placeholder',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-03',
  appointmentTime: '09:00',
  currentDescription: null,
  setBy: null,
  setAt: null,
  createdAt: '2026-09-03T06:29:23.517Z',
};

let session: { roles: string[]; practiceId: string | null; practitionerId?: string } | null = null;

vi.mock('../../auth', () => ({
  currentSession: () => session,
  apiHeaders: () => ({ 'x-practice-id': PRACTICE_ID }),
}));

let pending = [ROW];

function stubFetch() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/service-descriptions/pending')) {
      return { ok: true, json: async () => pending } as unknown as Response;
    }
    if (url.endsWith('/service-descriptions')) {
      return { ok: true, json: async () => SERVER_LIST } as unknown as Response;
    }
    // The set call. The row leaves the list because the SERVER stops
    // returning it, which is what the component re-reads.
    pending = [];
    return {
      ok: true,
      json: async () => ({ validation: { c6: 'pass', otherFailures: [] } }),
    } as unknown as Response;
  });
}

describe('service descriptions needed — the staff surface for D6a', () => {
  beforeEach(() => {
    pending = [ROW];
    session = { roles: [], practiceId: PRACTICE_ID };
    vi.stubGlobal('fetch', stubFetch());
  });

  it('renders the options the SERVER sent, and carries none of its own', async () => {
    render(<ServiceDescriptionsNeeded practiceId={PRACTICE_ID} />);

    const select = (await screen.findByTestId(`sd-select-${ROW.agreementId}`)) as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value).filter(Boolean);
    expect(options).toEqual(SERVER_LIST.descriptions);
    // In the order the server sent — file order is screen order.
    expect(options[0]).toBe('First stubbed description');
    // The version is shown, because it is recorded with the agreement.
    expect(screen.getByText(`List ${SERVER_LIST.version}`)).toBeTruthy();
  });

  it('the action is disabled until a description is chosen, then the row leaves the list', async () => {
    render(<ServiceDescriptionsNeeded practiceId={PRACTICE_ID} />);

    const button = (await screen.findByTestId(`sd-set-${ROW.agreementId}`)) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByTestId(`sd-select-${ROW.agreementId}`), {
      target: { value: 'First stubbed description' },
    });
    expect((screen.getByTestId(`sd-set-${ROW.agreementId}`) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId(`sd-set-${ROW.agreementId}`));
    await waitFor(() => {
      expect(screen.queryByTestId(`sd-row-${ROW.agreementId}`)).toBeNull();
    });
    expect(screen.getByText(strings.serviceDescription.none)).toBeTruthy();
  });

  it('shows the state but offers no control to somebody with no practice claim', async () => {
    session = { roles: ['platform_admin'], practiceId: null };
    render(<ServiceDescriptionsNeeded practiceId={PRACTICE_ID} />);

    const select = (await screen.findByTestId(`sd-select-${ROW.agreementId}`)) as HTMLSelectElement;
    // The row is READABLE — that is what the read-only twin is for.
    expect(screen.getByText('M. Placeholder')).toBeTruthy();
    expect(select.disabled).toBe(true);
    expect((screen.getByTestId(`sd-set-${ROW.agreementId}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says why, rather than failing silently, when nobody is signed in', async () => {
    session = null;
    render(<ServiceDescriptionsNeeded practiceId={PRACTICE_ID} />);
    expect(await screen.findByText(strings.serviceDescription.noSession)).toBeTruthy();
  });
});

describe('the gate itself', () => {
  const audiences = (...a: Audience[]) => a;

  it('lets a practice user act, and an operator merely look', () => {
    expect(mayActOnDescriptions(audiences('public', 'practice'))).toBe(true);
    // An operator ACTING AS a practice carries the practice claim, so they pass
    // by construction — and the acting-as log records on whose behalf.
    expect(mayActOnDescriptions(audiences('public', 'platform', 'practice'))).toBe(true);
    expect(mayActOnDescriptions(audiences('public', 'platform'))).toBe(false);
    expect(mayActOnDescriptions(audiences('public', 'practitioner'))).toBe(false);
    expect(mayActOnDescriptions(audiences('public'))).toBe(false);
  });
});

describe('what the row says afterwards', () => {
  it('reports what the rule set actually said, never an assumed clearance', () => {
    expect(outcomeMessage({ validation: null })).toBe(strings.serviceDescription.notChecked);
    expect(outcomeMessage({ validation: { c6: 'pass', otherFailures: [] } })).toBe(
      strings.serviceDescription.cleared,
    );
    expect(outcomeMessage({ validation: { c6: 'pass', otherFailures: ['C8', 'C13'] } })).toContain('C8, C13');
  });

  it('a walk-in with no booked time is not given one', () => {
    expect(whenLabel({ appointmentDate: null, appointmentTime: null })).toBeNull();
    expect(whenLabel({ appointmentDate: '2026-09-03', appointmentTime: '09:00' })).toContain('09:00');
  });
});
