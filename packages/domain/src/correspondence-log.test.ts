import {
  buildMessageLog,
  describePurpose,
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
   * WHAT THE THING ACTUALLY IS — Carl, on M-1: the label reads
   * `Episodic-Agreement-Pre-Consultation`, not "Capture link". Three facts,
   * every one of them read from the record.
   */
  it('names the agreement type, the artefact and the timing, from the data', () => {
    const of = (over: Record<string, unknown>) =>
      describePurpose(buildMessageLog({ dispatches: [row(over)] })[0]);

    expect(of({ agreementType: 'episodic_pre', attempt: 1 })).toEqual({
      family: 'episodic',
      artefact: 'agreement',
      timing: 'pre',
      attempt: null,
    });
    expect(of({ agreementType: 'episodic_post', attempt: 1 })).toMatchObject({
      family: 'episodic',
      artefact: 'agreement',
      timing: 'post',
    });
    // A signed copy of the agreement is the same artefact, named the same way.
    expect(of({ subjectType: 'Agreement', agreementType: 'enduring' })).toMatchObject({
      family: 'enduring',
      artefact: 'agreement',
      timing: 'pre',
    });
    // A treatment plan is a multi-service episodic PRE agreement.
    expect(of({ subjectType: 'Agreement', agreementType: 'treatment_plan' })).toMatchObject({
      family: 'treatment_plan',
      timing: 'pre',
    });
  });

  it('carries the chase ordinal on a reminder, and on nothing else', () => {
    const log = buildMessageLog({
      dispatches: [
        row({ id: 'first', agreementType: 'episodic_post', attempt: 1 }),
        row({ id: 'chase', agreementType: 'episodic_post', attempt: 2, queuedAt: '2026-09-03T02:04:00.000Z', sentAt: '2026-09-03T02:04:00.000Z' }),
      ],
    });
    // Episodic-Agreement-Post-Consultation, then …-Reminder-2.
    expect(describePurpose(log.find((e) => e.id === 'first')!)!.attempt).toBeNull();
    expect(describePurpose(log.find((e) => e.id === 'chase')!)).toMatchObject({
      family: 'episodic',
      artefact: 'agreement',
      timing: 'post',
      attempt: 2,
    });
  });

  /**
   * A reg 89AA notice reports a service already billed, so it is a NOTICE and
   * it is always AFTER — the enduring agreement it is about supplies the
   * family and never the timing.
   */
  it('names an 89AA notice as a notice, after the service, on the agreement it reports', () => {
    const [entry] = buildMessageLog({
      dispatches: [row({ subjectType: 'Notice', agreementType: 'enduring' })],
    });
    expect(entry.purpose).toBe('notice');
    expect(describePurpose(entry)).toEqual({
      family: 'enduring',
      artefact: 'notice',
      timing: 'post',
      attempt: null,
    });
    // Still one-way. Naming it better does not give it an action.
    expect(entry.chaseable).toBe(false);
  });

  it('leaves a message with no agreement behind it alone, rather than inventing one', () => {
    // A practice message: an affiliation ending, a sign-in link.
    const [practice] = buildMessageLog({ dispatches: [row({ subjectType: 'Affiliation' })] });
    expect(practice.agreementType).toBeNull();
    expect(describePurpose(practice)).toBeNull();

    // A capture message whose agreement the server could not resolve.
    const [unresolved] = buildMessageLog({ dispatches: [row({ attempt: 1 })] });
    expect(describePurpose(unresolved)).toBeNull();

    // A type this domain does not know is dropped, not half-rendered.
    const [unknown] = buildMessageLog({ dispatches: [row({ agreementType: 'something_new' })] });
    expect(unknown.agreementType).toBeNull();
    expect(describePurpose(unknown)).toBeNull();

    // And a suppressed send names no artefact, because none was composed.
    const [suppressed] = buildMessageLog({
      dispatches: [],
      suppressed: [{ serviceRecordId: 's1', patientName: 'Robert Blake', reason: 'confidentiality_flag', suppressedAt: '2026-09-02T00:00:00.000Z' }],
    });
    expect(describePurpose(suppressed)).toBeNull();
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
