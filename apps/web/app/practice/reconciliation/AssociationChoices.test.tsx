/**
 * "Which unsigned agreement was for this visit?" on `/practice/reconciliation`
 * (D-2026-10-10-09, option (b)). Every matching draft is named, the line says
 * what was found and on what, and choosing one posts exactly that draft.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssociationChoices, choiceReasonText } from './AssociationChoices';
import { strings } from '../../strings';

const PRACTICE = 'practice-choice-1';

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['practice_user'], practiceId: PRACTICE }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
  silentRestoreInFlight: () => false,
  restoreRefusalReason: () => null,
}));

const CHOICE = {
  serviceRecordId: 'svc-choice-1',
  serviceDate: '2026-10-06',
  patientId: 'patient-choice-1',
  patientName: 'A. Fictional',
  providerName: 'Dr Example Provider',
  reason: 'unsigned_drafts_match_service',
  candidates: [
    { agreementId: 'agreement-choice-1', type: 'episodic_pre', status: 'draft', forDay: '2026-10-06', createdAt: '2026-10-05T22:10:00.000Z', providerName: 'Dr Example Provider' },
    { agreementId: 'agreement-choice-2', type: 'episodic_pre', status: 'awaiting_signature', forDay: '2026-10-06', createdAt: '2026-10-05T23:10:00.000Z', providerName: 'Dr Example Provider' },
  ],
};

const posts: { url: string; body: unknown }[] = [];
let list: unknown[] = [CHOICE];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        list = [];
        return { ok: true, status: 201, json: async () => ({ how: 'chosen' }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => list } as unknown as Response;
    }),
  );
}

describe('association choices on Reconciliation', () => {
  beforeEach(() => {
    posts.length = 0;
    list = [CHOICE];
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names_every_matching_draft_and_says_what_was_found', async () => {
    render(<AssociationChoices practiceId={PRACTICE} />);

    const reason = await screen.findByTestId(`association-choice-reason-${CHOICE.serviceRecordId}`);
    expect(reason.textContent).toBe(strings.reconciliation.associationChoice.reasons.unsigned_drafts_match_service!(2));
    expect(reason.textContent).toContain('2 unsigned agreements match this service');
    const first = screen.getByTestId('association-candidate-agreement-choice-1');
    expect(first.textContent).toContain('Agreement before the service');
    expect(first.textContent).toContain('Draft');
    expect(first.textContent).toContain('6 October 2026');
    expect(screen.getByTestId('association-candidate-agreement-choice-2').textContent).toContain('Ready to sign, not signed');
    // Never generic advice, never a figure, never a claim (wow.md §13; hard rules 4 and 12).
    const section = screen.getByTestId('association-choices');
    expect(section.textContent).not.toMatch(/please|follow up/i);
    expect(section.textContent).not.toMatch(/\$|rebate/i);
    expect(section.textContent).not.toMatch(/certified|approved|accredited/i);
  });

  it('choosing_posts_that_draft_and_the_service_leaves_the_list', async () => {
    const loaded = vi.fn();
    render(<AssociationChoices practiceId={PRACTICE} onLoaded={loaded} />);

    fireEvent.click(await screen.findByTestId('association-choose-agreement-choice-2'));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toMatch(/\/reconciliation\/svc-choice-1\/associate$/);
    expect(posts[0]!.body).toEqual({ agreementId: 'agreement-choice-2' });
    await waitFor(() => expect(screen.queryByTestId('association-choices')).toBeNull());
    expect(loaded).toHaveBeenCalledWith(['svc-choice-1']);
    expect(loaded).toHaveBeenLastCalledWith([]);
  });

  it('an_unmapped_reason_shows_its_code', () => {
    expect(choiceReasonText({ reason: 'something_new', candidates: [] })).toBe(
      strings.reconciliation.associationChoice.reasonUnknown('something_new'),
    );
    expect(choiceReasonText({ reason: 'something_new', candidates: [] })).toContain('something_new');
  });
});
