import { markSuperseded, orderAuditTrail, summariseAudit, type AuditEntry } from './audit';

const at = (iso: string) => `2026-08-2${iso}`;

describe('orderAuditTrail', () => {
  // Oldest first, deliberately unlike an activity feed. An audit trail answers
  // "how did this get here", and that reads forwards.
  it('reads forwards, oldest first', () => {
    const trail = orderAuditTrail([
      { kind: 'decision', at: at('3T10:00:00Z'), who: 'Reviewer', summary: 'Approved' },
      { kind: 'submitted', at: at('1T09:00:00Z'), who: null, summary: 'Applied' },
      { kind: 'check', at: at('2T11:00:00Z'), who: 'Reviewer', summary: 'Called' },
    ]);
    expect(trail.map((e) => e.kind)).toEqual(['submitted', 'check', 'decision']);
  });

  it('puts a cause before its effect when they share a timestamp', () => {
    const sameSecond = at('2T11:00:00Z');
    const trail = orderAuditTrail([
      { kind: 'evidence', at: sameSecond, who: 'Reviewer', summary: 'Attached a screenshot' },
      { kind: 'check', at: sameSecond, who: 'Reviewer', summary: 'Recorded the call' },
      { kind: 'amended', at: sameSecond, who: 'Applicant', summary: 'Changed the phone' },
    ]);
    expect(trail.map((e) => e.kind)).toEqual(['amended', 'check', 'evidence']);
  });

  it('does not mutate its input', () => {
    const input: AuditEntry[] = [
      { kind: 'decision', at: at('3T10:00:00Z'), who: 'R', summary: 'x' },
      { kind: 'submitted', at: at('1T09:00:00Z'), who: null, summary: 'y' },
    ];
    orderAuditTrail(input);
    expect(input[0].kind).toBe('decision');
  });
});

describe('markSuperseded', () => {
  it('marks an earlier check on the same key, and not the later one', () => {
    const marked = markSuperseded([
      { kind: 'check', subject: 'entitlement.phone_call', at: at('1T09:00:00Z'), who: 'A', summary: 'Failed' },
      { kind: 'check', subject: 'entitlement.phone_call', at: at('2T09:00:00Z'), who: 'B', summary: 'Passed' },
    ]);
    expect(marked[0].supersedes).toBe(true);
    expect(marked[1].supersedes).toBeUndefined();
  });

  it('leaves checks on DIFFERENT keys alone — they are not the same thing', () => {
    const marked = markSuperseded([
      { kind: 'check', subject: 'entitlement.phone_call', at: at('1T09:00:00Z'), who: 'A', summary: 'Passed' },
      { kind: 'check', subject: 'entity.abn_active', at: at('2T09:00:00Z'), who: 'A', summary: 'Passed' },
    ]);
    expect(marked.every((e) => e.supersedes === undefined)).toBe(true);
  });

  it('does not let a check supersede an amendment that happens to share a name', () => {
    const marked = markSuperseded([
      { kind: 'amended', subject: 'adminPhone', at: at('1T09:00:00Z'), who: 'Applicant', summary: 'x' },
      { kind: 'check', subject: 'adminPhone', at: at('2T09:00:00Z'), who: 'Reviewer', summary: 'y' },
    ]);
    expect(marked.every((e) => e.supersedes === undefined)).toBe(true);
  });

  it('never removes anything — a superseded entry stays readable', () => {
    const entries = [
      { kind: 'check' as const, subject: 'k', at: at('1T09:00:00Z'), who: 'A', summary: 'Failed' },
      { kind: 'check' as const, subject: 'k', at: at('2T09:00:00Z'), who: 'B', summary: 'Passed' },
    ];
    expect(markSuperseded(entries)).toHaveLength(2);
  });

  it('ignores entries with no subject', () => {
    const marked = markSuperseded([
      { kind: 'submitted', at: at('1T09:00:00Z'), who: null, summary: 'Applied' },
      { kind: 'decision', at: at('2T09:00:00Z'), who: 'R', summary: 'Approved' },
    ]);
    expect(marked.every((e) => e.supersedes === undefined)).toBe(true);
  });
});

describe('summariseAudit', () => {
  it('counts by kind and names everyone involved, once each', () => {
    const summary = summariseAudit([
      { kind: 'submitted', at: at('1T09:00:00Z'), who: null, summary: 'x' },
      { kind: 'check', at: at('2T09:00:00Z'), who: 'Carl HILL', summary: 'x' },
      { kind: 'check', at: at('2T10:00:00Z'), who: 'Carl HILL', summary: 'x' },
      { kind: 'evidence', at: at('2T10:00:00Z'), who: 'Carl HILL', summary: 'x' },
      { kind: 'amended', at: at('3T09:00:00Z'), who: 'Marta Ellis', summary: 'x' },
    ]);
    expect(summary).toEqual({
      checks: 2,
      amendments: 1,
      evidence: 1,
      people: ['Carl HILL', 'Marta Ellis'],
    });
  });

  it('is empty and calm for an application nothing has happened to', () => {
    expect(summariseAudit([])).toEqual({ checks: 0, amendments: 0, evidence: 0, people: [] });
  });
});
