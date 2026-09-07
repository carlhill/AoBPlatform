import { establishingEntitlementCheck, type PerformedCheck } from './checks';

const check = (over: Partial<PerformedCheck>): PerformedCheck => ({
  checkKey: 'entitlement.phone_call',
  category: 'entitlement',
  outcome: 'passed',
  performedByName: 'John Smith',
  performedAt: new Date('2026-08-22T02:04:00Z'),
  fields: { phoneNumber: '0298765432', numberSource: 'nhsd', spokeWithName: 'Reception' },
  artefacts: [{ id: 'a1', filename: 'notice-of-disposal.pdf' }],
  ...over,
});

describe('establishingEntitlementCheck', () => {
  it('is null when nothing has established entitlement', () => {
    expect(establishingEntitlementCheck([])).toBeNull();
    expect(
      establishingEntitlementCheck([check({ category: 'entity', checkKey: 'entity.abn_active' })]),
    ).toBeNull();
  });

  it('ignores a check that did not pass', () => {
    expect(establishingEntitlementCheck([check({ outcome: 'failed' })])).toBeNull();
    expect(establishingEntitlementCheck([check({ outcome: 'could_not_complete' })])).toBeNull();
  });

  /*
   * The attribution fix. One person rings the practice and another approves,
   * which is ordinary and arguably better practice. Retyping John's call into
   * Carl's decision made the record say Carl made the call.
   */
  it('CARRIES THE PERSON WHO PERFORMED IT, not whoever approves', () => {
    const found = establishingEntitlementCheck([check({ performedByName: 'John Smith' })]);
    expect(found?.performedByName).toBe('John Smith');
  });

  it('takes the facts off the check, so the decision cannot contradict the evidence', () => {
    const found = establishingEntitlementCheck([check({})]);
    expect(found?.phoneNumber).toBe('0298765432');
    expect(found?.numberSource).toBe('nhsd');
    expect(found?.spokeWithName).toBe('Reception');
    expect(found?.hasEvidence).toBe(true);
  });

  /*
   * Derived from the key rather than typed. A hand-entered method can
   * contradict the check it is supposed to describe; a derived one cannot.
   */
  it('derives the method from the check key', () => {
    expect(establishingEntitlementCheck([check({})])?.method).toBe('phone_call');
    expect(
      establishingEntitlementCheck([check({ checkKey: 'entitlement.domain_match', fields: {} })])?.method,
    ).toBe('domain_match');
    expect(
      establishingEntitlementCheck([check({ checkKey: 'entitlement.hpio_delegation', fields: {} })])?.method,
    ).toBe('hpio_delegation');
  });

  /*
   * "On what basis was this approved" has one honest answer, and it is the
   * strongest thing that was actually done — not the most recent.
   */
  it('rests on the STRONGEST check, not the latest', () => {
    const document = check({
      checkKey: 'entitlement.document',
      performedByName: 'Later Person',
      performedAt: new Date('2026-08-23T00:00:00Z'),
      fields: {},
    });
    const call = check({ performedAt: new Date('2026-08-22T00:00:00Z') });

    const found = establishingEntitlementCheck([document, call]);
    expect(found?.method).toBe('phone_call');
    expect(found?.performedByName).toBe('John Smith');
  });

  it('breaks a tie on weight by taking the most recent', () => {
    const older = check({ performedByName: 'First', performedAt: new Date('2026-08-20T00:00:00Z') });
    const newer = check({ performedByName: 'Second', performedAt: new Date('2026-08-22T00:00:00Z') });
    expect(establishingEntitlementCheck([older, newer])?.performedByName).toBe('Second');
  });

  it('still reports the others, because they contributed to the score', () => {
    const call = check({});
    const document = check({ checkKey: 'entitlement.document', fields: {} });
    const found = establishingEntitlementCheck([call, document]);
    expect(found?.alsoPassed).toHaveLength(1);
    expect(found?.alsoPassed[0]?.checkKey).toBe('entitlement.document');
  });

  it('copes with a check that carries no fields and no evidence', () => {
    const bare = check({ checkKey: 'entitlement.domain_match', fields: null, artefacts: [] });
    const found = establishingEntitlementCheck([bare]);
    expect(found?.phoneNumber).toBeUndefined();
    expect(found?.hasEvidence).toBe(false);
  });

  it('treats a blank field as absent rather than as an empty answer', () => {
    const blank = check({ fields: { phoneNumber: '  ', numberSource: 'nhsd' } });
    const found = establishingEntitlementCheck([blank]);
    expect(found?.phoneNumber).toBeUndefined();
    expect(found?.numberSource).toBe('nhsd');
  });
});
