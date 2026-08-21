import { captureReadiness, orderCards, worstRowsFirst, type CardState } from './setup';

describe('captureReadiness', () => {
  const ready = {
    activeLocations: 1,
    practitioners: 2,
    acceptedAffiliations: 1,
    captureReadyAffiliations: 1,
  };

  it('says so plainly when capture is possible', () => {
    const r = captureReadiness(ready);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.headline).toBe('One practitioner is ready to capture consent.');
  });

  it('pluralises without reading like a template', () => {
    expect(captureReadiness({ ...ready, captureReadyAffiliations: 3 }).headline).toBe(
      '3 practitioners are ready to capture consent.',
    );
  });

  // The distinction the whole hub exists to make. Counts alone let a practice
  // believe capture is live when nobody has accepted.
  it('does NOT treat an invitation as an acceptance', () => {
    const r = captureReadiness({ ...ready, acceptedAffiliations: 0, captureReadyAffiliations: 0 });
    expect(r.ready).toBe(false);
    expect(r.blockers[0]).toMatch(/accepted/i);
    expect(r.blockers[0]).toMatch(/cannot accept on a practitioner/i);
  });

  it('puts locations first, because an affiliation needs one to point at', () => {
    const r = captureReadiness({
      activeLocations: 0,
      practitioners: 0,
      acceptedAffiliations: 0,
      captureReadyAffiliations: 0,
    });
    expect(r.blockers[0]).toMatch(/location/i);
  });

  it('distinguishes accepted-but-not-capture-ready', () => {
    const r = captureReadiness({ ...ready, captureReadyAffiliations: 0 });
    expect(r.blockers[0]).toMatch(/provider number or a place-of-practice address/i);
  });

  it('notes no practitioner at all separately from none accepted', () => {
    const r = captureReadiness({
      activeLocations: 1,
      practitioners: 0,
      acceptedAffiliations: 0,
      captureReadyAffiliations: 0,
    });
    expect(r.blockers.some((b) => /No practitioner has been invited/i.test(b))).toBe(true);
  });

  /*
   * A practice reading "capture is not available" on a clinical morning must
   * not think their clinic has stopped. What is unavailable is OUR record.
   */
  it('makes clear that patients can still be seen and billed', () => {
    const r = captureReadiness({
      activeLocations: 0,
      practitioners: 0,
      acceptedAffiliations: 0,
      captureReadyAffiliations: 0,
    });
    expect(r.headline).toMatch(/still be seen and billed/i);
  });
});

describe('worstRowsFirst', () => {
  it('promotes what needs work above what does not', () => {
    const rows = [
      { label: 'Bank Street', note: 'active', needsWork: false },
      { label: 'Mill Road', note: 'inactive', needsWork: true },
    ];
    expect(worstRowsFirst(rows)[0].label).toBe('Mill Road');
  });

  it('keeps the caller ordering within each group', () => {
    const rows = [
      { label: 'A', note: '', needsWork: true },
      { label: 'B', note: '', needsWork: true },
      { label: 'C', note: '', needsWork: false },
      { label: 'D', note: '', needsWork: false },
    ];
    expect(worstRowsFirst(rows).map((r) => r.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('does not mutate its input', () => {
    const rows = [
      { label: 'A', note: '', needsWork: false },
      { label: 'B', note: '', needsWork: true },
    ];
    worstRowsFirst(rows);
    expect(rows[0].label).toBe('A');
  });
});

describe('orderCards', () => {
  it('leads with what is blocked, then what needs attention', () => {
    const cards: Array<{ id: string; state: CardState }> = [
      { id: 'done', state: 'done' },
      { id: 'notStarted', state: 'not_started' },
      { id: 'blocked', state: 'blocked' },
      { id: 'attention', state: 'attention' },
    ];
    expect(orderCards(cards).map((c) => c.id)).toEqual(['blocked', 'attention', 'notStarted', 'done']);
  });

  it('is stable within a state, so the designed order survives', () => {
    const cards: Array<{ id: string; state: CardState }> = [
      { id: 'first', state: 'done' },
      { id: 'second', state: 'done' },
      { id: 'third', state: 'done' },
    ];
    expect(orderCards(cards).map((c) => c.id)).toEqual(['first', 'second', 'third']);
  });
});
