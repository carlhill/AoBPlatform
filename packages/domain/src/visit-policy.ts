/**
 * WHAT THIS VISIT NEEDS SIGNING — decided by the rule set, never by the PMS
 * (Carl, 4 Sep 2026; TODO.md "Reception-centric: the patient work page" §2).
 *
 * A patient walks up to reception, the PMS pushes an arrival, and something
 * has to decide whether that visit needs a first ENDURING agreement, an
 * EPISODIC pre-agreement, or nothing at all because an enduring agreement
 * already covers this provider and this patient. That decision is this
 * function, and the version of the table it read travels with the record it
 * produced (hard rule 14).
 *
 * WHY THE PMS MUST NOT DECIDE IT. Medtech knows the appointment; it does not
 * know reg 65CA, it has no idea whether an enduring agreement exists on OUR
 * side, and it certainly does not know that enduring is GP-only. If an arrival
 * could say `agreementType: 'enduring'` and be obeyed, the mapping would be
 * hardcoded in a system we do not control and cannot version — which is the
 * exact failure versioning exists to prevent, and is why the regulator's two
 * changes and one reversal cost a competitor ~$1m.
 * `arrival_type_is_decided_by_the_rule_set_not_the_pms` pins it.
 *
 * WHY IT IS NOT IN apps/rules. That service hosts the s 65C rule set and is a
 * HUMAN-AUTHORED ZONE (CLAUDE.md §7); it validates the PARTICULARS of an
 * agreement that already exists, at `pre_signature` and beyond. This is asked
 * BEFORE there is an agreement to validate — which of them to draft — and it
 * touches no particular, no signature and no s 65C data element. Filing an
 * eligibility question inside the validator would blur the one boundary this
 * codebase is most careful about.
 *
 * WHY THE TABLE IS A JSON FILE. `content/visit-agreement-policy.json` is
 * versioned content, exactly as `assignor-relationships.json` is: the rows can
 * change without a code change, and every arrival records the version that
 * decided it. The validation below is hand-written rather than Zod because
 * `@aobplatform/domain` has zero runtime dependencies by charter
 * (CONVENTIONS.md §1) and is bundled into the browser as well as into three
 * Nest services. It runs at module load, so a malformed edit fails the build
 * at the bench rather than a patient at a desk.
 *
 * HARD RULE 6 IS STRUCTURAL HERE, NOT EDITORIAL. There is no input for
 * practice-wide enduring coverage, so no edit to the content file can produce
 * an enduring agreement that covers a practice: the only coverage input this
 * function accepts is `activeEnduringForProviderAndPatient`, one provider and
 * one patient (REQ-END-01). And a non-GP can never reach the `enduring` row
 * (REQ-END-01a) — the file's second row catches them first, and the test
 * `visit_policy_never_offers_enduring_for_non_gp` proves it against every
 * combination of the other three inputs rather than against one example.
 *
 * TREATMENT PLAN ASSIGNMENT IS NOT OFFERED HERE. REQ-END-01a says a specialist
 * or allied health provider is offered one instead of an enduring agreement;
 * that agreement type is out of v1 scope, so a non-GP lands on `episodic_pre`
 * for now — which asks about the visit in front of the patient and asserts
 * nothing about a plan. Noted rather than silently conflated.
 *
 * NOT HERE: capacity (REQ-VUL-05 — there is no parameter for it and no branch
 * that would want one), the assignor (D7 is settled elsewhere and this
 * function never sees a person), any benefit or amount (hard rule 4), and any
 * words a human reads — those live in the string table keyed by the rule key
 * (REQ-LANG-01).
 */
import content from '../content/visit-agreement-policy.json';

/**
 * The three answers. `none` is a real answer and not an absence: the patient
 * is already covered for this provider by a live enduring agreement, so asking
 * them to sign anything would be collecting a second consent for a service the
 * first one already assigns.
 */
export const VISIT_AGREEMENT_TYPES = ['enduring', 'episodic_pre', 'none'] as const;
export type VisitAgreementType = (typeof VISIT_AGREEMENT_TYPES)[number];

export function isVisitAgreementType(value: string): value is VisitAgreementType {
  return (VISIT_AGREEMENT_TYPES as readonly string[]).includes(value);
}

