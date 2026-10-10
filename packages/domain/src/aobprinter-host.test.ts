/**
 * THE AOBPRINTER HOST, AS THE PLATFORM JUDGES IT (PRINTER-HEARTBEAT.md §3,
 * D-2026-10-10-02). The seven chain rules, in order, and the two liveness
 * thresholds. Hashes here are made-up hex, never anything a host produced.
 */
import {
  AOBPRINTER_OFFLINE_AFTER_MS,
  AOBPRINTER_STALE_AFTER_BEATS,
  aobPrinterChainVerdict,
  aobPrinterHostLiveness,
  type AobPrinterHostChainRow,
} from './aobprinter-host';

const h = (c: string): string => c.repeat(64);
const CHAIN_A = h('a');
const CHAIN_B = h('b');

/** A row the platform already holds for CHAIN_A: head at 40, anchor at 30. */
function row(over: Partial<AobPrinterHostChainRow> = {}): AobPrinterHostChainRow {
  return {
    chainId: CHAIN_A,
    headSeq: 40,
    headHash: h('4'),
    anchorSeq: 30,
    anchorHash: h('3'),
    chainStatus: 'unverified',
    ...over,
  };
}

describe('the chain verdict', () => {
  it('a_first_heartbeat_is_unverified_until_its_anchor_is_answered', () => {
    const first = aobPrinterChainVerdict(null, [], { chainId: CHAIN_A, head: { seq: 12, hash: h('c') } });
    expect(first).toEqual({
      status: 'unverified',
      head: { seq: 12, hash: h('c') },
      anchor: { seq: 12, hash: h('c') },
      anchorVerified: false,
      newRegression: null,
    });

    // The next beat answers the anchor the platform named, and only then is it consistent.
    const stored = row({ headSeq: 12, headHash: h('c'), anchorSeq: 12, anchorHash: h('c') });
    const answered = aobPrinterChainVerdict(stored, [], {
      chainId: CHAIN_A,
      head: { seq: 15, hash: h('d') },
      atAnchor: { seq: 12, hash: h('c') },
    });
    expect(answered.status).toBe('consistent');
  });

  it('an_answered_anchor_with_the_same_hash_is_consistent_and_moves_the_anchor_to_the_head', () => {
    const verdict = aobPrinterChainVerdict(row(), [], {
      chainId: CHAIN_A,
      head: { seq: 45, hash: h('5') },
      atAnchor: { seq: 30, hash: h('3') },
    });
    expect(verdict).toEqual({
      status: 'consistent',
      head: { seq: 45, hash: h('5') },
      anchor: { seq: 45, hash: h('5') },
      anchorVerified: true,
      newRegression: null,
    });
  });

  it('a_head_that_goes_backwards_is_a_regression', () => {
    const behindHead = aobPrinterChainVerdict(row({ chainStatus: 'consistent' }), [], {
      chainId: CHAIN_A,
      head: { seq: 39, hash: h('9') },
      atAnchor: { seq: 30, hash: h('3') },
    });
    expect(behindHead.status).toBe('regressed');
    expect(behindHead.newRegression).toEqual({
      kind: 'went_backwards',
      expected: { seq: 40, hash: h('4') },
      received: { seq: 39, hash: h('9') },
    });
    // The anchor is evidence about the past and does not move on a regression.
    expect(behindHead.anchor).toEqual({ seq: 30, hash: h('3') });
    expect(behindHead.anchorVerified).toBe(false);

    // Behind the anchor is backwards too, even where the stored head is lower.
    const behindAnchor = aobPrinterChainVerdict(row({ headSeq: 20, headHash: h('2') }), [], {
      chainId: CHAIN_A,
      head: { seq: 25, hash: h('6') },
    });
    expect(behindAnchor.newRegression).toEqual({
      kind: 'went_backwards',
      expected: { seq: 30, hash: h('3') },
      received: { seq: 25, hash: h('6') },
    });
  });

  it('the_same_sequence_with_a_different_hash_is_a_regression', () => {
    const verdict = aobPrinterChainVerdict(row(), [], {
      chainId: CHAIN_A,
      head: { seq: 40, hash: h('e') },
      atAnchor: { seq: 30, hash: h('3') },
    });
    expect(verdict.status).toBe('regressed');
    expect(verdict.newRegression).toEqual({
      kind: 'same_seq_different_hash',
      expected: { seq: 40, hash: h('4') },
      received: { seq: 40, hash: h('e') },
    });
  });

  it('an_anchor_answered_with_a_different_hash_is_a_regression', () => {
    const different = aobPrinterChainVerdict(row(), [], {
      chainId: CHAIN_A,
      head: { seq: 41, hash: h('f') },
      atAnchor: { seq: 30, hash: h('7') },
    });
    expect(different.status).toBe('regressed');
    expect(different.newRegression).toEqual({
      kind: 'anchor_mismatch',
      expected: { seq: 30, hash: h('3') },
      received: { seq: 30, hash: h('7') },
    });

    // An event the host can no longer find at the anchor is the same finding.
    const missing = aobPrinterChainVerdict(row(), [], {
      chainId: CHAIN_A,
      head: { seq: 41, hash: h('f') },
      atAnchor: { seq: 30, hash: null },
    });
    expect(missing.newRegression?.kind).toBe('anchor_mismatch');
  });

  it('a_new_chain_for_a_practice_that_already_has_one_is_a_regression_not_a_new_host', () => {
    /*
     * A full rewrite of the audit log changes the hash of event 1, so it
     * arrives as a chain the platform has never seen. Calling it a new host
     * would defeat the anchor (decision 6).
     */
    const verdict = aobPrinterChainVerdict(null, [{ chainId: CHAIN_A, rebaselinedAt: null, retiredAt: null }], {
      chainId: CHAIN_B,
      head: { seq: 3, hash: h('8') },
    });
    expect(verdict.status).toBe('regressed');
    expect(verdict.newRegression).toEqual({
      kind: 'chain_replaced',
      expected: { seq: 1, hash: CHAIN_A },
      received: { seq: 1, hash: CHAIN_B },
    });
    expect(verdict.head).toEqual({ seq: 3, hash: h('8') });

    // Once the earlier chain has been RETIRED (an operator accepted a replacement), a new one starts unverified.
    const afterRetirement = aobPrinterChainVerdict(
      null,
      [{ chainId: CHAIN_A, rebaselinedAt: null, retiredAt: new Date('2026-10-01T00:00:00Z') }],
      { chainId: CHAIN_B, head: { seq: 3, hash: h('8') } },
    );
    expect(afterRetirement.status).toBe('unverified');
    expect(afterRetirement.newRegression).toBeNull();
  });

  it('a_new_chain_after_the_only_chain_was_rebaselined_is_still_chain_replaced', () => {
    /*
     * The practice's only chain regressed and an operator re-baselined it.
     * That accepted its CURRENT HEAD; it did not retire it. A rewrite or a
     * reinstall afterwards is still a new chain beside an existing one, and
     * decision 6 says that is always `chain_replaced`.
     */
    const verdict = aobPrinterChainVerdict(
      null,
      [{ chainId: CHAIN_A, rebaselinedAt: new Date('2026-10-01T00:00:00Z'), retiredAt: null }],
      { chainId: CHAIN_B, head: { seq: 3, hash: h('8') } },
    );
    expect(verdict.status).toBe('regressed');
    expect(verdict.newRegression).toEqual({
      kind: 'chain_replaced',
      expected: { seq: 1, hash: CHAIN_A },
      received: { seq: 1, hash: CHAIN_B },
    });
  });

  it('a_retired_chain_does_not_make_a_new_chain_a_replacement', () => {
    /*
     * CHAIN_A was replaced by CHAIN_B and the operator accepted CHAIN_B, which
     * retired CHAIN_A. A third chain is judged against CHAIN_B (not retired),
     * never against CHAIN_A; with only retired chains beside it, it is a
     * first beat.
     */
    const CHAIN_C = h('c');
    const retiredA = { chainId: CHAIN_A, rebaselinedAt: null, retiredAt: new Date('2026-10-02T00:00:00Z') };
    const acceptedB = { chainId: CHAIN_B, rebaselinedAt: new Date('2026-10-02T00:00:00Z'), retiredAt: null };

    const besideB = aobPrinterChainVerdict(null, [retiredA, acceptedB], {
      chainId: CHAIN_C,
      head: { seq: 2, hash: h('7') },
    });
    expect(besideB.newRegression).toEqual({
      kind: 'chain_replaced',
      expected: { seq: 1, hash: CHAIN_B },
      received: { seq: 1, hash: CHAIN_C },
    });

    const onlyRetired = aobPrinterChainVerdict(null, [retiredA], { chainId: CHAIN_C, head: { seq: 2, hash: h('7') } });
    expect(onlyRetired).toEqual({
      status: 'unverified',
      head: { seq: 2, hash: h('7') },
      anchor: { seq: 2, hash: h('7') },
      anchorVerified: false,
      newRegression: null,
    });
  });

  it('a_regression_is_sticky_until_rebaselined', () => {
    // A perfectly good beat after a regression does not clear it, and is not a second transition.
    const verdict = aobPrinterChainVerdict(row({ chainStatus: 'regressed' }), [], {
      chainId: CHAIN_A,
      head: { seq: 50, hash: h('9') },
      atAnchor: { seq: 30, hash: h('3') },
    });
    expect(verdict).toEqual({
      status: 'regressed',
      head: { seq: 50, hash: h('9') },
      anchor: { seq: 30, hash: h('3') },
      anchorVerified: false,
      newRegression: null,
    });
  });

  it('a_missing_anchor_answer_after_a_restart_is_unverified_not_regressed', () => {
    // A restarted host has forgotten the anchor it was asked about: no answer at all.
    const noAnswer = aobPrinterChainVerdict(row(), [], { chainId: CHAIN_A, head: { seq: 42, hash: h('a') } });
    expect(noAnswer.status).toBe('unverified');
    expect(noAnswer.newRegression).toBeNull();
    expect(noAnswer.anchor).toEqual({ seq: 30, hash: h('3') });
    expect(noAnswer.head).toEqual({ seq: 42, hash: h('a') });

    // Or an answer for a seq the platform did not name.
    const otherSeq = aobPrinterChainVerdict(row(), [], {
      chainId: CHAIN_A,
      head: { seq: 42, hash: h('a') },
      atAnchor: { seq: 12, hash: h('1') },
    });
    expect(otherSeq.status).toBe('unverified');
    expect(otherSeq.newRegression).toBeNull();
    expect(otherSeq.anchorVerified).toBe(false);
  });

  it('a missing anchor answer leaves a consistent row as it was', () => {
    const verdict = aobPrinterChainVerdict(row({ chainStatus: 'consistent' }), [], {
      chainId: CHAIN_A,
      head: { seq: 42, hash: h('a') },
    });
    expect(verdict.status).toBe('consistent');
    expect(verdict.anchor).toEqual({ seq: 30, hash: h('3') });
    expect(verdict.anchorVerified).toBe(false);
  });

  it('checks the rules in order: backwards is named before a mismatched anchor', () => {
    const verdict = aobPrinterChainVerdict(row(), [], {
      chainId: CHAIN_A,
      head: { seq: 35, hash: h('5') },
      atAnchor: { seq: 30, hash: h('7') },
    });
    expect(verdict.newRegression?.kind).toBe('went_backwards');
  });
});

