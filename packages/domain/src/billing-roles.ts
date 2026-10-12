/**
 * THE BILLING ROLE — who, at a location, may be the provider on an agreement
 * (Carl, 5–7 Sep 2026; TODO.md "Billing role on the affiliation").
 *
 * THE RULE IN ONE SENTENCE. The provider named on an assignment of benefit is
 * the SERVICING PROVIDER whose provider number goes on the claim, never (of
 * itself) the person who delivered the service.
 *
 * WHY THAT NEEDED SAYING. Medicare provider numbers are issued per
 * practitioner PER LOCATION, and claims are batched by provider number and
 * location. A practice nurse on a "for and on behalf of" item delivers the
 * service and bills nothing under their own number — the claim goes under the
 * GP, so the ASSIGNMENT goes under the GP too. A nurse practitioner, by
 * contrast, is an eligible provider in their own right. A phlebotomist
 * generates no Medicare claim from the practice at all. Three different
 * answers to one question, none of them derivable from "who saw the patient",
 * and none of them derivable from AHPRA profession either.
 *
 * WHY IT HANGS OFF THE AFFILIATION AND NOT THE PRACTITIONER. The number is per
 * location, and the same person can be a nurse practitioner at one site and an
 * RN at another. `Affiliation` is the practitioner × location edge and already
 * carries `providerNumber` for exactly this reason (FR-1.8).
 *
 * WHY THE LIST IS A JSON FILE. `content/billing-roles.json` is versioned
 * content, the same shape as `assignor-relationships.json` and
 * `visit-agreement-policy.json`: a list a user picks from is content, not code
 * (CLAUDE.md §7), the list moves without a deploy, and the version travels
 * with the record it produced (hard rule 14). Validation is hand-written
 * rather than Zod because `@aobplatform/domain` has zero runtime dependencies
 * by charter (CONVENTIONS.md §1) and is bundled into the browser as well as
 * into three Nest services. It runs at module load, so a malformed edit fails
 * the build at the bench.
 *
 * WHAT THE FILE CANNOT DO, AND THE ASSERTIONS THAT KEEP IT THAT WAY.
 *
 *   1. It cannot delete `servicing_provider`, and cannot make it unable to be
 *      the provider on an agreement. That key is the one the database column
 *      defaults to and the one every existing practitioner holds; an edit that
 *      removed it would refuse every arrival in the country at once.
 *   2. It cannot make every role permissive. A file where nobody is ever
 *      refused is a file that has quietly turned the rule off, and it would do
 *      so silently.
 *   3. It cannot unlock ENDURING for a non-GP. There is no enduring flag here
 *      at all. Enduring is GP-only (hard rule 6, REQ-END-01a) and is decided
 *      in code from the role AND the provider type — see `providerIsGpFor`.
 *      A nurse practitioner is a servicing provider and is still not a GP.
 *
 * NOT HERE: the display words ("Servicing provider", "Works under a
 * provider"), which live in the string table keyed by `key` (REQ-LANG-01/-02)
 * because they will be translated and a translated word must never be able to
 * change who may be named on a contract. Not here either: anything about
 * money. No fee, no benefit, no amount (hard rule 4) — a billing ROLE says
 * whose number the claim goes under, and says nothing whatever about what the
 * claim is worth.
 */
import content from '../content/billing-roles.json';
import type { ProviderType } from './parties';