/**
 * EVERYTHING THE DECISION IS ALLOWED TO KNOW. Four booleans, named so that a
 * reader can see hard rule 6 in the type: coverage is per provider AND
 * patient, and there is no fifth field that could widen it to a practice.
 */
export interface VisitPolicyInput {
  /** From the provider record's `providerType`. Enduring is GP-only (REQ-END-01a). */
  readonly providerIsGp: boolean;
  /** A live enduring agreement for THIS provider and THIS patient (REQ-END-01). */
  readonly activeEnduringForProviderAndPatient: boolean;
  /** The practice's standing setting — whether the pre-step offers enduring at all. */
  readonly practiceOffersEnduringByDefault: boolean;
  /** This patient has said no to an ongoing agreement before; do not ask again today. */
  readonly patientDeclinedEnduring: boolean;
}

/** The four input names, which is also the set a rule's `when` may mention. */
export const VISIT_POLICY_INPUTS: readonly (keyof VisitPolicyInput)[] = [
  'providerIsGp',
  'activeEnduringForProviderAndPatient',
  'practiceOffersEnduringByDefault',
  'patientDeclinedEnduring',
];

/**
 * THE PATHWAY AN ENDURING AGREEMENT IS ENTERED UNDER, and it is CONTENT rather
 * than code for the same reason the type is (hard rule 14).
 *
 * `createDraft` refuses an enduring agreement with no pathway (reg 65CA/65CB),
 * so something has to name one — and "the arrival came from a GP practice,
 * therefore MyMedicare" is precisely the kind of regulatory inference that must
 * not be buried in a `switch`. It sits in the rule row that produced the
 * `enduring` answer, travels with the record, and moves without a deploy.
 *
 * `accho_ams` IS NOT AVAILABLE HERE. That pathway anchors to an ORGANISATION
 * rather than a provider (Addendum v3 §1.1), and an arrival names a provider —
 * so a table that could select it would be a table that produces a draft
 * `createDraft` must refuse. Refused at load instead.
 */
export const VISIT_POLICY_ENDURING_PATHWAYS = ['mymedicare', 'residential_aged_care'] as const;
export type VisitPolicyEnduringPathway = (typeof VISIT_POLICY_ENDURING_PATHWAYS)[number];

export interface VisitAgreementDecision {
  readonly type: VisitAgreementType;
  /** Hard rule 14 — recorded on the arrival, so a question asked in 2028 has an answer. */
  readonly policyVersion: string;
  /** The rule key that decided it. A code the console renders in its own words. */
  readonly reason: string;
  /** Set only when `type` is `enduring`; the pathway that row names. */
  readonly enduringPathway?: VisitPolicyEnduringPathway;
}

export interface VisitPolicyRule {
  readonly key: string;
  /** Every named input must equal its value for the row to match. Empty matches all. */
  readonly when: Readonly<Partial<VisitPolicyInput>>;
  readonly type: VisitAgreementType;
  /** Required on an `enduring` row, forbidden on any other. */
  readonly enduringPathway?: VisitPolicyEnduringPathway;
}

export interface VisitPolicyContent {
  readonly version: string;
  /** ORDER IS MEANING: first match wins, and the last row must match everything. */
  readonly rules: readonly VisitPolicyRule[];
}

/**
 * Exhaustive, and it throws rather than repairing — the same posture
 * `parseAssignorRelationshipContent` takes and for the same reason: the file is
 * editable precisely because somebody will edit it, and a default quietly
 * applied to a bad edit is a decision nobody made.
 */