describe('host liveness', () => {
  const now = new Date('2026-10-10T09:00:00Z');
  const ago = (ms: number): Date => new Date(now.getTime() - ms);

  it('a_host_is_stale_after_three_missed_heartbeats_at_its_own_interval', () => {
    expect(AOBPRINTER_STALE_AFTER_BEATS).toBe(3);
    // Every minute: three minutes is still live, a moment past it is stale.
    expect(aobPrinterHostLiveness(ago(180_000), 60_000, now)).toBe('live');
    expect(aobPrinterHostLiveness(ago(180_001), 60_000, now)).toBe('stale');
    // Every fifteen seconds: the same three beats, in its own time.
    expect(aobPrinterHostLiveness(ago(45_000), 15_000, now)).toBe('live');
    expect(aobPrinterHostLiveness(ago(45_001), 15_000, now)).toBe('stale');
    // An ISO string is read the same as a Date.
    expect(aobPrinterHostLiveness(ago(180_001).toISOString(), 60_000, now)).toBe('stale');
  });

  it('a_host_is_offline_after_fifteen_minutes', () => {
    expect(AOBPRINTER_OFFLINE_AFTER_MS).toBe(15 * 60_000);
    expect(aobPrinterHostLiveness(ago(15 * 60_000), 60_000, now)).toBe('stale');
    expect(aobPrinterHostLiveness(ago(15 * 60_000 + 1), 60_000, now)).toBe('offline');
    // A ten-minute interval would not be stale until thirty: offline still comes at fifteen.
    expect(aobPrinterHostLiveness(ago(16 * 60_000), 600_000, now)).toBe('offline');
  });

  it('a host that has never reported is its own answer, not an outage', () => {
    expect(aobPrinterHostLiveness(null, 60_000, now)).toBe('never_reported');
  });
});
