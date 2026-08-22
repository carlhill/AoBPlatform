import {
  AUTO_RESOLVE_CONFIDENCE,
  REVIEW_CLAIM_MINUTES,
  REVIEW_TASK_KEYS,
  REVIEW_TASK_KINDS,
  isTaskClaimable,
  kindForAmendment,
  mayAutoResolve,
  resolutionAttribution,
  reviewTaskKind,
} from './review-tasks';

const NOW = new Date('2026-08-22T10:00:00Z');

describe('the catalogue', () => {
  it('has no duplicate keys and states the question for each', () => {
    expect(new Set(REVIEW_TASK_KEYS).size).toBe(REVIEW_TASK_KEYS.length);
    for (const k of REVIEW_TASK_KINDS) {
      expect(k.question.trim().length).toBeGreaterThan(0);
    }
  });

  it('derives autoResolvable from stakes, so it cannot be set independently', () => {
    // Nobody can quietly mark a high-stakes kind auto-resolvable without
    // changing what "high" means.
    for (const k of REVIEW_TASK_KINDS) {
      expect(k.autoResolvable).toBe(k.stakes === 'low');
    }
  });

  it('treats an ADMIN CONTACT CHANGE as high stakes, separately from other amendments', () => {
    /*
     * The administrator's address is where enrolment links go. Changing it is
     * the single most useful move for somebody taking over a practice account,
     * and it arrives looking like ordinary admin.
     */
    expect(reviewTaskKind('admin_contact_changed')?.stakes).toBe('high');
    expect(reviewTaskKind('practice_amended')?.stakes).toBe('low');
  });

  it('never lets an acting-as review be closed automatically', () => {
    // §5 rule 7 requires a DIFFERENT PERSON. A model cannot be that person,
    // and letting one close this would empty the rule.
    expect(reviewTaskKind('acting_as_occurred')?.autoResolvable).toBe(false);
  });
});

describe('kindForAmendment', () => {
  it('raises the high-stakes kind when a contact route changed', () => {
    expect(kindForAmendment(['adminEmail'])).toBe('admin_contact_changed');
    expect(kindForAmendment(['website', 'adminPhone'])).toBe('admin_contact_changed');
    expect(kindForAmendment(['groupEmail'])).toBe('admin_contact_changed');
  });

  it('raises the ordinary one otherwise', () => {
    expect(kindForAmendment(['website', 'headOfficeSuburb'])).toBe('practice_amended');
    expect(kindForAmendment([])).toBe('practice_amended');
  });
});

describe('mayAutoResolve', () => {
  it('closes a confident, clean, low-stakes check', () => {
    expect(mayAutoResolve({ kindKey: 'practice_amended', confidence: 0.95, foundConcern: false })).toBe(true);
  });

  it('REFUSES A HIGH-STAKES KIND however confident', () => {
    /*
     * Not because the model is untrustworthy. Because "a person looked at this
     * and accepted it" and "a model scored it 0.99 and nobody looked" are
     * different claims, and a system that cannot tell them apart later has
     * destroyed the distinction for every task it ever closed.
     */
    expect(mayAutoResolve({ kindKey: 'admin_contact_changed', confidence: 1, foundConcern: false })).toBe(false);
    expect(mayAutoResolve({ kindKey: 'acting_as_occurred', confidence: 1, foundConcern: false })).toBe(false);
  });

  it('REFUSES WHEN THE CHECK FOUND SOMETHING, even on a low-stakes kind', () => {
    /*
     * The important one. A confident check that DID find a concern is exactly
     * the case that must reach a person — the model has done its job by
     * flagging it, and closing on its own findings would mean the interesting
     * tasks are the ones nobody ever sees.
     */
    expect(mayAutoResolve({ kindKey: 'practice_amended', confidence: 0.99, foundConcern: true })).toBe(false);
  });

  it('refuses when it is not confident', () => {
    expect(
      mayAutoResolve({ kindKey: 'practice_amended', confidence: AUTO_RESOLVE_CONFIDENCE - 0.01, foundConcern: false }),
    ).toBe(false);
    expect(
      mayAutoResolve({ kindKey: 'practice_amended', confidence: AUTO_RESOLVE_CONFIDENCE, foundConcern: false }),
    ).toBe(true);
  });

  it('refuses a kind it does not recognise', () => {
    expect(mayAutoResolve({ kindKey: 'invented', confidence: 1, foundConcern: false })).toBe(false);
  });
});

describe('resolutionAttribution', () => {
  it('says plainly when nobody looked', () => {
    const text = resolutionAttribution({ automated: true, by: 'check-bot', confidence: 0.96 });
    expect(text).toMatch(/No person reviewed this/);
    expect(text).toMatch(/0\.96/);
  });

  it('names the person when one did', () => {
    expect(resolutionAttribution({ automated: false, by: 'robin.reviewer' })).toBe('Reviewed by robin.reviewer.');
  });

  it('does not need to know which kinds were automatable at the time', () => {
    // A reader in two years must be able to tell the two apart WITHOUT that
    // list, because the list will have changed.
    const auto = resolutionAttribution({ automated: true, by: 'x' });
    const human = resolutionAttribution({ automated: false, by: 'x' });
    expect(auto).not.toBe(human);
    expect(auto).toMatch(/automatically/);
  });
});

describe('isTaskClaimable', () => {
  it('takes an open task', () => {
    expect(isTaskClaimable({ state: 'open' }, NOW)).toBe(true);
  });

  it('leaves one somebody else is holding', () => {
    expect(
      isTaskClaimable({ state: 'claimed', claimExpiresAt: new Date('2026-08-22T10:15:00Z') }, NOW),
    ).toBe(false);
  });

  it('releases one whose claim has expired', () => {
    // A browser closed mid-review must not park the task for a day.
    expect(
      isTaskClaimable({ state: 'claimed', claimExpiresAt: new Date('2026-08-22T09:55:00Z') }, NOW),
    ).toBe(true);
    expect(REVIEW_CLAIM_MINUTES).toBe(20);
  });

  it('never re-opens something already decided', () => {
    expect(isTaskClaimable({ state: 'resolved' }, NOW)).toBe(false);
    expect(isTaskClaimable({ state: 'dismissed' }, NOW)).toBe(false);
  });

  it('does not let a claim with no expiry hold for ever', () => {
    expect(isTaskClaimable({ state: 'claimed' }, NOW)).toBe(true);
  });
});
