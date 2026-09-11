import {
  DEVICE_LABEL_MAX_LENGTH,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  deviceHeartbeatIsStale,
  deviceState,
  formatPairingCode,
  isPairingCodeShape,
  kioskBuildIsStale,
  normalisePairingCode,
} from './devices';

describe('the pairing code', () => {
  it('omits every character that is read wrong off a screen', () => {
    for (const confusable of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(PAIRING_CODE_ALPHABET).not.toContain(confusable);
    }
    // And it is still big enough that guessing is not the attack to worry
    // about: 30^8 with a ten-minute life and a rate limit in front of it.
    expect(PAIRING_CODE_ALPHABET.length).toBe(30);
    expect(PAIRING_CODE_LENGTH).toBe(8);
    expect(PAIRING_CODE_TTL_MS).toBe(600_000);
    expect(DEVICE_LABEL_MAX_LENGTH).toBe(60);
  });

  it('normalises what somebody typed without inventing what they meant', () => {
    expect(normalisePairingCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalisePairingCode('  ABCD EFGH  ')).toBe('ABCDEFGH');
    // A character outside the alphabet is DROPPED, never mapped to a
    // neighbour: `O` is not in the alphabet, so a typed `0` cannot become one.
    expect(normalisePairingCode('ABCD0FGH')).toBe('ABCDFGH');
    expect(isPairingCodeShape('ABCD0FGH')).toBe(false);
  });

  it('shows in groups of four and stores ungrouped', () => {
    expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(formatPairingCode('abcd-efgh')).toBe('ABCD-EFGH');
    // A part-typed code is shown as far as it goes rather than mis-grouped.
    expect(formatPairingCode('ABC')).toBe('ABC');
  });
});

describe('kioskBuildIsStale — the rollback that reaches an open tab', () => {
  it('does nothing at all when no floor is set', () => {
    expect(kioskBuildIsStale('2026.09.03-1', null)).toBe(false);
    expect(kioskBuildIsStale(null, null)).toBe(false);
    expect(kioskBuildIsStale(undefined, undefined)).toBe(false);
  });

  it('reloads a tablet below the floor and leaves one at or above it alone', () => {
    expect(kioskBuildIsStale('2026.09.03-1', '2026.09.03-2')).toBe(true);
    expect(kioskBuildIsStale('2026.09.03-2', '2026.09.03-2')).toBe(false);
    expect(kioskBuildIsStale('2026.09.04-1', '2026.09.03-2')).toBe(false);
  });

  it('treats a tablet that reports no build as stale once a floor exists', () => {
    // An unknown build cannot be shown to be new enough, and the cost of being
    // wrong is one reload.
    expect(kioskBuildIsStale(null, '2026.09.03-2')).toBe(true);
    expect(kioskBuildIsStale('', '2026.09.03-2')).toBe(true);
  });
});

describe('deviceState', () => {
  it('reads the three states off the two timestamps', () => {
    expect(deviceState({ revokedAt: null, pairedAt: null })).toBe('awaiting_pairing');
    expect(deviceState({ revokedAt: null, pairedAt: new Date() })).toBe('paired');
    expect(deviceState({ revokedAt: new Date(), pairedAt: new Date() })).toBe('revoked');
  });

  it('revoked wins, even over a device that was paired a moment ago', () => {
    expect(deviceState({ revokedAt: '2026-09-03T10:00:00.000Z', pairedAt: '2026-09-03T09:00:00.000Z' })).toBe(
      'revoked',
    );
  });
});

/**
 * OUT OF USE IS RECEPTION'S SWITCH, AND IT SITS BETWEEN PAIRED AND REVOKED
 * (Carl, 4–5 Sep 2026; TODO.md "Tablets: make one inactive").
 *
 * The order of the branches is the rule. Revoked still wins over everything —
 * a device with no credential cannot be "not in use", it is gone. And out of
 * use is asked AFTER pairing, so a device that has never been paired reads
 * `awaiting_pairing`: the thing a person needs to do to that row is type a
 * code in, and "not in use" would hide the only action it has.
 */
describe('deviceState with out of use', () => {
  const paired = new Date('2026-09-01T09:00:00.000Z');

  it('reads inactive off `outOfUseAt` on a paired device', () => {
    expect(deviceState({ revokedAt: null, pairedAt: paired, outOfUseAt: new Date() })).toBe('inactive');
    expect(deviceState({ revokedAt: null, pairedAt: paired, outOfUseAt: null })).toBe('paired');
  });

  it('revoked still wins, and an unpaired device is still waiting for its code', () => {
    expect(deviceState({ revokedAt: new Date(), pairedAt: paired, outOfUseAt: new Date() })).toBe('revoked');
    expect(deviceState({ revokedAt: null, pairedAt: null, outOfUseAt: new Date() })).toBe('awaiting_pairing');
  });
});

/**
 * TWO MISSED HEARTBEATS, AT THE CADENCE THE SERVER IS HANDING OUT (Carl, 4–5
 * Sep 2026).
 *
 * NOT ONE MISSED BEAT: a single dropped poll is a blip on a practice's wifi,
 * and a console that cried "not seen" at every blip would teach reception to
 * ignore the line that matters. NOT A FIXED NUMBER OF SECONDS either — a busy
 * practice polls every two seconds and a quiet one every fifteen, so the rule
 * has to be expressed in beats.
 *
 * NEVER SEEN IS STALE BY DEFINITION. A tablet that has not called in cannot be
 * shown to be alive, and the cost of being wrong is a truthful line.
 */
describe('deviceHeartbeatIsStale', () => {
  const now = new Date('2026-09-05T09:00:00.000Z');
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();

  it('is false inside two intervals and true outside them', () => {
    // Two seconds is the busy cadence: three seconds ago is inside two beats,
    // five seconds ago is outside them.
    expect(deviceHeartbeatIsStale(at(3_000), 2_000, now)).toBe(false);
    expect(deviceHeartbeatIsStale(at(5_000), 2_000, now)).toBe(true);
    // Fifteen is the quiet one, and the SAME rule gives it thirty seconds.
    expect(deviceHeartbeatIsStale(at(5_000), 15_000, now)).toBe(false);
    expect(deviceHeartbeatIsStale(at(31_000), 15_000, now)).toBe(true);
  });

  it('treats never-seen and unreadable timestamps as stale', () => {
    expect(deviceHeartbeatIsStale(null, 15_000, now)).toBe(true);
    expect(deviceHeartbeatIsStale(undefined, 15_000, now)).toBe(true);
    expect(deviceHeartbeatIsStale('not a date', 15_000, now)).toBe(true);
  });
});
