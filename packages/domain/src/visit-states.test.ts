/**
 * THE FOUR STATES, AND THE RULES THAT KEEP THEM HONEST
 * (PRACTITIONER-QUEUE-PAGE.md §3a; Carl, 12 September 2026).
 *
 * WHAT THIS SUITE IS FOR. Three of §3a's seven rules are properties of the
 * DOMAIN rather than of a screen or a query — who may set a state, that a
 * correction is kept beside the original, and that the list is content and not
 * code. Each is pinned here, where it can be asserted without a database or a
 * browser, so a change to any of them fails at the bench.
 */
import {
  DEFAULT_VISIT_STATE,
  VISIT_STATES_VERSION,
  VISIT_STATE_KEYS,
  VISIT_STATE_OPTIONS,
  isTheServiceRenderedSignal,
  latestVisitState,
  maySetVisitState,
  mayBeSetByHand,
  parseVisitStateContent,
  raisesAFrontDeskTask,
  visitStateOption,
} from './visit-states';

const at = (iso: string, state: string) => ({ state, setAt: iso });

describe('the list is content, not code', () => {
  it('offers exactly the four states Carl named, in his order', () => {
    /*
     * Carl, 12 Sep 2026: *"1. With patient now 2. Pending (patient in queue)
     * 3. Completed (consultation completed) 4. Reassign (to a different
     * Doctor)"*. §3a's own table puts Pending first, as the state every visit
     * starts on, and the screen renders the file in FILE ORDER — so the order
     * here is part of the answer and not incidental.
     */
    expect(VISIT_STATE_KEYS).toEqual(['pending', 'with_patient_now', 'completed', 'reassign']);
  });

  it('carries a version, because the version travels onto every record', () => {
    // Hard rule 14. A state set today must still say what it was chosen from
    // after the list is edited.
    expect(VISIT_STATES_VERSION).toMatch(/^visit-states-/);
  });

  it('nobody_sets_the_starting_state_by_hand', () => {
    /*
     * §3a's table gives Pending no setter: *"Nobody — it is the starting
     * state."* Enforced in the loader as well as here, and again by a database
     * CHECK, because a stored `pending` would be somebody moving a patient
     * BACKWARDS into "not yet seen" after the service-rendered signal had gone.
     */
    expect(DEFAULT_VISIT_STATE).toBe('pending');
    expect(mayBeSetByHand('pending')).toBe(false);
    for (const key of ['with_patient_now', 'completed', 'reassign']) {
      expect(mayBeSetByHand(key)).toBe(true);
    }
    // And a key nobody wrote code for is refused rather than stored.
    expect(mayBeSetByHand('seen_by_the_registrar')).toBe(false);
  });

  it('names Completed as the one service-rendered signal, and Reassign as the one task', () => {
    // §3a rules 3 and 4, read off the content rather than asserted in prose.
    expect(VISIT_STATE_OPTIONS.filter((o) => o.isTheServiceRenderedSignal).map((o) => o.key)).toEqual([
      'completed',
    ]);
    expect(VISIT_STATE_OPTIONS.filter((o) => o.raisesAFrontDeskTask).map((o) => o.key)).toEqual(['reassign']);
    expect(isTheServiceRenderedSignal('completed')).toBe(true);
    expect(isTheServiceRenderedSignal('reassign')).toBe(false);
    expect(raisesAFrontDeskTask('reassign')).toBe(true);
    expect(raisesAFrontDeskTask('completed')).toBe(false);
    expect(visitStateOption('completed')?.settableByHand).toBe(true);
  });

  it('refuses a file that would let one state both end a visit and hand it on', () => {
    /*
     * Completed says the consultation happened; Reassign says it should not
     * happen with this practitioner. One option asserting both would raise a
     * post-service agreement for a service nobody performed.
     */
    expect(() =>
      parseVisitStateContent({
        version: 'v1',
        options: [
          { key: 'pending', settableByHand: false, isTheStartingState: true, isTheServiceRenderedSignal: false, raisesAFrontDeskTask: false },
          { key: 'both', settableByHand: true, isTheStartingState: false, isTheServiceRenderedSignal: true, raisesAFrontDeskTask: true },
        ],
      }),
    ).toThrow(/service-rendered signal and a front-desk task/i);
  });

  it('refuses a file with no starting state, two of them, or a settable one', () => {
    const option = (over: Record<string, unknown>) => ({
      key: 'x',
      settableByHand: true,
      isTheStartingState: false,
      isTheServiceRenderedSignal: false,
      raisesAFrontDeskTask: false,
      ...over,
    });
    expect(() => parseVisitStateContent({ version: 'v1', options: [option({})] })).toThrow(
      /exactly one option must be the starting state/i,
    );
    expect(() =>
      parseVisitStateContent({
        version: 'v1',
        options: [option({ key: 'a', isTheStartingState: true }), option({ key: 'b', isTheStartingState: true })],
      }),
    ).toThrow(/exactly one option must be the starting state/i);
    // A settable starting state is the dangerous one: it is how a state moves
    // backwards past a signal that has already gone.
    expect(() =>
      parseVisitStateContent({
        version: 'v1',
        options: [option({ key: 'a', isTheStartingState: true, settableByHand: true }), option({ key: 'b' })],
      }),
    ).toThrow(/must not be settable by hand/i);
  });

  it('refuses two service-rendered signals, and a control nobody can use', () => {
    const option = (over: Record<string, unknown>) => ({
      key: 'x',
      settableByHand: true,
      isTheStartingState: false,
      isTheServiceRenderedSignal: false,
      raisesAFrontDeskTask: false,
      ...over,
    });
    expect(() =>
      parseVisitStateContent({
        version: 'v1',
        options: [
          option({ key: 'p', isTheStartingState: true, settableByHand: false }),
          option({ key: 'a', isTheServiceRenderedSignal: true }),
          option({ key: 'b', isTheServiceRenderedSignal: true }),
        ],
      }),
    ).toThrow(/at most one option may be the service-rendered signal/i);

    expect(() =>
      parseVisitStateContent({
        version: 'v1',
        options: [option({ key: 'p', isTheStartingState: true, settableByHand: false })],
      }),
    ).toThrow(/at least one option must be settable by hand/i);
  });
});

