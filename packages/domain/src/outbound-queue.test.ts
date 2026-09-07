import {
  BACKOFF_SECONDS,
  DEVICE_LEASE_SECONDS,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  MAX_PAYLOAD_BYTES,
  OUTBOUND_CHANNELS,
  OutboundQueueError,
  afterFailure,
  afterPermanentFailure,
  assertQueueable,
  backoffFor,
  idempotencyKey,
  isClaimable,
  isPullChannel,
  leaseSecondsFor,
  MIN_RESEND_REASON_WORDS,
  assertResendNote,
  countWords,
} from './outbound-queue';

const NOW = new Date('2026-08-22T10:00:00Z');

describe('channels', () => {
  it('knows which are pulled rather than pushed', () => {
    // A kiosk has no address we can reach. It asks.
    expect(isPullChannel('device')).toBe(true);
    expect(isPullChannel('email')).toBe(false);
    expect(OUTBOUND_CHANNELS).toContain('device');
  });

  it('gives a device a longer lease than a worker', () => {
    // A tablet may be picked up, carried to a patient, and put down again
    // before it confirms. A worker is either sending or dead.
    expect(leaseSecondsFor('device')).toBe(DEVICE_LEASE_SECONDS);
    expect(leaseSecondsFor('email')).toBe(LEASE_SECONDS);
    expect(DEVICE_LEASE_SECONDS).toBeGreaterThan(LEASE_SECONDS);
  });
});

describe('backoff', () => {
  it('rises and then holds, rather than growing for ever', () => {
    expect(backoffFor(0)).toBe(30);
    expect(backoffFor(3)).toBe(300);
    // Capped: a notice must not sit unsent for a day because the schedule
    // kept doubling.
    expect(backoffFor(99)).toBe(3600);
  });

  it('covers an ordinary outage without hammering a struggling provider', () => {
    const total = BACKOFF_SECONDS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(60 * 60 * 2);
    expect(total).toBeLessThan(60 * 60 * 12);
  });

  it('treats a nonsense attempt count as the first attempt', () => {
    expect(backoffFor(-5)).toBe(30);
  });
});

describe('isClaimable', () => {
  const base = { channel: 'email', attempts: 0 };

  it('takes a pending item that is due', () => {
    expect(isClaimable({ ...base, state: 'pending' }, NOW)).toBe(true);
  });

  it('leaves a pending item that is not due yet', () => {
    expect(
      isClaimable({ ...base, state: 'pending', availableAt: new Date('2026-08-22T10:05:00Z') }, NOW),
    ).toBe(false);
  });

  it('NEVER takes something already sent, or dead', () => {
    // Re-sending a statutory notice is not a duplicate email. It is a second
    // assertion that notice was given.
    expect(isClaimable({ ...base, state: 'sent' }, NOW)).toBe(false);
    expect(isClaimable({ ...base, state: 'dead' }, NOW)).toBe(false);
  });

  it('will not take an item another worker holds', () => {
    expect(
      isClaimable(
        { ...base, state: 'leased', leaseExpiresAt: new Date('2026-08-22T10:01:00Z') },
        NOW,
      ),
    ).toBe(false);
  });

  it('RECLAIMS AN ITEM WHOSE LEASE HAS EXPIRED', () => {
    /*
     * The whole mechanism for a worker that died. Nothing has to notice the
     * death, detect it, or clean up — the lease simply stops being true.
     */
    expect(
      isClaimable(
        { ...base, state: 'leased', leaseExpiresAt: new Date('2026-08-22T09:59:00Z') },
        NOW,
      ),
    ).toBe(true);
  });

  it('does not let a leased row with no expiry strand work for ever', () => {
    // A missing expiry is a bug, not a permanent lease.
    expect(isClaimable({ ...base, state: 'leased' }, NOW)).toBe(true);
  });

  it('retries a failed item once its backoff has elapsed', () => {
    expect(
      isClaimable({ ...base, state: 'failed', availableAt: new Date('2026-08-22T09:59:00Z') }, NOW),
    ).toBe(true);
    expect(
      isClaimable({ ...base, state: 'failed', availableAt: new Date('2026-08-22T10:30:00Z') }, NOW),
    ).toBe(false);
  });
});

