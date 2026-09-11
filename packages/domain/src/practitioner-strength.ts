/**
 * How much we actually know about a practitioner — IDENTITY-STRENGTH-DESIGN §6.
 *
 * THE RULE THIS INHERITS, and the one everything else follows from: points
 * attach to CHECKS, never to entered data. Typing a registration number scores
 * nothing. A fraudster types an invented number as easily as a real one, so a
 * score that counted entry would be measuring effort at the keyboard.
 *
 * WHAT MAKES THIS DIFFERENT FROM PRACTICE STRENGTH: it DECAYS. Practice
 * identity is mostly stable facts — an ABN was active, a name matched, a human
 * rang a number they found themselves. A practitioner's registration is a
 * SNAPSHOT of a moment. "Registered, verified in January" says very little in
 * December, because the register can change on any day in between and nothing
 * tells us when it does.
 *
 * So the register sighting is worth its full weight while fresh, less as it
 * ages, and eventually nothing at all. A dashboard that showed January's score
 * unchanged in December would be reporting a fact about the past as though it
 * were a fact about now.
 *
 * AND SOME THINGS ARE NOT SCORES. Deregistration is not a low number, it is a
 * stop: REQ-XFER-08, immediate, across every affiliation, with no notice
 * period. A blocking condition that could be outweighed by enough moderate
 * checks would not be blocking.
 */

import { REGISTRATION_RECHECK_DAYS } from './ahpra';
import { CHECK_WEIGHTS, type CheckWeight } from './checks';

/**
 * How long a sighting keeps FULL weight, and how long before it is worth zero.
 *
 * ⚠ DRAFT PARAMETERS. The recheck window is already stated in ahpra.ts and is
 * reused rather than re-invented here: two numbers meaning "how stale is too
 * stale" would drift apart within a month.
 *
 * The decay is linear between the two, which is not a claim about how risk
 * actually behaves — it is a claim that we do not know how it behaves and
 * should not dress a guess up as a curve. What matters is that the number
 * visibly falls, so that "when did anybody last look" becomes a question the
 * dashboard answers by itself.
 */
export const SIGHTING_FULL_WEIGHT_DAYS = REGISTRATION_RECHECK_DAYS;
export const SIGHTING_WORTHLESS_DAYS = REGISTRATION_RECHECK_DAYS * 3;

/** One line of the §6 table, as it applies to one practitioner. */
export interface StrengthLine {
  readonly key: string;
  readonly label: string;
  readonly weight: CheckWeight;
  /** Did it hold? `null` means nobody has established it either way. */
  readonly held: boolean | null;
  /** Points actually awarded, after any decay. */
  readonly points: number;
  /** Why it scored what it scored, for a human reading the dashboard. */
  readonly note: string;
}

export interface PractitionerStrengthInput {
  /** What the register said, and when a named human read it. */
  readonly registrationStatus?: string | null;
  readonly registrationSightedAt?: Date | null;
  readonly registrationSightedByName?: string | null;
  readonly registrationSource?: string | null;

  /** REQ-PKI-01 — a ceremony performed by somebody who is not them. */
  readonly verifiedAt?: Date | null;
  readonly passkeyEnrolledAt?: Date | null;

  /** Practitioner-owned address, proven by a round trip rather than asserted. */
  readonly emailProvenAt?: Date | null;
  readonly hasEmail?: boolean;

  /** Signals from the register that are not about status. */
  readonly localityMatches?: boolean | null;
  readonly nameMatches?: boolean | null;
  readonly hasRestrictions?: boolean;

  /** REQ-ANOM-01 — surfaced, never blocking. */
  readonly affiliationVelocityAnomalous?: boolean;

  /** Format only. There is no public lookup for a provider number, at all. */
  readonly providerNumberFormatValid?: boolean | null;

  /** REQ-XFER-08. Not a score. */
  readonly deregisteredAt?: Date | null;
}

/** How much a sighting is worth given its age. 1 while fresh, 0 once stale. */
export function sightingFreshness(sightedAt: Date | null | undefined, now: Date = new Date()): number {
  if (!sightedAt) return 0;
  const days = (now.getTime() - sightedAt.getTime()) / 86_400_000;
  if (days <= SIGHTING_FULL_WEIGHT_DAYS) return 1;
  if (days >= SIGHTING_WORTHLESS_DAYS) return 0;
  const span = SIGHTING_WORTHLESS_DAYS - SIGHTING_FULL_WEIGHT_DAYS;
  return 1 - (days - SIGHTING_FULL_WEIGHT_DAYS) / span;
}

