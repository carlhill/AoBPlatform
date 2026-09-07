/**
 * The "Send to the tablet" twin, `/platform/practices/<id>/tablet` —
 * read-only by construction (see `ViewOnly` and `page.tsx`'s own comment).
 *
 * `page.tsx` itself is one line of composition — `ViewOnly` wrapping
 * `TabletView` — behind Next's async `params`, the same mechanism every
 * other twin route uses and is not this file's to prove. What this guards is
 * the one thing that must never regress: Send is never reachable and Recall
 * is never reachable. Everything else — what a row shows, how it loads — is
 * `TabletView`'s own behaviour and already has its test.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { DeviceRow, TabletSessionRow } from '@aobplatform/domain';
import { TabletView } from '../../../../practice/tablet/TabletView';
import { ViewOnly } from '../ViewOnly';

const PRACTICE_ID = 'practice-1';

const READY = {
  agreementId: 'agreement-ready',
  agreementType: 'episodic_pre',
  status: 'draft',
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Example Provider',
  providerType: 'general_practitioner',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:00',
  serviceDescription: 'General practitioner attendance',
  serviceDescriptionValid: true,
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  particularsLocked: false,
  pushable: true,
  blockedReason: null,
  activeSession: null,
};

const TABLET: DeviceRow = {
  id: 'device-1',
  label: 'Reception tablet 1',
  state: 'paired',
  createdBy: 'Robin Admin',
  createdAt: '2026-09-01T00:00:00.000Z',
  pairedAt: '2026-09-01T01:00:00.000Z',
  lastSeenAt: '2026-09-04T08:00:00.000Z',
  lastKioskBuild: '2026.09.04-1',
  revokedAt: null,
  revokedBy: null,
  pairingExpiresAt: null,
  showsWaitingList: false,
};

const SESSION: TabletSessionRow = {
  id: 'session-1',
  deviceId: TABLET.id,
  deviceLabel: TABLET.label,
  agreementId: READY.agreementId,
  agreementType: 'episodic_pre',
  patientName: 'Jamie Sampleton',
  patientId: 'patient-1',
  providerName: 'Dr Example Provider',
  state: 'reading',
  disputedDetails: [],
  disputeResolution: null,
  disputeResolvedAt: null,
  signatureFailureReason: null,
  pushedBy: 'Mai Frontdesk',
  pushedAt: '2026-09-04T09:05:00.000Z',
  lastStateAt: '2026-09-04T09:06:00.000Z',
  endedAt: null,
};

vi.mock('../../../../auth', () => ({
  currentSession: () => ({ roles: ['platform_admin'], practiceId: null }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE_ID }),
}));

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const payload = url.includes('/tablet-sessions/pushable')
        ? [READY]
        : url.includes('/tablet-sessions')
          ? [SESSION]
          : url.includes('/practice-users')
            ? { users: [] }
            : { devices: [TABLET] };
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

describe('the tablet twin — read-only, Send and Recall never reachable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows who is waiting and what the tablet is doing, wrapped in a disabled fieldset', async () => {
    stubFetch();
    render(
      <ViewOnly practiceId={PRACTICE_ID}>
        <TabletView practiceId={PRACTICE_ID} />
      </ViewOnly>,
    );

    // The mode banner every twin carries.
    expect(screen.getByTestId('view-only')).toBeTruthy();

    // The SAME two columns reception reads: who can be sent, and the live
    // session on the tablet.
    await waitFor(() => expect(screen.getAllByText('Jamie Sampleton').length).toBeGreaterThan(0));

    /*
     * TWO LAYERS, BOTH CHECKED. `ViewOnly` wraps the whole page in a disabled
     * fieldset (its own comment: "by definition of the HTML") — checked
     * structurally, since jsdom does not implement the fieldset-disabled
     * cascade onto descendant controls the way a real browser does. But
     * `TabletView` ALSO disables Send and Recall itself, from `canSend` —
     * computed from the SESSION's own practice claim, never this page's
     * `practiceId` prop — so a platform session with no practice claim meets
     * a genuinely disabled `<button>` here regardless of the fieldset. That
     * is real, and this asserts it directly.
     */
    const fieldset = document.querySelector('fieldset');
    expect(fieldset).toBeTruthy();
    expect(fieldset?.hasAttribute('disabled')).toBe(true);

    const sendButton = screen.getByTestId(`send-${READY.agreementId}`) as HTMLButtonElement;
    expect(fieldset?.contains(sendButton)).toBe(true);
    expect(sendButton.disabled).toBe(true);

    const recallButton = screen.getByTestId(`recall-${SESSION.id}`) as HTMLButtonElement;
    expect(fieldset?.contains(recallButton)).toBe(true);
    expect(recallButton.disabled).toBe(true);
  });
});
