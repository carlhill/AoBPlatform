/**
 * `/practice/reconciliation?item=<serviceRecordId>` — one item, opened from a
 * link (D-2026-10-10-01). The tablet page's "Unsigned from earlier days" links
 * here; the link must land on THAT item, opened, not on the top of a queue.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReconciliationView, RECONCILIATION_ITEM_PARAM, channelFor } from './ReconciliationView';
import { PracticeOverride } from '../usePractice';
import { strings } from '../../strings';

const PRACTICE = 'practice-recon-1';

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['practice_user'], practiceId: PRACTICE }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
  silentRestoreInFlight: () => false,
  restoreRefusalReason: () => null,
}));

const ITEM = {
  serviceRecordId: 'svc-deep-1',
  serviceDate: '2026-10-07',
  mbsItemNumbers: ['23'],
  daysRemaining: 300,
  band: 'standard',
  agreementId: 'agreement-deep-1',
  agreementStatus: 'draft',
  patientId: 'patient-deep-1',
  patientName: 'K. Specimen',
  providerName: 'Dr Example Provider',
  patientHasEmail: true,
  patientHasMobile: false,
  needsAgreement: false,
  captureSuppressedReason: null,
  outboundChaseSuppressed: false,
  revenueForgone: false,
};

const DETAIL = {
  alreadyClosed: false,
  decisions: [],
  band: 'standard',
  daysRemaining: 300,
  patient: { name: 'Kim Specimen' },
  provider: { name: 'Dr Example Provider' },
  agreement: { id: 'agreement-deep-1', status: 'draft' },
  captureSuppressedReason: null,
  policy: { attempts: 3, attemptWindowHours: 72, escalation: [], handback: 'staff' },
  attemptsMade: 0,
  attemptAllowed: true,
  nextStep: null,
  attempts: [],
};

/** A service waiting for a person to choose its agreement (D-2026-10-10-09). */
const CHOICE = {
  serviceRecordId: 'svc-choice-1',
  serviceDate: '2026-10-06',
  patientId: 'patient-choice-1',
  patientName: 'A. Fictional',
  providerName: 'Dr Example Provider',
  reason: 'unsigned_drafts_match_service',
  candidates: [
    { agreementId: 'agreement-choice-1', type: 'episodic_pre', status: 'draft', forDay: '2026-10-06', createdAt: '2026-10-05T22:10:00.000Z', providerName: 'Dr Example Provider' },
    { agreementId: 'agreement-choice-2', type: 'episodic_pre', status: 'draft', forDay: '2026-10-06', createdAt: '2026-10-05T23:10:00.000Z', providerName: 'Dr Example Provider' },
  ],
};

const calls: string[] = [];

function stubFetch(detail: unknown = DETAIL) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.endsWith('/reconciliation/outstanding')
        ? [ITEM]
        : url.endsWith('/reconciliation/association-choices')
          ? [CHOICE]
        : url.endsWith('/reconciliation/metrics')
          ? { outstanding: 1, byBand: { standard: 1, compressed: 0, urgent: 0, last_chance: 0, expired: 0 }, captureRate: null }
          : url.endsWith(`/reconciliation/${ITEM.serviceRecordId}`)
            ? detail
            : url.includes('/service-descriptions/pending')
              ? []
              : url.includes('/service-descriptions')
                ? { version: 'v', descriptions: [] }
                : {};
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
}

function at(search: string) {
  window.history.replaceState({}, '', `/practice/reconciliation${search}`);
}

describe('/practice/reconciliation — one item from a link', () => {
  beforeEach(() => {
    calls.length = 0;
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    at('');
  });

  it('reconciliation_item_link_opens_that_item', async () => {
    at(`?${RECONCILIATION_ITEM_PARAM}=${ITEM.serviceRecordId}`);
    render(
      <PracticeOverride practiceId={PRACTICE}>
        <ReconciliationView />
      </PracticeOverride>,
    );

    await screen.findByTestId('reconciliation-detail');
    await waitFor(() => expect(calls.some((u) => u.endsWith(`/reconciliation/${ITEM.serviceRecordId}`))).toBe(true));
    const row = document.getElementById(`reconciliation-item-${ITEM.serviceRecordId}`);
    expect(row).not.toBeNull();
    expect(screen.queryByTestId('reconciliation-item-not-on-queue')).toBeNull();
  });

  it('reconciliation_item_link_to_an_item_not_on_the_queue_says_so_with_its_id', async () => {
    at(`?${RECONCILIATION_ITEM_PARAM}=svc-gone`);
    render(
      <PracticeOverride practiceId={PRACTICE}>
        <ReconciliationView />
      </PracticeOverride>,
    );

    const notice = await screen.findByTestId('reconciliation-item-not-on-queue');
    expect(notice.textContent).toContain(strings.reconciliation.itemNotOnQueue('svc-gone'));
    expect(screen.queryByTestId('reconciliation-detail')).toBeNull();
  });

  it('reconciliation_item_link_to_a_service_waiting_for_a_choice_lands_on_that_choice', async () => {
    at(`?${RECONCILIATION_ITEM_PARAM}=${CHOICE.serviceRecordId}`);
    render(
      <PracticeOverride practiceId={PRACTICE}>
        <ReconciliationView />
      </PracticeOverride>,
    );

    const choice = await screen.findByTestId(`association-choice-${CHOICE.serviceRecordId}`);
    expect(choice.id).toBe(`reconciliation-choice-${CHOICE.serviceRecordId}`);
    // Waiting for both lists before deciding, so it is not called "not on this queue".
    await screen.findByTestId(`reconciliation-row-${ITEM.serviceRecordId}`);
    expect(screen.queryByTestId('reconciliation-item-not-on-queue')).toBeNull();
  });

  it('no_item_parameter_opens_nothing', async () => {
    render(
      <PracticeOverride practiceId={PRACTICE}>
        <ReconciliationView />
      </PracticeOverride>,
    );

    await screen.findByTestId(`reconciliation-row-${ITEM.serviceRecordId}`);
    expect(screen.queryByTestId('reconciliation-detail')).toBeNull();
    expect(screen.queryByTestId('reconciliation-item-not-on-queue')).toBeNull();
  });
});

describe('/practice/reconciliation — a link that locked, and which channel a resend uses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    at('');
  });

  it('a_link_closed_by_its_lockout_says_so_on_the_queue (D-2026-10-12-01)', async () => {
    stubFetch({
      ...DETAIL,
      attemptsMade: 1,
      attempts: [
        {
          captureRequestId: 'capture-locked-1',
          channel: 'sms_link',
          status: 'cancelled',
          cancelledReason: 'verification_locked_out',
          openedAt: '2026-10-12T01:00:00.000Z',
          messages: [],
        },
      ],
    });
    at(`?${RECONCILIATION_ITEM_PARAM}=${ITEM.serviceRecordId}`);
    render(
      <PracticeOverride practiceId={PRACTICE}>
        <ReconciliationView />
      </PracticeOverride>,
    );
    const line = await screen.findByTestId('reconciliation-attempt-locked');
    expect(line.textContent).toBe(strings.link.db4.queueAttemptLocked);
  });

  it('channel_for_is_the_contact_actually_on_file', () => {
    expect(channelFor({ patientHasEmail: true, patientHasMobile: true })).toBe('email_link');
    expect(channelFor({ patientHasEmail: false, patientHasMobile: true })).toBe('sms_link');
    expect(channelFor({ patientHasEmail: false, patientHasMobile: false })).toBeNull();
  });
});