export function daysSince(when: Date | null | undefined, now: Date = new Date()): number | null {
  if (!when) return null;
  return Math.floor((now.getTime() - when.getTime()) / 86_400_000);
}

export interface PractitionerStrength {
  /** After decay and negatives. May be below zero, and that is meaningful. */
  readonly score: number;
  /** What it would be if the register had been sighted today. */
  readonly potentialScore: number;
  readonly lines: readonly StrengthLine[];
  /**
   * REQ-XFER-08 and the register's own refusals. NOT part of the score:
   * a stop that enough moderate checks could outweigh is not a stop.
   */
  readonly blocking: readonly string[];
  /** Worth a human's attention. Never automatic refusals (REQ-ANOM-01). */
  readonly negatives: readonly string[];
  readonly sightingAgeDays: number | null;
  readonly freshness: number;
  /** The single most useful thing to do next, or null if nothing is pending. */
  readonly weakestLink: string | null;
}

/**
 * The lines whose value depends on WHEN the register was read.
 *
 * All three are readings of a snapshot: what the register said that day about
 * status, about locality, and about the name. The ceremony and the passkey are
 * not here, because they are events that happened rather than observations
 * that may since have changed.
 */
const DECAYING_LINES = ['registration_verified', 'locality_match', 'name_match'];

/** Statuses the register uses that do not permit practice. */
const NON_PRACTISING = ['Suspended', 'Cancelled', 'Surrendered', 'Lapsed', 'Not currently registered'];