export function parseVisitPolicyContent(raw: unknown): VisitPolicyContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/visit-agreement-policy.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.rules) || doc.rules.length === 0) {
    return fail('`rules` must be a non-empty array');
  }

  const seen = new Set<string>();
  const rules = doc.rules.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`rules[${index}] is not an object`);
    const rule = entry as Record<string, unknown>;

    if (typeof rule.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(rule.key)) {
      return fail(`rules[${index}].key must be a lower_snake_case identifier`);
    }
    if (seen.has(rule.key)) return fail(`rules[${index}].key "${rule.key}" appears twice`);
    seen.add(rule.key);

    if (typeof rule.type !== 'string' || !isVisitAgreementType(rule.type)) {
      return fail(`rules[${index}].type must be one of: ${VISIT_AGREEMENT_TYPES.join(', ')}`);
    }
    if (typeof rule.when !== 'object' || rule.when === null || Array.isArray(rule.when)) {
      return fail(`rules[${index}].when must be an object (use {} for "matches everything")`);
    }

    const when: Partial<Record<keyof VisitPolicyInput, boolean>> = {};
    for (const [name, value] of Object.entries(rule.when as Record<string, unknown>)) {
      if (!(VISIT_POLICY_INPUTS as readonly string[]).includes(name)) {
        return fail(
          `rules[${index}].when mentions "${name}", which is not one of the inputs this decision may ` +
            `see: ${VISIT_POLICY_INPUTS.join(', ')}. In particular there is no practice-wide coverage ` +
            'input, because an enduring agreement is per practitioner x patient (hard rule 6, REQ-END-01)',
        );
      }
      if (typeof value !== 'boolean') return fail(`rules[${index}].when.${name} must be a boolean`);
      when[name as keyof VisitPolicyInput] = value;
    }

    const type = rule.type as VisitAgreementType;
    if (type === 'enduring') {
      if (
        typeof rule.enduringPathway !== 'string' ||
        !(VISIT_POLICY_ENDURING_PATHWAYS as readonly string[]).includes(rule.enduringPathway)
      ) {
        return fail(
          `rules[${index}] answers "enduring" and must name an enduringPathway, one of: ` +
            `${VISIT_POLICY_ENDURING_PATHWAYS.join(', ')}. An enduring agreement without a pathway is ` +
            'refused at draft time (reg 65CA/65CB), and `accho_ams` is not selectable here because it ' +
            'anchors to an organisation rather than the provider an arrival names (Addendum v3 §1.1)',
        );
      }
      return {
        key: rule.key,
        when,
        type,
        enduringPathway: rule.enduringPathway as VisitPolicyEnduringPathway,
      };
    }
    if (rule.enduringPathway !== undefined) {
      return fail(`rules[${index}].enduringPathway is only meaningful on a rule whose type is "enduring"`);
    }
    return { key: rule.key, when, type };
  });

  /*
   * THE TABLE MUST BE TOTAL. Every combination of four booleans has to reach a
   * decision, or some patient standing at a desk falls off the end of the list
   * and the platform has to invent something — which is how a guess comes to
   * be recorded as a rule set's answer.
   */
  const last = rules[rules.length - 1];
  if (Object.keys(last.when).length !== 0) {
    throw new Error(
      'content/visit-agreement-policy.json is not usable: the LAST rule must have an empty `when` so ' +
        'that every possible visit reaches a decision. A table that can fall through is a table that ' +
        'makes the platform guess a particular of a contract.',
    );
  }

  return { version: doc.version, rules };
}

const parsed = parseVisitPolicyContent(content);

/** The rule table, in file order, which is evaluation order. */
export const VISIT_POLICY_RULES: readonly VisitPolicyRule[] = parsed.rules;

/** Recorded on every arrival, so the decision says which table produced it. */
export const VISIT_POLICY_VERSION: string = parsed.version;

/**
 * WHAT THIS VISIT NEEDS. Pure, total, and it reads nothing but its arguments
 * and the content file.
 */
export function decideVisitAgreement(input: VisitPolicyInput): VisitAgreementDecision {
  for (const rule of VISIT_POLICY_RULES) {
    const matches = (Object.keys(rule.when) as (keyof VisitPolicyInput)[]).every(
      (name) => input[name] === rule.when[name],
    );
    if (matches) {
      return {
        type: rule.type,
        policyVersion: VISIT_POLICY_VERSION,
        reason: rule.key,
        ...(rule.enduringPathway ? { enduringPathway: rule.enduringPathway } : {}),
      };
    }
  }
  /*
   * Unreachable: `parseVisitPolicyContent` refuses a table whose last row can
   * fail to match. Present so the compiler and a future editor both see that
   * falling through is not a state this function has an answer for.
   */
  throw new Error('the visit policy table fell through, which parseVisitPolicyContent should have prevented');
}

// ---------------------------------------------------------------------------
// THE SECOND MOMENT — after the service, when the item is known
// ---------------------------------------------------------------------------