describe('afterFailure', () => {
  it('schedules a retry with the right backoff', () => {
    const out = afterFailure({ attempts: 0 }, NOW);
    expect(out.state).toBe('failed');
    expect(out.attempts).toBe(1);
    expect(out.exhausted).toBe(false);
    expect(out.availableAt?.toISOString()).toBe('2026-08-22T10:01:00.000Z');
  });

  it('gives up after the attempt budget, and DOES NOT DELETE', () => {
    /*
     * A dead item is the record that we tried eight times over six hours and
     * could not deliver a statutory notice. That is precisely the thing
     * somebody will need to explain later — deleting it would erase the
     * evidence of our own failure.
     */
    const out = afterFailure({ attempts: MAX_ATTEMPTS - 1 }, NOW);
    expect(out.state).toBe('dead');
    expect(out.exhausted).toBe(true);
    expect(out.availableAt).toBeNull();
  });

  it('kills a permanent failure immediately', () => {
    // Eight retries against an address with a typo is six hours of pointless
    // load and six hours before a human is told what to fix.
    const out = afterPermanentFailure({ attempts: 0 });
    expect(out.state).toBe('dead');
    expect(out.exhausted).toBe(true);
  });
});

describe('idempotencyKey', () => {
  it('is stable for the same logical send', () => {
    const args = { practiceId: 'p1', channel: 'email', subjectType: 'Notice', subjectId: 'n1' };
    expect(idempotencyKey(args)).toBe(idempotencyKey(args));
  });

  it('distinguishes a deliberate re-send from a retry', () => {
    const base = { practiceId: 'p1', channel: 'email', subjectType: 'Notice', subjectId: 'n1' };
    expect(idempotencyKey({ ...base, attemptGroup: 'resend-2' })).not.toBe(idempotencyKey(base));
  });

  it('separates channels, so a kiosk copy is not the email', () => {
    const base = { practiceId: 'p1', subjectType: 'Notice', subjectId: 'n1' };
    expect(idempotencyKey({ ...base, channel: 'email' })).not.toBe(
      idempotencyKey({ ...base, channel: 'device' }),
    );
  });
});

describe('assertQueueable', () => {
  it('accepts an addressed email', () => {
    expect(assertQueueable({ channel: 'email', payloadBytes: 1000, destination: 'a@b.invalid' })).toBe('email');
  });

  it('ACCEPTS AN UNADDRESSED DEVICE ITEM', () => {
    /*
     * A kiosk item is addressed to whichever tablet at that practice comes for
     * it. Demanding a device id up front would mean knowing which screen a
     * patient will walk up to.
     */
    expect(assertQueueable({ channel: 'device', payloadBytes: 1000 })).toBe('device');
  });

  it('refuses an unaddressed email', () => {
    expect(() => assertQueueable({ channel: 'email', payloadBytes: 10 })).toThrow(/needs a destination/);
  });

  it('refuses a channel that does not exist', () => {
    expect(() => assertQueueable({ channel: 'carrier_pigeon', payloadBytes: 10 })).toThrow(OutboundQueueError);
  });

  it('refuses a payload that would put bulk in the evidence database', () => {
    expect(() =>
      assertQueueable({ channel: 'email', payloadBytes: MAX_PAYLOAD_BYTES + 1, destination: 'a@b.invalid' }),
    ).toThrow(/artefact store/);
  });
});

describe('the shape holds together at Carl’s volumes', () => {
  it('gives up in hours, not days, so a failure is visible the same day', () => {
    // 750k notices/day means a stuck queue is noticed by its size. An item
    // that retried for a week would hide inside that.
    const totalHours = BACKOFF_SECONDS.reduce((a, b) => a + b, 0) / 3600;
    expect(totalHours).toBeLessThan(12);
  });

  it('caps a payload well below anything that would bloat the row', () => {
    // 750k rows/day at 256KB would be 190GB/day. The cap is a ceiling for
    // pathological callers, not a target — real notices are a few KB.
    expect(MAX_PAYLOAD_BYTES).toBeLessThanOrEqual(256 * 1024);
  });
});

describe('what somebody must say when sending a message again', () => {
  it('REFUSES A ONE-WORD NOTE', () => {
    /*
     * "resent", "again", "requested" — a label rather than an account of what
     * happened, and it tells the next person nothing they did not already know
     * from the fact of the resend. Three words is the shortest thing that can
     * carry a subject and something about it: "patient rang twice".
     */
    expect(() => assertResendNote('resent')).toThrow(/at least 3 words/i);
    expect(() => assertResendNote('sent again')).toThrow(/at least 3 words/i);
  });

  it('accepts three', () => {
    expect(() => assertResendNote('patient rang twice')).not.toThrow();
  });

  it('does not count whitespace as words', () => {
    expect(countWords('  patient   rang   twice  ')).toBe(3);
    expect(() => assertResendNote('   one    ')).toThrow(/at least 3 words/i);
  });

  it('keeps the RULE in code even though the reasons are data', () => {
    /*
     * The list of common reasons lives in a table so somebody can add a sixth
     * without a deploy. This does not, and the difference is the point: a
     * minimum that lived in that table could be edited to nothing by whoever
     * was tired of typing.
     */
    expect(MIN_RESEND_REASON_WORDS).toBe(3);
  });
});

