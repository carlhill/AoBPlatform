/**
 * The validation checklist.
 *
 * A reviewer does not make one judgement about a practice; they perform a
 * series of named checks, each of which can be done more than once, by
 * different people, with different outcomes. This module is the catalogue of
 * what those checks are and what each one requires.
 *
 * VERSIONED, like every other piece of content here (rule sets, the Basic
 * Service Description mapping, public holidays, renderers, G-NAF). A check
 * performed under v1 must read as v1 forever — adding a check next year must
 * not make last year's approvals look incomplete, and changing a weight must
 * not silently re-score history.
 *
 * FOUR OUTCOMES, NOT TWO. `not_applicable` and `could_not_complete` are not
 * softer flavours of failure; treating them as such would corrupt every score
 * and, worse, punish small practices for being small — a sole trader has no
 * manager to call, and that is not a mark against them.
 */

export class CheckError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'CheckError';
  }
}

/** Bump when the catalogue changes. Stored on every check performed. */
export const CHECKLIST_VERSION = '2026-08-v1';

export const CHECK_OUTCOMES = ['passed', 'failed', 'not_applicable', 'could_not_complete'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/**
 * Weight, for the strength score that follows.
 *
 * A reminder of the rule these exist to serve: weight attaches to a check
 * being PERFORMED AND PASSED, never to data being entered.
 */
export const CHECK_WEIGHTS = { STRONG: 3, MODERATE: 2, WEAK: 1, NEGATIVE: -2 } as const;
export type CheckWeight = keyof typeof CHECK_WEIGHTS;

export const CHECK_CATEGORIES = ['entitlement', 'entity', 'address', 'credential', 'reputation'] as const;
export type CheckCategory = (typeof CHECK_CATEGORIES)[number];

export interface CheckDefinition {
  readonly key: string;
  readonly category: CheckCategory;
  readonly label: string;
  readonly weight: CheckWeight;
  /** What this check is actually establishing, in the reviewer's own terms. */
  readonly whatItProves: string;
  /**
   * What proof to capture. A check with no evidence is somebody's memory —
   * these strings are what the reviewer is asked to attach.
   */
  readonly evidenceGuidance: string;
  /** Whether the check may be recorded as passed with no artefact at all. */
  readonly evidenceRequired: boolean;
  /** Structured fields this check needs when it passes. */
  readonly requiredFields?: readonly string[];
}

/**
 * The catalogue.
 *
 * ENTITLEMENT COMES FIRST because it is the one that matters. The ABN gate
 * proves the ENTITY exists; nothing there proves the applicant speaks for it,
 * and the ABN and trading names are public (ORG-MODEL-PROPOSAL.md §11). Several
 * of these can be performed, and more than one is better than one.
 */
export const CHECK_CATALOGUE: readonly CheckDefinition[] = [
  // --- Entitlement ---------------------------------------------------------
  {
    key: 'entitlement.phone_call',
    category: 'entitlement',
    label: 'Called the practice on an independently obtained number',
    weight: 'STRONG',
    whatItProves:
      'That somebody answering the practice’s own published number vouches for this applicant. The applicant ' +
      'chose neither the number nor the person, which is what makes it evidence.',
    evidenceGuidance:
      'Where the number came from (a screenshot of the directory or website listing), the date and time of ' +
      'the call, who answered and their role, and — if the call was recorded — the recording and its ' +
      'transcript, together with a note that consent to record was obtained and read.',
    evidenceRequired: true,
    requiredFields: ['phoneNumber', 'numberSource', 'spokeWithName'],
  },
  {
    key: 'entitlement.video_call',
    category: 'entitlement',
    label: 'Video call with the applicant and a second contact',
    weight: 'STRONG',
    whatItProves: 'That the applicant exists, is who they say, and is corroborated by somebody else at the practice.',
    evidenceGuidance:
      'The meeting recording and its transcript, the attendee list as the platform reported it, and a note ' +
      'that the recording notice was given. A screenshot of the participants is a weak substitute for the ' +
      'attendee list, which the platform generates and the applicant does not.',
    evidenceRequired: true,
    requiredFields: ['spokeWithName'],
  },
  {
    key: 'entitlement.domain_match',
    category: 'entitlement',
    label: 'Proved control of the practice’s email domain',
    weight: 'MODERATE',
    whatItProves:
      'That the applicant controls mail for the domain the practice publishes — the same test certificate ' +
      'authorities use for domain validation.',
    evidenceGuidance: 'The round-trip email including full headers, and the timestamp it was answered.',
    evidenceRequired: true,
  },
  {
    key: 'entitlement.document',
    category: 'entitlement',
    label: 'Sighted a document tying the applicant to the entity',
    weight: 'MODERATE',
    whatItProves: 'That a document exists naming this person in this organisation.',
    evidenceGuidance:
      'A scan or photograph of the document itself. Note that documents are the easiest of these to ' +
      'fabricate, which is why this is worth less than a call to a number the applicant did not choose.',
    evidenceRequired: true,
  },
  {
    key: 'entitlement.hpio_delegation',
    category: 'entitlement',
    label: 'Confirmed the applicant is a delegate on the practice’s HPI-O',
    weight: 'STRONG',
    whatItProves: 'That the Commonwealth already recognises this person as acting for this organisation.',
    evidenceGuidance: 'A screenshot of the confirmation, with the date and the reference given.',
    evidenceRequired: true,
  },

  // --- The entity ----------------------------------------------------------
  {
    key: 'entity.abn_active',
    category: 'entity',
    label: 'ABN is ACTIVE and the name matches a registered name',
    weight: 'MODERATE',
    whatItProves: 'That the entity exists and trades under the name applied for. Not that the applicant represents it.',
    evidenceGuidance: 'Automatic when the ABR answers. When attested manually, a screenshot of the ABN Lookup record.',
    evidenceRequired: false,
  },
  {
    key: 'entity.abn_age',
    category: 'entity',
    label: 'ABN registered more than two years ago',
    weight: 'WEAK',
    whatItProves: 'That the entity is not freshly minted for this application.',
    evidenceGuidance: 'The ABN Lookup record showing the registration date.',
    evidenceRequired: false,
  },

  // --- Address -------------------------------------------------------------
  {
    key: 'address.confirmed',
    category: 'address',
    label: 'Practice address confirmed',
    weight: 'MODERATE',
    whatItProves: 'That the address exists and is a place of practice.',
    evidenceGuidance: 'A G-NAF match, or a photograph or listing showing the practice at that address.',
    evidenceRequired: false,
  },
  {
    key: 'address.ahpra_locality_match',
    category: 'address',
    label: 'A practitioner’s AHPRA principal place matches this locality',
    weight: 'MODERATE',
    whatItProves:
      'That an independent regulator places a named practitioner in the same locality as this practice — the ' +
      'only check here that ties a PERSON to a PLACE.',
    evidenceGuidance: 'A screenshot of the register entry showing the suburb and postcode.',
    evidenceRequired: false,
  },

  // --- Credentials ---------------------------------------------------------
  {
    key: 'credential.verified',
    category: 'credential',
    label: 'A credential was verified with its issuing body',
    weight: 'STRONG',
    whatItProves: 'That a third party who already verified this organisation confirms the reference given.',
    evidenceGuidance: 'A screenshot or email of the confirmation, naming who confirmed it and when.',
    evidenceRequired: true,
  },

  // --- Reputation ----------------------------------------------------------
  {
    key: 'reputation.disposable_email',
    category: 'reputation',
    label: 'Applicant is using a disposable email domain',
    weight: 'NEGATIVE',
    whatItProves: 'Nothing on its own. In combination with weak entitlement evidence, a great deal.',
    evidenceGuidance: 'The domain, and why it was judged disposable.',
    evidenceRequired: false,
  },
  {
    key: 'reputation.repeat_applicant',
    category: 'reputation',
    label: 'The same contact details appear on other applications',
    weight: 'NEGATIVE',
    whatItProves: 'That one person is applying for several practices — sometimes a group, sometimes not.',
    evidenceGuidance: 'Which applications, and what was concluded.',
    evidenceRequired: false,
  },
];

export function findCheck(key: string): CheckDefinition | undefined {
  return CHECK_CATALOGUE.find((c) => c.key === key);
}

export function checksInCategory(category: CheckCategory): readonly CheckDefinition[] {
  return CHECK_CATALOGUE.filter((c) => c.category === category);
}

// ---------------------------------------------------------------------------
// Reason codes
// ---------------------------------------------------------------------------

/**
 * Why a check FAILED — the applicant was checked and did not hold up.
 */
export const FAILURE_REASONS = [
  'identity_not_confirmed',
  'contact_denied_association',
  'details_did_not_match',
  'applicant_uncooperative',
  'evidence_appeared_altered',
  'other',
] as const;

/**
 * Why a check COULD NOT BE COMPLETED — we tried and could not finish. A very
 * different fact about an applicant, and conflating the two would let "the ABR
 * was down" read the same as "the practice denied knowing them".
 */
export const INCOMPLETE_REASONS = [
  'no_answer',
  'source_unavailable',
  'applicant_unresponsive',
  'outside_our_capability',
  'other',
] as const;

export interface CheckRecord {
  readonly checkKey: string;
  readonly outcome: string;
  readonly performedByName: string;
  readonly reasonCode?: string | null;
  readonly note?: string | null;
  readonly artefactCount?: number;
  readonly fields?: Readonly<Record<string, string | null | undefined>>;
}

/**
 * The gate on recording a check.
 *
 * Every refusal here exists because the alternative is a record that looks
 * like evidence and is not.
 */
export function assertCheckRecordable(record: CheckRecord): CheckDefinition {
  const definition = findCheck(record.checkKey);
  if (!definition) {
    throw new CheckError('FR-1.1', `"${record.checkKey}" is not a check in catalogue ${CHECKLIST_VERSION}.`);
  }
  if (!(CHECK_OUTCOMES as readonly string[]).includes(record.outcome)) {
    throw new CheckError('FR-1.1', `"${record.outcome}" is not a check outcome.`);
  }
  if (!record.performedByName?.trim()) {
    throw new CheckError('FR-1.1', 'A check must name the human who performed it. "Checked" is not a check.');
  }

  if (record.outcome === 'failed') {
    if (!record.reasonCode || !(FAILURE_REASONS as readonly string[]).includes(record.reasonCode)) {
      throw new CheckError(
        'FR-1.1',
        `A failed check needs a reason from the list (${FAILURE_REASONS.join(', ')}). "Failed" with no reason ` +
          'tells the next reviewer nothing and cannot be counted.',
      );
    }
    if (!record.note?.trim()) {
      throw new CheckError('FR-1.1', 'A failed check must say what happened, in words, as well as a reason code.');
    }
  }

  if (record.outcome === 'could_not_complete') {
    if (!record.reasonCode || !(INCOMPLETE_REASONS as readonly string[]).includes(record.reasonCode)) {
      throw new CheckError(
        'FR-1.1',
        `An incomplete check needs a reason from the list (${INCOMPLETE_REASONS.join(', ')}). "We could not ` +
          'verify" and "they refused" are different facts about an applicant.',
      );
    }
  }

  if (record.outcome === 'not_applicable' && !record.note?.trim()) {
    throw new CheckError(
      'FR-1.1',
      'Marking a check not applicable must say why. It is excluded from the score entirely, so an unexplained ' +
        'one is indistinguishable from skipping it.',
    );
  }

  // Evidence is only demanded of a PASS. A check that failed or could not be
  // completed often has nothing to attach — that is the nature of not getting
  // through — and demanding proof of a negative would push reviewers towards
  // recording nothing at all.
  if (record.outcome === 'passed') {
    if (definition.evidenceRequired && !record.artefactCount) {
      throw new CheckError(
        'FR-1.1',
        `"${definition.label}" cannot pass with no evidence attached. ${definition.evidenceGuidance}`,
      );
    }
    for (const fieldName of definition.requiredFields ?? []) {
      if (!record.fields?.[fieldName]?.toString().trim()) {
        throw new CheckError('FR-1.1', `"${definition.label}" needs ${fieldName} recorded when it passes.`);
      }
    }
  }

  return definition;
}

// ---------------------------------------------------------------------------
// Reading a set of checks
// ---------------------------------------------------------------------------

export interface CheckSummary {
  readonly performed: number;
  readonly passed: number;
  readonly failed: number;
  readonly notApplicable: number;
  readonly incomplete: number;
  /** Distinct entitlement checks that PASSED. The number that matters most. */
  readonly entitlementPassed: number;
  readonly strongPassed: number;
  readonly score: number;
}

/**
 * Summarise the LATEST outcome per check key.
 *
 * Checks are append-only, so a key may have been performed several times — a
 * call that went unanswered on Tuesday and succeeded on Thursday. The history
 * is all kept; the summary reflects where each check currently stands.
 */
export function summariseChecks(records: readonly CheckRecord[]): CheckSummary {
  const latest = new Map<string, CheckRecord>();
  for (const record of records) latest.set(record.checkKey, record);
  const current = [...latest.values()];

  let score = 0;
  let entitlementPassed = 0;
  let strongPassed = 0;

  for (const record of current) {
    const definition = findCheck(record.checkKey);
    if (!definition) continue;
    if (record.outcome === 'passed') {
      score += CHECK_WEIGHTS[definition.weight];
      if (definition.category === 'entitlement') entitlementPassed += 1;
      if (definition.weight === 'STRONG') strongPassed += 1;
    }
    // A NEGATIVE check subtracts when it PASSES — "yes, this is a disposable
    // domain" is the finding, and its weight is already negative.
  }

  return {
    performed: current.length,
    passed: current.filter((r) => r.outcome === 'passed').length,
    failed: current.filter((r) => r.outcome === 'failed').length,
    notApplicable: current.filter((r) => r.outcome === 'not_applicable').length,
    incomplete: current.filter((r) => r.outcome === 'could_not_complete').length,
    entitlementPassed,
    strongPassed,
    score,
  };
}

/** ⚠ DRAFT PARAMETERS — captured now, enforced later (design §2). */
export const MINIMUM_SCORE = 6;
export const MINIMUM_STRONG_CHECKS = 1;

export interface AdmissionAssessment {
  readonly wouldPass: boolean;
  readonly reasons: readonly string[];
}

/**
 * What HARD enforcement would decide, computed while enforcement is SOFT.
 *
 * This is the number that tells us when the threshold is safe to switch on:
 * it shows, live, how many real practices we would be turning away. You cannot
 * calibrate a threshold you are already enforcing, because you never see the
 * outcomes of the applications you rejected.
 */
export function assessAdmission(summary: CheckSummary): AdmissionAssessment {
  const reasons: string[] = [];
  if (summary.score < MINIMUM_SCORE) {
    reasons.push(`Score ${summary.score} is below the ${MINIMUM_SCORE} needed.`);
  }
  if (summary.strongPassed < MINIMUM_STRONG_CHECKS) {
    reasons.push(
      `No STRONG check has passed. Without this, several weak signals could clear the threshold between them, ` +
        'which is exactly what the two-part gate exists to prevent.',
    );
  }
  if (summary.entitlementPassed === 0) {
    reasons.push(
      'No entitlement check has passed. Nothing yet shows this applicant represents this entity, which is the ' +
        'question the ABN gate does not answer.',
    );
  }
  return { wouldPass: reasons.length === 0, reasons };
}