export interface BillingRoleOption {
  /** Stable identifier. The string table is keyed by this; it is never shown. */
  readonly key: string;
  /**
   * May this person be the provider named on an agreement? True only for a
   * role that holds (or may hold) a provider number and is an MBS-eligible
   * provider type.
   */
  readonly mayBeProviderOnAgreement: boolean;
  /**
   * DOES A SERVICE BY SOMEBODY IN THIS ROLE NEED A BILLING PROVIDER NAMED AT
   * ALL — a different question from the one above, and the whole of Carl's
   * blood-test case (12 Sep 2026; ARRIVAL-WHO-IS-SEEN.md §3).
   *
   * TRUE for a servicing provider (they need one, and they ARE one) and for
   * somebody working under a provider (they need one, and it is somebody
   * else — so an arrival naming them is RECORDED and waits rather than being
   * thrown away). FALSE for a role that generates no Medicare claim from the
   * practice: a phlebotomist taking bloods needs no billing provider, so no
   * agreement is drafted and the visit decision `none` is a complete answer.
   *
   * IT IS NOT A BILLING JUDGEMENT. It does not say who may claim for a
   * specimen collection — this platform answers no billing questions
   * (ARRIVAL-WHO-IS-SEEN.md §8) — only whether an agreement can exist here at
   * all without a provider number to anchor it on.
   */
  readonly servicesNeedABillingProvider: boolean;
}

export interface BillingRoleContent {
  /** Recorded alongside every role change. Bump it on every edit. */
  readonly version: string;
  /** ORDER IS THE ORDER ON SCREEN. */
  readonly options: readonly BillingRoleOption[];
}

/**
 * The role every affiliation starts on, and the database column's default.
 *
 * NOT A GUESS. Every practitioner on the platform when this landed was a
 * doctor — the roster is doctors, invited by practices as doctors, and the
 * affiliation exists to carry their provider number. The default says what was
 * already true rather than inventing a state nobody chose.
 */
export const DEFAULT_BILLING_ROLE = 'servicing_provider';

/**
 * Exhaustive, and it throws rather than repairing. A content file edited into
 * a shape the platform cannot use is a mistake to surface, not one to paper
 * over with a default — the whole reason the list is editable is that somebody
 * will edit it.
 */
