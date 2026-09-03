import {
  DEVICE_LABEL_MAX_LENGTH,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
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