describe('a_state_can_be_corrected_and_the_correction_is_kept', () => {
  it('takes the newest saying and leaves every older one where it was', () => {
    /*
     * §3a rule 6: *"Reversible and recorded. A wrong state is corrected, and
     * the correction is kept beside the original rather than over it."* So the
     * reader flattens; it does not delete. The array below is the whole history
     * and every entry survives the read.
     */
    const history = [
      at('2026-09-12T09:00:00.000Z', 'with_patient_now'),
      at('2026-09-12T09:20:00.000Z', 'completed'),
      // Pressed by mistake, corrected four minutes later.
      at('2026-09-12T09:24:00.000Z', 'with_patient_now'),
    ];
    expect(latestVisitState(history)).toBe('with_patient_now');
    expect(history).toHaveLength(3);

    // Order of the input does not decide it — the time does.
    expect(latestVisitState([...history].reverse())).toBe('with_patient_now');
  });

  it('says pending when nobody has said anything', () => {
    // An untouched visit. Honest, and not a warning: nothing about it gates a
    // consultation or a bill (§3a rule 5, hard rule 8).
    expect(latestVisitState([])).toBe('pending');
  });
});

describe('a_practitioner_may_set_a_state_only_on_their_own_patients', () => {
  /*
   * §3a rule 2: *"A practitioner may set a state only on their own patients.
   * Reception may set any. Cross-practitioner and cross-practice writes fail
   * closed."*
   *
   * "THEIR OWN" IS WHO THE PATIENT CAME TO SEE, not who the claim goes under
   * (ARRIVAL-WHO-IS-SEEN.md §2) — so a nurse marks the patient who came to see
   * the nurse even though the agreement is anchored on the supervising GP, and
   * that GP does not, because the patient is not in front of them.
   */
  const mine = { scope: 'mine', ownAffiliationIds: ['aff-chen', 'aff-chen-afterhours'] };

  it('lets a practitioner mark somebody who came to see them, at either of their locations', () => {
    expect(maySetVisitState({ ...mine, seeingAffiliationId: 'aff-chen' })).toBe(true);
    expect(maySetVisitState({ ...mine, seeingAffiliationId: 'aff-chen-afterhours' })).toBe(true);
  });

  it('refuses another practitioner’s patient', () => {
    expect(maySetVisitState({ ...mine, seeingAffiliationId: 'aff-someone-else' })).toBe(false);
  });

  it('lets practice staff mark anybody', () => {
    // Reception, a manager or an administrator. VISIT-CHECKLIST.md §5: "a
    // clinician who forgot is the ordinary case and the desk is who notices."
    expect(maySetVisitState({ scope: 'practice', ownAffiliationIds: [], seeingAffiliationId: 'anybody' })).toBe(
      true,
    );
  });

  it('fails closed on every unclear answer', () => {
    // No affiliations, no practitioner on the arrival, an unrecognised scope.
    // The only path to `true` is a positive match or a practice-scoped caller.
    expect(maySetVisitState({ scope: 'mine', ownAffiliationIds: [], seeingAffiliationId: 'aff-chen' })).toBe(false);
    expect(maySetVisitState({ ...mine, seeingAffiliationId: null })).toBe(false);
    expect(maySetVisitState({ ...mine, seeingAffiliationId: '' })).toBe(false);
    expect(maySetVisitState({ scope: 'everything', ownAffiliationIds: ['aff-chen'], seeingAffiliationId: 'aff-chen' })).toBe(
      false,
    );
  });
});