export function parseBillingRoleContent(raw: unknown): BillingRoleContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/billing-roles.json is not usable: ${why}. This file is versioned content (hard rule 14) ` +
        'and is validated at load so a bad edit fails the build rather than a practice.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.options) || doc.options.length === 0) {
    return fail('`options` must be a non-empty array');
  }

  const seen = new Set<string>();
  const options = doc.options.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`options[${index}] is not an object`);
    const option = entry as Record<string, unknown>;

    if (typeof option.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(option.key)) {
      return fail(`options[${index}].key must be a lower_snake_case identifier`);
    }
    if (seen.has(option.key)) return fail(`options[${index}].key "${option.key}" appears twice`);
    seen.add(option.key);

    if (typeof option.mayBeProviderOnAgreement !== 'boolean') {
      return fail(`options[${index}].mayBeProviderOnAgreement must be a boolean`);
    }
    if (typeof option.servicesNeedABillingProvider !== 'boolean') {
      return fail(`options[${index}].servicesNeedABillingProvider must be a boolean`);
    }
    /*
     * A ROLE THAT MAY BE THE PROVIDER NEEDS ONE — ITSELF. The pair
     * `{ mayBeProviderOnAgreement: true, servicesNeedABillingProvider: false }`
     * says "this person may be named on the contract, and no contract is
     * needed", which is two answers to one question. It would send an ordinary
     * GP arrival down the phlebotomist's path and quietly stop drafting
     * agreements for a whole practice, so it is refused at load.
     */
    if (option.mayBeProviderOnAgreement && !option.servicesNeedABillingProvider) {
      return fail(
        `options[${index}].key "${option.key}" may be the provider on an agreement but says its services ` +
          'need no billing provider. A role that may be named on the contract needs one — itself',
      );
    }

    return {
      key: option.key,
      mayBeProviderOnAgreement: option.mayBeProviderOnAgreement,
      servicesNeedABillingProvider: option.servicesNeedABillingProvider,
    };
  });

  const servicing = options.find((o) => o.key === DEFAULT_BILLING_ROLE);
  if (!servicing) {
    return fail(
      `the list must contain "${DEFAULT_BILLING_ROLE}" — it is the column default and the role every ` +
        'existing affiliation holds, so a list without it refuses every arrival at once',
    );
  }
  if (!servicing.mayBeProviderOnAgreement) {
    return fail(
      `"${DEFAULT_BILLING_ROLE}" must be able to be the provider on an agreement — it is the role that ` +
        'means exactly that',
    );
  }
  if (options.every((o) => o.mayBeProviderOnAgreement)) {
    return fail(
      'at least one role must be unable to be the provider on an agreement. A list where nobody is ever ' +
        'refused has turned the rule off, silently, which is the failure this file is checked for',
    );
  }

  return { version: doc.version, options };
}

const parsed = parseBillingRoleContent(content);

/** The list, in file order, which is screen order. */
export const BILLING_ROLES: readonly BillingRoleOption[] = parsed.options;

/** Recorded alongside every role change, so a question asked in 2028 has an answer. */
export const BILLING_ROLES_VERSION: string = parsed.version;

/** Just the keys, in order — the shape a `<select>` and a CHECK constraint want. */
export const BILLING_ROLE_KEYS: readonly string[] = parsed.options.map((o) => o.key);

export function billingRoleOption(key: string): BillingRoleOption | null {
  return BILLING_ROLES.find((option) => option.key === key) ?? null;
}

export function isBillingRole(value: string): boolean {
  return billingRoleOption(value) !== null;
}

/**
 * MAY THIS PERSON BE THE PROVIDER ON AN AGREEMENT AT THIS LOCATION?
 *
 * An unknown role answers NO. A role the platform does not recognise is a row
 * written by something that is not this platform, or a content file rolled
 * back under a database that was not — and "we do not know whose number this
 * claim goes under" is not a state in which to name somebody on a contract.
 */
export function mayBeProviderOnAgreement(billingRole: string): boolean {
  return billingRoleOption(billingRole)?.mayBeProviderOnAgreement === true;
}

/**
 * DOES A VISIT TO SOMEBODY IN THIS ROLE NEED A BILLING PROVIDER AT ALL?
 * (Carl, 12 Sep 2026; ARRIVAL-WHO-IS-SEEN.md §3.)
 *
 * The second of the two questions a billing role answers, and the one that
 * lets a patient who came only for a blood test be arrived. A phlebotomist
 * generates no Medicare claim from the practice, so their visit needs no
 * billing provider, no agreement and nothing from the patient — and `none` is
 * a correct, complete answer rather than a refusal.
 *
 * AN UNKNOWN ROLE ANSWERS YES, which is the fail-closed direction here and the
 * opposite of `mayBeProviderOnAgreement`'s. "We do not recognise this role" can
 * never be allowed to mean "therefore nothing needs signing": that would turn
 * a rolled-back content file into a practice that silently stopped capturing
 * consent. It means "we still need somebody to name", and the caller refuses
 * the arrival with `provider_not_servicing` before it ever gets this far.
 */
export function servicesNeedABillingProvider(billingRole: string): boolean {
  return billingRoleOption(billingRole)?.servicesNeedABillingProvider !== false;
}

/**
 * IS THIS THE GP THE CLAIM GOES UNDER — the one input `decideVisitAgreement`
 * takes, and the only place the two facts are allowed to meet.
 *
 * BOTH HALVES ARE REQUIRED, and neither implies the other:
 *
 *   - a nurse practitioner is a `servicing_provider` and is NOT a GP, so no
 *     enduring agreement (hard rule 6, REQ-END-01a); and
 *   - a GP recorded as `works_under_provider` at this location cannot be the
 *     provider on ANY agreement here, enduring or otherwise, so the question
 *     of enduring never arises.
 *
 * Written as one function rather than as two conditions at each call site
 * because there are three call sites and the second half was missing from all
 * of them until this landed.
 */
export function providerIsGpFor(input: {
  readonly billingRole: string;
  readonly providerType: ProviderType | string;
}): boolean {
  return mayBeProviderOnAgreement(input.billingRole) && input.providerType === 'general_practitioner';
}
