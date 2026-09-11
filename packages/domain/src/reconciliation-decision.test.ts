import { assertDecisionAllowed, closesItem, isReconciliationDecision } from './reconciliation-decision';

const ok = { decidedBy: 'Sam Manager', daysRemaining: 40, attemptsMade: 1, alreadyClosed: false } as const;

describe('convert-or-forgo (FR-7.3)', () => {
  it('knows its three choices, and which two close the item', () => {
    expect(isReconciliationDecision('convert_to_private')).toBe(true);
    expect(isReconciliationDecision('forgo_benefit')).toBe(true);
    expect(isReconciliationDecision('keep_chasing')).toBe(true);
    expect(isReconciliationDecision('ignore')).toBe(false);
    expect(closesItem('convert_to_private')).toBe(true);
    expect(closesItem('forgo_benefit')).toBe(true);
    expect(closesItem('keep_chasing')).toBe(false);
  });

  it('needs a person — an unattributed decision about revenue is not a record', () => {
    expect(() => assertDecisionAllowed({ ...ok, decision: 'forgo_benefit', decidedBy: null })).toThrow(/signed-in person/);
    expect(() => assertDecisionAllowed({ ...ok, decision: 'forgo_benefit', decidedBy: '  ' })).toThrow(/signed-in person/);
  });

  it('always allows converting or forgoing — the practice’s call about its own money', () => {
    expect(() => assertDecisionAllowed({ ...ok, decision: 'convert_to_private', daysRemaining: -30 })).not.toThrow();
    expect(() => assertDecisionAllowed({ ...ok, decision: 'forgo_benefit', attemptsMade: 9 })).not.toThrow();
  });

  it('refuses to keep chasing past the deadline (REQ-CHASE-08) or past the attempt cap (REQ-CHASE-09)', () => {
    expect(() => assertDecisionAllowed({ ...ok, decision: 'keep_chasing', daysRemaining: 2 })).toThrow(/window has closed/);
    expect(() => assertDecisionAllowed({ ...ok, decision: 'keep_chasing', daysRemaining: 40, attemptsMade: 3 })).toThrow(/used up/);
    expect(() => assertDecisionAllowed({ ...ok, decision: 'keep_chasing', daysRemaining: 40, attemptsMade: 2 })).not.toThrow();
  });

  it('does not silently overwrite a closing decision', () => {
    expect(() => assertDecisionAllowed({ ...ok, decision: 'forgo_benefit', alreadyClosed: true })).toThrow(/already been/);
  });
});