/**
 * WHAT THIS *RENDERED* SERVICE NEEDS SIGNED (Carl, 11 Sep 2026; TODO.md "Two
 * front doors" decision (b), "Still to build: Post-service push").
 *
 * The patient has seen the practitioner. The service is known: the day it was
 * rendered (D5) and its MBS item numbers (D6b) — a post-agreement is s 65C(4)
 * table item 6, and D6b is "post-agreements only" (REQ-REG-01). Something has
 * to decide whether the patient is handed the tablet a second time, and that
 * something is this table rather than the PMS, for exactly the reason the
 * pre-service one gives: the mapping must be versioned in a system we control
 * (hard rule 14), and the version travels onto the record the answer produced.
 *
 * A SECOND TABLE IN THE SAME FILE, NOT MORE ROWS ON THE FIRST. The two are
 * asked at different moments about different facts. The pre-service table has
 * no idea what was billed; this one has no opinion about whether the practice
 * offers ongoing agreements. Sharing a `when` vocabulary would mean keys that
 * are meaningless on half the rows, and a rule table nobody can read is a rule
 * table nobody can audit.
 *
 * WHY `covered` IS THE FIRST ROW. A signed pre-agreement made for this
 * patient, this practitioner and this day already assigns the benefit for the
 * service the patient has just had. Asking again would collect a second
 * consent for one service — "one signature per episodic visit, not two"
 * (TODO.md). The tap the second push asks for is a SIGNATURE on a NEW
 * agreement (REQ-REG-07), never a confirmation of the first one, so it is only
 * ever asked where the first one does not reach.
 *
 * THE CONTAINMENT CHECK IS DEFERRED, AND IT IS DEFERRED OUT LOUD. "Is the
 * billed item INSIDE that pre-agreement's Basic Service Description" needs the
 * REQ-REG-03 mapping of MBS items to descriptions, which does not exist yet —
 * it is the quarterly MBS Online ingest with a human-reviewed diff, and
 * CONSULTATION-CAPTURE-PLAN section 3.1 records the check as blocked on it. So
 * there is deliberately NO `itemInsidePreAgreementDescription` input here: an
 * input nothing in the system can compute would be a lie in a rule table, and
 * a default quietly supplied for it would be the platform guessing at the
 * scope of a contract. When the mapping lands, the input and its row are added
 * here and every record made before then still says which version decided it.
 *
 * `covered_by_enduring` IS NOT A SECOND `covered`. Both mean the patient signs
 * nothing, but they have different downstream stories and the reason code must
 * not blur them: an ongoing agreement's CLAIM carries a reg 89AA notice, which
 * is the claim's business — one-way, never gating payment, never chased (hard
 * rule 7, REQ-END-05, REQ-CHASE-02). Nothing in this table starts one.
 *
 * NOT HERE: any amount (hard rule 4 — the inputs are booleans and the answer
 * is a word), the assignor (D7 is settled at the desk), capacity (REQ-VUL-05 —
 * there is no parameter for it), and every word a human reads, which lives in
 * the string table keyed by the rule key (REQ-LANG-01).
 */
export const POST_SERVICE_OUTCOMES = ['covered', 'covered_by_enduring', 'episodic_post'] as const;
export type PostServiceOutcome = (typeof POST_SERVICE_OUTCOMES)[number];

export function isPostServiceOutcome(value: string): value is PostServiceOutcome {
  return (POST_SERVICE_OUTCOMES as readonly string[]).includes(value);
}

/**
 * EVERYTHING THIS DECISION IS ALLOWED TO KNOW. Two booleans, and the names say
 * what hard rule 6 requires: coverage is per practitioner AND patient, and the
 * pre-agreement that counts is the one made for this practitioner, this
 * patient and this DAY — never a practice-wide one and never yesterday's.
 */
export interface PostServicePolicyInput {
  /**
   * A SIGNED episodic pre-agreement for this patient x this practitioner x the
   * day the service was rendered. Signed, not merely drafted: an agreement
   * nobody put their name to assigns nothing.
   */
  readonly signedPreAgreementForProviderPatientAndDay: boolean;
  /** A live enduring agreement for THIS practitioner and THIS patient (REQ-END-01). */
  readonly activeEnduringForProviderAndPatient: boolean;
}

/** The two input names, which is also the set a post-service `when` may mention. */
export const POST_SERVICE_POLICY_INPUTS: readonly (keyof PostServicePolicyInput)[] = [
  'signedPreAgreementForProviderPatientAndDay',
  'activeEnduringForProviderAndPatient',
];

export interface PostServiceRule {
  readonly key: string;
  readonly when: Readonly<Partial<PostServicePolicyInput>>;
  readonly outcome: PostServiceOutcome;
}

