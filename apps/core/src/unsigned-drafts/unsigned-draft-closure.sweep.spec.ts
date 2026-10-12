import { closureSkipFor, creationCutoff, type ClosureFacts } from './unsigned-draft-closure.sweep';

/**
 * THE CLOSURE RULE, without a database (D-2026-10-10-09 option 3): every
 * protected case keeps a draft open, and only a due, open, unprotected draft
 * may be closed.
 */
describe('closureSkipFor', () => {
  const closable: ClosureFacts = {
    open: true,
    legalHold: false,
    due: true,
    linked: false,
    associated: false,
    superseded: false,
    onTablet: false,
    liveRemoteLink: false,
    serviceMatchesVisit: false,
  };

  it('a_due_open_unprotected_draft_may_be_closed', () => {
    expect(closureSkipFor(closable)).toBeNull();
  });

  it.each([
    ['open', false, 'not_open'],
    ['legalHold', true, 'legal_hold'],
    ['due', false, 'not_due'],
    ['linked', true, 'linked'],
    ['associated', true, 'associated'],
    ['superseded', true, 'superseded'],
    ['onTablet', true, 'on_tablet'],
    ['liveRemoteLink', true, 'live_remote_link'],
    ['serviceMatchesVisit', true, 'service_matches_visit'],
  ] as const)('protected_case_%s_keeps_the_draft_open', (field, value, reason) => {
    expect(closureSkipFor({ ...closable, [field]: value })).toBe(reason);
  });
});

describe('creationCutoff', () => {
  it('is_the_start_of_the_practice_local_day_n_minus_one_days_before_today', () => {
    // N = 7 on 10 Oct reaches back to the start of 4 Oct, which is still AEST (+10): clocks go forward at 2am that day.
    expect(creationCutoff('2026-10-10', 7).toISOString()).toBe('2026-10-03T14:00:00.000Z');
    // N = 1: drafts created before today.
    expect(creationCutoff('2026-10-10', 1).toISOString()).toBe('2026-10-09T13:00:00.000Z');
  });
});
