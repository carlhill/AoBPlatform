import {
  buildMessageLog,
  matchesSegment,
  mayChase,
  purposeOf,
  showsBodies,
  showsCost,
} from './correspondence-log';

const row = (over: Partial<Parameters<typeof purposeOf>[0]> & Record<string, unknown> = {}) => ({
  id: 'r1',
  subjectType: 'CaptureRequest',
  channel: 'sms',
  state: 'delivered',
  queuedAt: '2026-09-03T01:04:00.000Z',
  sentAt: '2026-09-03T01:04:00.000Z',
  ...over,
});

describe('one log, two audiences (design handoff M-1 / P-1)', () => {
  it('derives what a message was for from what it was about', () => {
    expect(purposeOf({ subjectType: 'CaptureRequest', attempt: 1 })).toBe('capture');
    expect(purposeOf({ subjectType: 'CaptureRequest', attempt: 3 })).toBe('reminder');
    expect(purposeOf({ subjectType: 'Agreement' })).toBe('copy');
    expect(purposeOf({ subjectType: 'Notice' })).toBe('notice');
    expect(purposeOf({ subjectType: 'Affiliation' })).toBe('practice');
  });

  /**
   * CLAUDE.md rule 7, REQ-END-05 / REQ-CHASE-02. Named after the rule so that
   * deleting it is an obvious act rather than a tidy-up.
   */
  it('eightynineAA_rows_have_no_chase_action', () => {
    expect(mayChase('notice')).toBe(false);
    for (const p of ['capture', 'reminder', 'copy', 'practice'] as const) expect(mayChase(p)).toBe(true);

    const log = buildMessageLog({
      dispatches: [
        row({ id: 'notice-1', subjectType: 'Notice' }),
        row({ id: 'capture-1', subjectType: 'CaptureRequest', attempt: 1 }),
      ],
    });
    expect(log.find((e) => e.id === 'notice-1')!.chaseable).toBe(false);
    expect(log.find((e) => e.id === 'capture-1')!.chaseable).toBe(true);
  });

  it('shows a suppressed confidential visit as a row, never as a row left out', () => {
    const log = buildMessageLog({
      dispatches: [row({ id: 'a', sentAt: '2026-09-01T00:00:00.000Z' })],
      suppressed: [
        { serviceRecordId: 's1', patientName: 'Robert Blake', reason: 'confidentiality_flag', suppressedAt: '2026-09-02T00:00:00.000Z' },
        // Queue reasons stay on the queue: there is an action beside them there.
        { serviceRecordId: 's2', patientName: 'Someone Else', reason: 'no_contact_channel', suppressedAt: '2026-09-02T00:00:00.000Z' },
      ],
    });
    expect(log).toHaveLength(2);
    const entry = log.find((e) => e.kind === 'suppressed')!;
    expect(entry.suppressionReason).toBe('confidentiality_flag');
    expect(entry.state).toBe('suppressed');
    expect(entry.channel).toBeNull();
    // Nothing was sent, so nothing can be sent again.
    expect(entry.chaseable).toBe(false);
    // Newest first.
    expect(log[0].id).toBe('suppressed:s1');
  });

  it('says the text was removed by retention, rather than showing a blank', () => {
    const [entry] = buildMessageLog({ dispatches: [row({ contentRemovedAt: '2028-09-03T00:00:00.000Z' })] });
    expect(entry.contentRemoved).toBe(true);
  });

  it('shows cost to the practice alone, and never a body to the platform twin', () => {
    expect(showsCost('practice')).toBe(true);
    for (const a of ['patient', 'platform', 'practitioner'] as const) expect(showsCost(a)).toBe(false);

    expect(showsBodies('platform')).toBe(false);
    for (const a of ['practice', 'patient', 'practitioner'] as const) expect(showsBodies(a)).toBe(true);
  });

  it('filters by the segment the design draws, with failures as their own segment', () => {
    const log = buildMessageLog({
      dispatches: [
        row({ id: 'n', subjectType: 'Notice' }),
        row({ id: 'f', state: 'failed', failureReason: 'number unreachable' }),
      ],
    });
    const ids = (s: Parameters<typeof matchesSegment>[1]) => log.filter((e) => matchesSegment(e, s)).map((e) => e.id);
    expect(ids('all')).toEqual(expect.arrayContaining(['n', 'f']));
    expect(ids('notice')).toEqual(['n']);
    expect(ids('failed')).toEqual(['f']);
  });
});