export interface PostServiceDecision {
  readonly outcome: PostServiceOutcome;
  /** Hard rule 14 — recorded on the service, so a question asked in 2028 has an answer. */
  readonly policyVersion: string;
  /** The rule key that decided it. A code the console renders in its own words. */
  readonly reason: string;
}

/**
 * The post-service half of the same content file, validated the same way and
 * with the same posture: it throws rather than repairing, because the file is
 * editable precisely because somebody will edit it.
 */
export function parsePostServiceRules(raw: unknown): readonly PostServiceRule[] {
  const fail = (why: string): never => {
    throw new Error(
      `content/visit-agreement-policy.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray(doc.postServiceRules) || doc.postServiceRules.length === 0) {
    return fail('`postServiceRules` must be a non-empty array');
  }

  const seen = new Set<string>();
  const rules = doc.postServiceRules.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`postServiceRules[${index}] is not an object`);
    const rule = entry as Record<string, unknown>;

    if (typeof rule.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(rule.key)) {
      return fail(`postServiceRules[${index}].key must be a lower_snake_case identifier`);
    }
    if (seen.has(rule.key)) return fail(`postServiceRules[${index}].key "${rule.key}" appears twice`);
    seen.add(rule.key);

    if (typeof rule.outcome !== 'string' || !isPostServiceOutcome(rule.outcome)) {
      return fail(`postServiceRules[${index}].outcome must be one of: ${POST_SERVICE_OUTCOMES.join(', ')}`);
    }
    if (typeof rule.when !== 'object' || rule.when === null || Array.isArray(rule.when)) {
      return fail(`postServiceRules[${index}].when must be an object (use {} for "matches everything")`);
    }

    const when: Partial<Record<keyof PostServicePolicyInput, boolean>> = {};
    for (const [name, value] of Object.entries(rule.when as Record<string, unknown>)) {
      if (!(POST_SERVICE_POLICY_INPUTS as readonly string[]).includes(name)) {
        return fail(
          `postServiceRules[${index}].when mentions "${name}", which is not one of the inputs this ` +
            `decision may see: ${POST_SERVICE_POLICY_INPUTS.join(', ')}. In particular there is no ` +
            'input for whether the billed item falls inside a pre-agreement basic service ' +
            'description: that check needs the REQ-REG-03 mapping, which does not exist yet, and an ' +
            'input nothing can compute would be a lie in a rule table (CONSULTATION-CAPTURE-PLAN 3.1)',
        );
      }
      if (typeof value !== 'boolean') return fail(`postServiceRules[${index}].when.${name} must be a boolean`);
      when[name as keyof PostServicePolicyInput] = value;
    }

    return { key: rule.key, when, outcome: rule.outcome as PostServiceOutcome };
  });

  /*
   * TOTAL, for the same reason the pre-service table is: every combination has
   * to reach an answer, or some patient standing at the desk falls off the end
   * of the list and the platform invents something.
   */
  if (Object.keys(rules[rules.length - 1].when).length !== 0) {
    throw new Error(
      'content/visit-agreement-policy.json is not usable: the LAST postServiceRules row must have an ' +
        'empty `when` so that every rendered service reaches a decision. A table that can fall through ' +
        'is a table that makes the platform guess a particular of a contract.',
    );
  }

  return rules;
}

const parsedPostService = parsePostServiceRules(content);

/** The post-service table, in file order, which is evaluation order. */
export const POST_SERVICE_POLICY_RULES: readonly PostServiceRule[] = parsedPostService;

/**
 * WHAT THIS RENDERED SERVICE NEEDS. Pure, total, and it reads nothing but its
 * arguments and the content file. The version it reports is the file's one
 * version: both tables move together, so a record can never say it was decided
 * by a table that did not exist.
 */
export function decidePostServiceAgreement(input: PostServicePolicyInput): PostServiceDecision {
  for (const rule of POST_SERVICE_POLICY_RULES) {
    const matches = (Object.keys(rule.when) as (keyof PostServicePolicyInput)[]).every(
      (name) => input[name] === rule.when[name],
    );
    if (matches) {
      return { outcome: rule.outcome, policyVersion: VISIT_POLICY_VERSION, reason: rule.key };
    }
  }
  throw new Error('the post-service policy table fell through, which parsePostServiceRules should have prevented');
}