export function practitionerStrength(
  input: PractitionerStrengthInput,
  now: Date = new Date(),
): PractitionerStrength {
  const freshness = sightingFreshness(input.registrationSightedAt, now);
  const sightingAgeDays = daysSince(input.registrationSightedAt, now);

  const lines: StrengthLine[] = [];
  const blocking: string[] = [];
  const negatives: string[] = [];

  const add = (
    key: string,
    label: string,
    weight: CheckWeight,
    held: boolean | null,
    note: string,
    scale = 1,
  ) => {
    const points = held === true ? Math.round(CHECK_WEIGHTS[weight] * scale * 10) / 10 : 0;
    lines.push({ key, label, weight, held, points, note });
  };

  // --- The one that decides whether they may practise at all ---------------
  const registered = input.registrationStatus === 'Registered';
  if (input.deregisteredAt) {
    blocking.push(
      'REQ-XFER-08: AHPRA no longer registers this practitioner. Every affiliation ended immediately — ' +
        'there is no notice period for deregistration, and nothing can be captured in their name.',
    );
  } else if (input.registrationStatus && NON_PRACTISING.includes(input.registrationStatus)) {
    blocking.push(
      `The register says "${input.registrationStatus}", which does not permit practice. This is not a low ` +
        'score to be made up elsewhere — it is a refusal by the regulator.',
    );
  }

  add(
    'registration_verified',
    'AHPRA status Registered, checked and recent',
    'STRONG',
    input.registrationSightedAt ? registered : null,
    !input.registrationSightedAt
      ? 'Nobody has looked at the register for this practitioner. Until somebody does, all we hold is what ' +
          'was typed in.'
      : freshness === 1
        ? `Checked ${sightingAgeDays} days ago by ${input.registrationSightedByName ?? 'somebody unnamed'}.`
        : freshness === 0
          ? `Checked ${sightingAgeDays} days ago, which is beyond the point where it tells us anything about ` +
              'today. Worth zero until somebody looks again.'
          : `Checked ${sightingAgeDays} days ago, and losing weight. A registration verified in January says ` +
              'little in December.',
    freshness,
  );

  // --- The two that prove a PERSON rather than a record --------------------
  add(
    'pki_ceremony',
    'Identity ceremony by a named attester who is not them',
    'STRONG',
    input.verifiedAt ? true : null,
    input.verifiedAt
      ? 'A REQ-PKI-01 ceremony has been performed and attributed.'
      : 'No ceremony recorded. This is the check that separates a person from a row in a table.',
  );

  add(
    'passkey',
    'Passkey enrolled',
    'STRONG',
    input.passkeyEnrolledAt ? true : null,
    input.passkeyEnrolledAt
      ? 'Device-bound, and there is no password path that could weaken it.'
      : 'No passkey. Anything they accept today rests on access to an email inbox, not on a device and a ' +
          'fingerprint.',
  );

  // --- Corroboration from the register -------------------------------------
  add(
    'locality_match',
    'Register locality matches the affiliating location',
    'MODERATE',
    input.localityMatches ?? null,
    input.localityMatches === true
      ? 'An independent regulator places this person in this locality.'
      : input.localityMatches === false
        ? 'The register names a different principal place of practice. Common and usually innocent — the ' +
            'register lists only the principal one — so this scores nothing rather than counting against.'
        : 'Not compared. Needs both a register sighting and a structured location address.',
    freshness,
  );

  add(
    'name_match',
    'Register name matches the name given',
    'MODERATE',
    input.nameMatches ?? null,
    input.nameMatches === true
      ? 'Normalised comparison against what the register publishes.'
      : input.nameMatches === false
        ? 'The names differ. Marriage, transliteration and preferred names all do this, so it is a prompt to ' +
            'look rather than a finding.'
        : 'Not compared.',
    freshness,
  );

  add(
    'email_round_trip',
    'Practitioner-owned email proven by a round trip',
    'MODERATE',
    input.emailProvenAt ? true : input.hasEmail ? false : null,
    input.emailProvenAt
      ? 'They answered at that address, so it reaches them.'
      : input.hasEmail
        ? 'An address is on record but nobody has proved it reaches them. An address the PRACTICE typed in ' +
            'is the practice’s claim, not the practitioner’s.'
        : 'No address on record.',
  );

  // --- Format only, and the design says so in bold -------------------------
  add(
    'provider_number_format',
    'Provider number is well-formed for that location',
    'WEAK',
    input.providerNumberFormatValid ?? null,
    'Format only. THERE IS NO PUBLIC LOOKUP FOR A PROVIDER NUMBER, so a well-formed one that belongs to ' +
      'somebody else is indistinguishable from a correct one. It scores WEAK for that reason and could not ' +
      'honestly score more.',
  );

  // --- Negatives -----------------------------------------------------------
  if (input.hasRestrictions) {
    negatives.push(
      'The register records conditions, undertakings or reprimands. Registered and unrestricted are different ' +
        'things, and this is the line most easily skimmed past.',
    );
    lines.push({
      key: 'restrictions',
      label: 'Conditions, undertakings or reprimands on the register',
      weight: 'NEGATIVE',
      held: true,
      points: CHECK_WEIGHTS.NEGATIVE,
      note: 'Restrictions are recorded against this practitioner.',
    });
  }


  if (input.affiliationVelocityAnomalous) {
    negatives.push(
      'This practitioner has joined an unusual number of practices recently (REQ-ANOM-01). Working across ' +
        'several practices is ordinary; the RATE is what is worth a look. Never an automatic refusal.',
    );
    lines.push({
      key: 'velocity',
      label: 'Affiliation velocity anomalous',
      weight: 'NEGATIVE',
      held: true,
      points: CHECK_WEIGHTS.NEGATIVE,
      note: 'Surfaced for a human. It blocks nothing by itself.',
    });
  }

  if (input.registrationSightedAt && freshness < 1) {
    negatives.push(
      `The register was last checked ${sightingAgeDays} days ago. Beyond ${SIGHTING_FULL_WEIGHT_DAYS} days a ` +
        `sighting starts losing weight, and it is worth nothing at all after ${SIGHTING_WORTHLESS_DAYS}.`,
    );
  }

  const score = Math.round(lines.reduce((total, line) => total + line.points, 0) * 10) / 10;

  /*
   * What the score WOULD be if somebody looked at the register today.
   *
   * The gap between this and the score is the whole argument for showing decay
   * at all: it turns "your number went down and you did nothing wrong" into
   * "here is exactly what one check would restore".
   */
  const potentialScore =
    Math.round(
      lines.reduce((total, line) => {
        const decays = DECAYING_LINES.includes(line.key);
        if (!decays || line.held !== true) return total + line.points;
        return total + CHECK_WEIGHTS[line.weight];
      }, 0) * 10,
    ) / 10;

  /*
   * The one thing to do next, ordered by what would move the number most AND
   * by what a person can act on. Telling somebody to enrol a passkey when
   * nobody has yet looked at the register is advice in the wrong order.
   */
  const weakestLink = !input.registrationSightedAt
    ? 'Nobody has checked the AHPRA register for this practitioner.'
    : freshness === 0
      ? 'The register sighting is stale enough to be worth nothing. Check it again.'
      : !input.verifiedAt
        ? 'No identity ceremony has been performed (REQ-PKI-01).'
        : !input.passkeyEnrolledAt
          ? 'No passkey enrolled.'
          : !input.emailProvenAt && input.hasEmail
            ? 'Their email address has never been proven to reach them.'
            : null;

  return {
    score,
    potentialScore,
    lines,
    blocking,
    negatives,
    sightingAgeDays,
    freshness: Math.round(freshness * 100) / 100,
    weakestLink,
  };
}
