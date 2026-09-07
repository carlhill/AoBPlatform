import {
  SIGHTING_FULL_WEIGHT_DAYS,
  SIGHTING_WORTHLESS_DAYS,
  daysSince,
  practitionerStrength,
  sightingFreshness,
} from './practitioner-strength';

const NOW = new Date('2026-06-01T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('a sighting loses weight as it ages', () => {
  it('is worth full weight while fresh', () => {
    expect(sightingFreshness(daysAgo(0), NOW)).toBe(1);
    expect(sightingFreshness(daysAgo(SIGHTING_FULL_WEIGHT_DAYS), NOW)).toBe(1);
  });

  it('is worth nothing once it is stale enough', () => {
    expect(sightingFreshness(daysAgo(SIGHTING_WORTHLESS_DAYS), NOW)).toBe(0);
    expect(sightingFreshness(daysAgo(SIGHTING_WORTHLESS_DAYS * 2), NOW)).toBe(0);
  });

  it('falls in between rather than dropping off a cliff', () => {
    const midpoint = (SIGHTING_FULL_WEIGHT_DAYS + SIGHTING_WORTHLESS_DAYS) / 2;
    const value = sightingFreshness(daysAgo(midpoint), NOW);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it('is worth nothing when nobody has ever looked', () => {
    expect(sightingFreshness(null, NOW)).toBe(0);
    expect(sightingFreshness(undefined, NOW)).toBe(0);
  });

  it('counts days plainly', () => {
    expect(daysSince(daysAgo(10), NOW)).toBe(10);
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe('practitionerStrength', () => {
  const fresh = {
    registrationStatus: 'Registered',
    registrationSightedAt: daysAgo(1),
    registrationSightedByName: 'A Reviewer',
    verifiedAt: daysAgo(30),
    passkeyEnrolledAt: daysAgo(30),
    emailProvenAt: daysAgo(30),
    hasEmail: true,
    localityMatches: true,
    nameMatches: true,
    providerNumberFormatValid: true,
  };

  it('scores a fully verified practitioner well', () => {
    const result = practitionerStrength(fresh, NOW);
    // Three STRONG at 3, three MODERATE at 2, one WEAK at 1.
    expect(result.score).toBe(16);
    expect(result.blocking).toHaveLength(0);
    expect(result.weakestLink).toBeNull();
  });

  /*
   * The behaviour this module exists for. A registration verified in January
   * says little in December, and a dashboard showing January's number unchanged
   * would be reporting a fact about the past as a fact about now.
   */
  it('SCORES LOWER AS THE SIGHTING AGES, without anything changing', () => {
    const stale = practitionerStrength(
      { ...fresh, registrationSightedAt: daysAgo(SIGHTING_WORTHLESS_DAYS) },
      NOW,
    );
    expect(stale.score).toBeLessThan(practitionerStrength(fresh, NOW).score);
    expect(stale.freshness).toBe(0);
  });

  it('says what one fresh check would restore', () => {
    const stale = practitionerStrength(
      { ...fresh, registrationSightedAt: daysAgo(SIGHTING_WORTHLESS_DAYS) },
      NOW,
    );
    // The gap is the argument for showing decay at all: it turns "your number
    // fell and you did nothing wrong" into "here is what one check restores".
    expect(stale.potentialScore).toBeGreaterThan(stale.score);
    expect(stale.potentialScore).toBe(practitionerStrength(fresh, NOW).score);
  });

  it('warns that a sighting is going stale before it is worthless', () => {
    const ageing = practitionerStrength(
      { ...fresh, registrationSightedAt: daysAgo(SIGHTING_FULL_WEIGHT_DAYS + 10) },
      NOW,
    );
    expect(ageing.negatives.join(' ')).toMatch(/last checked/i);
    expect(ageing.freshness).toBeGreaterThan(0);
    expect(ageing.freshness).toBeLessThan(1);
  });
});

describe('what is NOT a score', () => {
  const sighted = { registrationStatus: 'Registered', registrationSightedAt: daysAgo(1) };

  /*
   * A stop that enough moderate checks could outweigh is not a stop.
   * REQ-XFER-08 is immediate and across every affiliation.
   */
  it('DEREGISTRATION IS BLOCKING, not a low number', () => {
    const result = practitionerStrength({ ...sighted, deregisteredAt: daysAgo(1) }, NOW);
    expect(result.blocking.join(' ')).toMatch(/REQ-XFER-08/);
  });

  it('treats a non-practising status as a refusal by the regulator', () => {
    for (const status of ['Suspended', 'Cancelled', 'Surrendered', 'Lapsed']) {
      const result = practitionerStrength(
        { registrationStatus: status, registrationSightedAt: daysAgo(1) },
        NOW,
      );
      expect(result.blocking.join(' ')).toMatch(/does not permit practice/i);
    }
  });

  it('scores restrictions negatively without blocking — registered and unrestricted differ', () => {
    const restricted = practitionerStrength({ ...sighted, hasRestrictions: true }, NOW);
    const clean = practitionerStrength(sighted, NOW);
    expect(restricted.score).toBeLessThan(clean.score);
    expect(restricted.blocking).toHaveLength(0);
    expect(restricted.negatives.join(' ')).toMatch(/conditions, undertakings or reprimands/i);
  });

  it('surfaces anomalous velocity and refuses to block on it (REQ-ANOM-01)', () => {
    const result = practitionerStrength({ ...sighted, affiliationVelocityAnomalous: true }, NOW);
    expect(result.negatives.join(' ')).toMatch(/REQ-ANOM-01/);
    expect(result.blocking).toHaveLength(0);
  });
});

describe('honesty about what we cannot check', () => {
  /*
   * There is no public lookup for a Medicare provider number. A well-formed one
   * belonging to somebody else is indistinguishable from a correct one, so it
   * cannot honestly score more than WEAK.
   */
  it('says out loud that a provider number cannot be verified at all', () => {
    const result = practitionerStrength({ providerNumberFormatValid: true }, NOW);
    const line = result.lines.find((l) => l.key === 'provider_number_format');
    expect(line?.weight).toBe('WEAK');
    expect(line?.note).toMatch(/NO PUBLIC LOOKUP/i);
  });

  it('does not count an email the PRACTICE typed in as proven', () => {
    const asserted = practitionerStrength({ hasEmail: true }, NOW);
    const proven = practitionerStrength({ hasEmail: true, emailProvenAt: daysAgo(5) }, NOW);
    expect(proven.score).toBeGreaterThan(asserted.score);
    expect(asserted.lines.find((l) => l.key === 'email_round_trip')?.note).toMatch(/claim/i);
  });

  it('distinguishes "not established" from "established and false"', () => {
    const unchecked = practitionerStrength({}, NOW);
    const line = unchecked.lines.find((l) => l.key === 'locality_match');
    // null, not false. Nobody has compared them; that is not the same as a
    // comparison that failed, and a dashboard must not show it as one.
    expect(line?.held).toBeNull();
  });
});

describe('what to do next', () => {
  it('leads with the register when nobody has looked', () => {
    expect(practitionerStrength({}, NOW).weakestLink).toMatch(/checked the AHPRA register/i);
  });

  it('asks for a fresh sighting before asking for anything else', () => {
    const result = practitionerStrength(
      { registrationStatus: 'Registered', registrationSightedAt: daysAgo(SIGHTING_WORTHLESS_DAYS) },
      NOW,
    );
    expect(result.weakestLink).toMatch(/stale/i);
  });

  it('moves on to the ceremony once the register is fresh', () => {
    const result = practitionerStrength(
      { registrationStatus: 'Registered', registrationSightedAt: daysAgo(1) },
      NOW,
    );
    expect(result.weakestLink).toMatch(/ceremony/i);
  });
});
