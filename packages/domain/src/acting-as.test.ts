import {
  ACTING_AS_MAX_MINUTES,
  ACTING_AS_REASONS,
  ACTING_AS_REASON_KEYS,
  ActingAsError,
  actingAsReason,
  assertMayApproveAfterActingAs,
  assertPermittedWhileActingAs,
  forcesReapproval,
  isSessionLive,
  noticeToPractice,
  sessionExpiresAt,
} from './acting-as';

const START = new Date('2026-08-22T10:00:00Z');

describe('the reasons', () => {
  it('has no duplicates and explains each one', () => {
    expect(new Set(ACTING_AS_REASON_KEYS).size).toBe(ACTING_AS_REASON_KEYS.length);
    for (const r of ACTING_AS_REASONS) {
      expect(r.label.trim().length).toBeGreaterThan(0);
      expect(r.detail.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes the case this exists for', () => {
    // A practice that cannot sign in is the whole justification. If that reason
    // ever disappears, the feature has drifted into something else.
    expect(actingAsReason('no_admin_access')).toBeDefined();
  });
});

describe('what cannot be done while acting as a practice', () => {
  it('refuses every shape of removal', () => {
    /*
     * Asymmetry of harm. An operator who adds something wrong leaves a wrong
     * thing that can be seen, questioned and corrected. An operator who removes
     * something leaves nothing to question.
     */
    for (const intent of [
      'delete_practitioner',
      'remove_credential',
      'tombstone_artefact',
      'deactivate_user',
      'withdraw_notice',
      'cease_agreement',
      'end_affiliation',
    ]) {
      expect(() => assertPermittedWhileActingAs(intent)).toThrow(ActingAsError);
    }
  });

  it('catches a SOFT delete too, not only a hard one', () => {
    // "It is only a soft delete" is exactly the argument this must refuse.
    expect(() => assertPermittedWhileActingAs('soft_delete_credential')).toThrow(/cannot delete/);
  });

  it('permits adding and amending', () => {
    for (const intent of ['add_location', 'amend_application', 'invite_practitioner', 'update_address']) {
      expect(() => assertPermittedWhileActingAs(intent)).not.toThrow();
    }
  });

  it('says what to do instead, rather than only refusing', () => {
    const message = (() => {
      try {
        assertPermittedWhileActingAs('remove_credential');
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(message).toMatch(/Ask the practice to do it themselves/);
  });
});

describe('a session expires on its own', () => {
  const session = { id: 's1', practiceId: 'p1', operatorSub: 'op1', startedAt: START };

  it('is live inside the window', () => {
    expect(isSessionLive(session, new Date('2026-08-22T10:29:00Z'))).toBe(true);
  });

  it('IS NOT LIVE ONCE THE WINDOW PASSES, even with no end recorded', () => {
    /*
     * Expiry is computed, not stored. A row that says "open" and started two
     * days ago is not open — otherwise a sweep failing to close sessions would
     * be indistinguishable from sessions that never end.
     */
    expect(isSessionLive(session, new Date('2026-08-22T10:31:00Z'))).toBe(false);
  });

  it('is not live once ended', () => {
    expect(
      isSessionLive({ ...session, endedAt: new Date('2026-08-22T10:05:00Z') }, new Date('2026-08-22T10:10:00Z')),
    ).toBe(false);
  });

  it('says when it will lapse', () => {
    expect(sessionExpiresAt(session)?.toISOString()).toBe('2026-08-22T10:30:00.000Z');
    expect(ACTING_AS_MAX_MINUTES).toBe(30);
  });

  it('treats an unparseable start as not live', () => {
    expect(isSessionLive({ ...session, startedAt: 'not a date' }, START)).toBe(false);
  });
});

describe('the separation of duties rule', () => {
  it('REFUSES THE PERSON WHO IMPERSONATED', () => {
    /*
     * Rule 7, and the one that survives every other control failing. Even if
     * the scoring exclusion for impersonated evidence were removed by mistake,
     * one individual still could not manufacture evidence and approve it.
     */
    expect(() =>
      assertMayApproveAfterActingAs({ approverSub: 'op1', impersonatorSubs: ['op1'] }),
    ).toThrow(ActingAsError);
    expect(() =>
      assertMayApproveAfterActingAs({ approverSub: 'op1', impersonatorSubs: ['op1'] }),
    ).toThrow(/cannot be the person who approves/);
  });

  it('allows somebody who did not act', () => {
    expect(() =>
      assertMayApproveAfterActingAs({ approverSub: 'op2', impersonatorSubs: ['op1'] }),
    ).not.toThrow();
  });

  it('CHECKS EVERY IMPERSONATOR, not merely the most recent', () => {
    // Two operators taking turns would otherwise clear each other, which is
    // the exact collusion the rule is meant to make expensive.
    expect(() =>
      assertMayApproveAfterActingAs({ approverSub: 'op1', impersonatorSubs: ['op1', 'op2'] }),
    ).toThrow(ActingAsError);
    expect(() =>
      assertMayApproveAfterActingAs({ approverSub: 'op2', impersonatorSubs: ['op1', 'op2'] }),
    ).toThrow(ActingAsError);
    expect(() =>
      assertMayApproveAfterActingAs({ approverSub: 'op3', impersonatorSubs: ['op1', 'op2'] }),
    ).not.toThrow();
  });

  it('allows anybody when nobody has acted', () => {
    expect(() => assertMayApproveAfterActingAs({ approverSub: 'op1', impersonatorSubs: [] })).not.toThrow();
  });
});

describe('forcesReapproval', () => {
  it('is always true, including for an active practice', () => {
    // Rule 6. Without it, impersonation is merely logged — and a log nobody
    // reads is not a control. With it, impersonation has a cost somebody feels.
    expect(forcesReapproval()).toBe(true);
  });
});

describe('what the practice is told', () => {
  const notice = noticeToPractice({
    operatorName: 'carl@hillsempire.com',
    reasonKey: 'no_admin_access',
    startedAt: START,
    note: 'Fixed the Yagoona postcode.',
  });

  it('names who, when and why', () => {
    expect(notice.lines.join(' ')).toMatch(/carl@hillsempire\.com/);
    expect(notice.lines.join(' ')).toMatch(/22 August 2026/);
    expect(notice.lines.join(' ')).toMatch(/cannot sign in/);
  });

  it('says the acts are recorded against the operator, not the practice', () => {
    expect(notice.lines.join(' ')).toMatch(/against their name, not yours/);
  });

  it('warns that re-approval follows, and says why', () => {
    // The practice should understand the consequence, not just experience it.
    expect(notice.lines.join(' ')).toMatch(/approved again/);
    expect(notice.lines.join(' ')).toMatch(/somebody other than the person who acted/);
  });

  it('tells them what to do if they did not expect it', () => {
    expect(notice.lines.join(' ')).toMatch(/tell us/i);
  });
});
